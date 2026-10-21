import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  getDocs,
  writeBatch,
} from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from './firebase';
import { authService, UserProfile } from './authService';
import { ChatMessage } from '../types/hologram';

export interface ChatSession {
  id: string;
  userId: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface ConversationSearchMatch {
  sessionId: string;
  sessionTitle: string;
  sessionUpdatedAt: string;
  messageId: string;
  sender: 'user' | 'shadow';
  text: string;
  snippet: string;
  timestamp: string;
  matchType: 'title' | 'content';
  score: number;
}

export interface ConversationSearchResult {
  query: string;
  totalMatches: number;
  matchedThreadsCount: number;
  matches: ConversationSearchMatch[];
}

export type SessionsSubscriber = (sessions: ChatSession[], activeSessionId: string | null) => void;

export const GUEST_SESSIONS_STORAGE_KEY = 'shadow_guest_sessions';
export const ACTIVE_SESSION_STORAGE_KEY = 'shadow_active_session_id';

export const safeLocalStorage = {
  getItem: (key: string): string | null => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) return window.localStorage.getItem(key);
      if (typeof globalThis !== 'undefined' && (globalThis as any).localStorage) return (globalThis as any).localStorage.getItem(key);
    } catch {}
    return null;
  },
  setItem: (key: string, value: string): void => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) { window.localStorage.setItem(key, value); return; }
      if (typeof globalThis !== 'undefined' && (globalThis as any).localStorage) { (globalThis as any).localStorage.setItem(key, value); return; }
    } catch {}
  },
  removeItem: (key: string): void => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) { window.localStorage.removeItem(key); return; }
      if (typeof globalThis !== 'undefined' && (globalThis as any).localStorage) { (globalThis as any).localStorage.removeItem(key); return; }
    } catch {}
  },
};

export const FIRESTORE_MAX_DOCUMENT_BYTES = 1048576; // 1 MiB hard Firestore limit
export const SAFE_DOCUMENT_BYTE_LIMIT = 500 * 1024; // 512,000 bytes (50% safety margin)
export const MAX_MESSAGES_PER_CHUNK = 20; // Up to 20 messages per chunk
export const MAX_ATTACHMENT_PART_BYTES = 300 * 1024; // 307,200 bytes per imagePreview slice

/**
 * Calculates accurate UTF-8 serialized byte size for Firestore documents.
 */
export function calculateDocumentByteSize(docData: unknown): number {
  try {
    const jsonStr = JSON.stringify(docData);
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(jsonStr).length;
    }
    if (typeof Buffer !== 'undefined') {
      return Buffer.byteLength(jsonStr, 'utf8');
    }
    return jsonStr.length;
  } catch {
    return 0;
  }
}

/**
 * Splits a ChatSession into a metadata document (messages: []) and chunk documents (messages: slice)
 * so that no single document ever exceeds the 1 MiB limit, even with 51+ messages or large attachments.
 */
export function chunkSession(
  session: ChatSession,
  userId: string
): { metadataDoc: ChatSession; chunkDocs: ChatSession[] } {
  const metadataDoc: ChatSession = {
    id: session.id,
    userId,
    title: (session.title || 'Untitled Session').slice(0, 200),
    messages: [], // Explicitly separate metadata from message contents
    createdAt: session.createdAt || new Date().toISOString(),
    updatedAt: session.updatedAt || new Date().toISOString(),
  };

  const rawMessages = Array.isArray(session.messages) ? session.messages : [];
  if (rawMessages.length === 0) {
    return { metadataDoc, chunkDocs: [] };
  }

  // 1. Decompose any individual message with oversized attachments/text into multipart entries
  const preparedEntries: ChatMessage[] = [];
  for (const msg of rawMessages) {
    if (msg.imagePreview && msg.imagePreview.length > MAX_ATTACHMENT_PART_BYTES) {
      const fullPreview = msg.imagePreview;
      const totalParts = Math.ceil(fullPreview.length / MAX_ATTACHMENT_PART_BYTES);
      for (let p = 0; p < totalParts; p++) {
        const slice = fullPreview.slice(p * MAX_ATTACHMENT_PART_BYTES, (p + 1) * MAX_ATTACHMENT_PART_BYTES);
        preparedEntries.push({
          ...msg,
          imagePreview: slice,
          __partIndex: p,
          __totalParts: totalParts,
        } as any);
      }
    } else {
      preparedEntries.push(msg);
    }
  }

  // 2. Partition prepared entries into chunks respecting both message count and byte size limits
  const chunkedMessageLists: ChatMessage[][] = [];
  let currentList: ChatMessage[] = [];
  let currentBytes = 0;

  for (const entry of preparedEntries) {
    const entryBytes = calculateDocumentByteSize(entry);

    if (
      currentList.length >= MAX_MESSAGES_PER_CHUNK ||
      (currentList.length > 0 && currentBytes + entryBytes > SAFE_DOCUMENT_BYTE_LIMIT)
    ) {
      chunkedMessageLists.push(currentList);
      currentList = [];
      currentBytes = 0;
    }

    currentList.push(entry);
    currentBytes += entryBytes;
  }

  if (currentList.length > 0) {
    chunkedMessageLists.push(currentList);
  }

  // 3. Construct valid ChatSession chunk documents conforming to schema & rules
  const totalChunks = chunkedMessageLists.length;
  const chunkDocs: ChatSession[] = chunkedMessageLists.map((list, idx) => ({
    id: `${session.id}_chk_${idx}`,
    userId,
    title: `__chunk__:${session.id}:${idx}:${totalChunks}`,
    messages: list,
    createdAt: session.createdAt || new Date().toISOString(),
    updatedAt: session.updatedAt || new Date().toISOString(),
  }));

  return { metadataDoc, chunkDocs };
}

/**
 * Reassembles message parts and multipart attachments without any loss or truncation.
 */
export function reassembleMessages(rawEntries: ChatMessage[]): ChatMessage[] {
  if (!Array.isArray(rawEntries) || rawEntries.length === 0) return [];

  const result: ChatMessage[] = [];
  let pendingMultipart: {
    id: string;
    parts: Map<number, string>;
    baseMsg: ChatMessage;
    totalParts: number;
  } | null = null;

  for (const entry of rawEntries) {
    const partIndex = (entry as any)?.__partIndex;
    const totalParts = (entry as any)?.__totalParts;

    if (typeof partIndex === 'number' && typeof totalParts === 'number') {
      if (!pendingMultipart || pendingMultipart.id !== entry.id) {
        if (pendingMultipart) {
          const fullPreview = assembleParts(pendingMultipart.parts, pendingMultipart.totalParts);
          const { __partIndex, __totalParts, ...cleanMsg } = pendingMultipart.baseMsg as any;
          result.push({ ...cleanMsg, imagePreview: fullPreview });
        }
        pendingMultipart = {
          id: entry.id,
          parts: new Map(),
          baseMsg: { ...entry },
          totalParts,
        };
      }
      pendingMultipart.parts.set(partIndex, entry.imagePreview || '');

      if (pendingMultipart.parts.size === totalParts) {
        const fullPreview = assembleParts(pendingMultipart.parts, totalParts);
        const { __partIndex, __totalParts, ...cleanMsg } = pendingMultipart.baseMsg as any;
        result.push({ ...cleanMsg, imagePreview: fullPreview });
        pendingMultipart = null;
      }
    } else {
      if (pendingMultipart) {
        const fullPreview = assembleParts(pendingMultipart.parts, pendingMultipart.totalParts);
        const { __partIndex, __totalParts, ...cleanMsg } = pendingMultipart.baseMsg as any;
        result.push({ ...cleanMsg, imagePreview: fullPreview });
        pendingMultipart = null;
      }
      result.push(entry);
    }
  }

  if (pendingMultipart) {
    const fullPreview = assembleParts(pendingMultipart.parts, pendingMultipart.totalParts);
    const { __partIndex, __totalParts, ...cleanMsg } = (pendingMultipart as any).baseMsg;
    result.push({ ...cleanMsg, imagePreview: fullPreview });
  }

  return result;
}

function assembleParts(parts: Map<number, string>, total: number): string {
  let combined = '';
  for (let i = 0; i < total; i++) {
    combined += parts.get(i) || '';
  }
  return combined;
}

/**
 * Checks if a Firestore document is a message chunk document.
 */
export function isChunkDoc(data: any): boolean {
  if (!data) return false;
  if (typeof data.title === 'string' && data.title.startsWith('__chunk__:')) return true;
  if (typeof data.id === 'string' && data.id.includes('_chk_')) return true;
  return false;
}

/**
 * Parses parentId and chunkIndex from chunk document title or id.
 */
export function parseChunkMeta(data: any): { parentId: string; chunkIndex: number; totalChunks: number } | null {
  if (!data) return null;
  if (typeof data.title === 'string' && data.title.startsWith('__chunk__:')) {
    const parts = data.title.split(':');
    if (parts.length >= 4) {
      return {
        parentId: parts[1],
        chunkIndex: parseInt(parts[2], 10) || 0,
        totalChunks: parseInt(parts[3], 10) || 1,
      };
    }
  }
  if (typeof data.id === 'string' && data.id.includes('_chk_')) {
    const parts = data.id.split('_chk_');
    return {
      parentId: parts[0],
      chunkIndex: parseInt(parts[1], 10) || 0,
      totalChunks: 1,
    };
  }
  return null;
}

export function extractSearchSnippet(text: string, query: string, maxLength = 120): string {
  if (!text) return '';
  const clean = text.replace(/[\r\n]+/g, ' ').trim();
  if (!query) {
    return clean.slice(0, maxLength) + (clean.length > maxLength ? '…' : '');
  }

  const lowerText = clean.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const index = lowerText.indexOf(lowerQuery);

  if (index === -1) {
    return clean.slice(0, maxLength) + (clean.length > maxLength ? '…' : '');
  }

  const start = Math.max(0, index - 40);
  const end = Math.min(clean.length, index + query.length + 60);

  let snippet = clean.slice(start, end).trim();
  if (start > 0) snippet = '…' + snippet;
  if (end < clean.length) snippet = snippet + '…';

  return snippet;
}

class SessionService {
  private sessions: ChatSession[] = [];
  private activeSessionId: string | null = null;
  private subscribers: Set<SessionsSubscriber> = new Set();
  private unsubscribeFirestore: (() => void) | null = null;
  private currentUserId: string | null = null;
  private currentAuthGeneration = 0;
  private sessionChunkIds: Map<string, Set<string>> = new Map();

  constructor() {
    this.activeSessionId = safeLocalStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);

    authService.onAuthStateChanged((user) => {
      this.handleAuthChange(user);
    });
  }

  public getSessions(): ChatSession[] {
    return [...this.sessions];
  }

  public getActiveSession(): ChatSession | null {
    if (!this.activeSessionId) {
      return this.sessions[0] || null;
    }
    return this.sessions.find((s) => s.id === this.activeSessionId) || this.sessions[0] || null;
  }

  public getActiveSessionId(): string | null {
    const active = this.getActiveSession();
    return active ? active.id : null;
  }

  public subscribe(cb: SessionsSubscriber): () => void {
    this.subscribers.add(cb);
    queueMicrotask(() => {
      if (this.subscribers.has(cb)) {
        cb([...this.sessions], this.getActiveSessionId());
      }
    });
    return () => {
      this.subscribers.delete(cb);
    };
  }

  private notify(): void {
    const list = [...this.sessions];
    const activeId = this.getActiveSessionId();
    queueMicrotask(() => {
      for (const sub of this.subscribers) {
        sub(list, activeId);
      }
    });
  }

  public getGuestSessions(): ChatSession[] {
    try {
      const raw = safeLocalStorage.getItem(GUEST_SESSIONS_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  public getMeaningfulGuestSessions(): ChatSession[] {
    const guestSessions = this.getGuestSessions();
    return guestSessions.filter(
      (s) => Array.isArray(s.messages) && s.messages.some((m) => m.sender === 'user')
    );
  }

  private handleAuthChange(user: UserProfile | null): void {
    // Invalidate any in-flight asynchronous operations or snapshots from previous account (SEC-04 Req 6)
    this.currentAuthGeneration++;
    const generation = this.currentAuthGeneration;

    // 1. Immediately unsubscribe from any active Firestore listener (SEC-04 Req 3)
    if (this.unsubscribeFirestore) {
      this.unsubscribeFirestore();
      this.unsubscribeFirestore = null;
    }

    // 2. Clear previous user's in-memory sessions immediately to prevent cross-account leakage (SEC-04 Req 3)
    this.sessions = [];

    // 3. Clear stale activeSessionId from localStorage & state (SEC-04 Req 2)
    safeLocalStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
    this.activeSessionId = null;

    if (user && !user.isGuest) {
      this.currentUserId = user.uid;
      // Auto-migration intentionally removed (SEC-03); explicit user confirmation required via migrationService
      this.initFirestoreListener(user.uid, generation);
    } else {
      this.currentUserId = null;
      this.loadGuestSessions();
    }
  }

  private loadGuestSessions(): void {
    try {
      const raw = safeLocalStorage.getItem(GUEST_SESSIONS_STORAGE_KEY);
      if (raw) {
        this.sessions = JSON.parse(raw);
      } else {
        this.sessions = [];
      }
    } catch {
      this.sessions = [];
    }
    this.ensureAtLeastOneSession();
    this.notify();
  }

  private saveGuestSessions(): void {
    try {
      safeLocalStorage.setItem(GUEST_SESSIONS_STORAGE_KEY, JSON.stringify(this.sessions));
    } catch (e) {
      console.warn('[SHADOW AI Sessions] Failed to save guest sessions:', e);
    }
  }

  private initFirestoreListener(userId: string, generation: number): void {
    const chatsCol = collection(db, 'users', userId, 'chats');

    this.unsubscribeFirestore = onSnapshot(
      chatsCol,
      (snapshot) => {
        // Guard: Discard stale snapshots if user or generation changed (SEC-04 Req 6)
        if (this.currentAuthGeneration !== generation || this.currentUserId !== userId) {
          return;
        }

        const sessionMap = new Map<string, ChatSession>();
        const chunksBySession = new Map<string, { chunkIndex: number; messages: ChatMessage[]; docId: string }[]>();

        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as any;
          if (!data || !data.id) return;

          if (isChunkDoc(data)) {
            const meta = parseChunkMeta(data);
            if (meta) {
              if (!chunksBySession.has(meta.parentId)) {
                chunksBySession.set(meta.parentId, []);
              }
              chunksBySession.get(meta.parentId)!.push({
                chunkIndex: meta.chunkIndex,
                messages: Array.isArray(data.messages) ? data.messages : [],
                docId: docSnap.id,
              });
            }
          } else {
            sessionMap.set(data.id, {
              id: data.id,
              userId: data.userId || userId,
              title: data.title || 'Untitled Session',
              messages: Array.isArray(data.messages) ? data.messages : [],
              createdAt: data.createdAt || new Date().toISOString(),
              updatedAt: data.updatedAt || new Date().toISOString(),
            });
          }
        });

        // Reconstruct sessions and track chunks
        this.sessionChunkIds.clear();
        const loaded: ChatSession[] = [];
        for (const [sessId, session] of sessionMap.entries()) {
          const chunks = chunksBySession.get(sessId);
          if (chunks && chunks.length > 0) {
            const idSet = new Set<string>();
            for (const chk of chunks) {
              idSet.add(chk.docId);
            }
            this.sessionChunkIds.set(sessId, idSet);

            chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
            const flatMessages = chunks.flatMap((c) => c.messages);
            session.messages = reassembleMessages(flatMessages);
          }
          loaded.push(session);
        }

        loaded.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        this.sessions = loaded;

        this.ensureAtLeastOneSession();
        this.notify();
      },
      (error) => {
        if (this.currentAuthGeneration !== generation) return;
        console.warn('[SHADOW AI Sessions] Firestore snapshot notice:', error);
        handleFirestoreError(error, OperationType.GET, `users/${userId}/chats`);
      }
    );
  }

  private ensureAtLeastOneSession(): void {
    if (this.sessions.length === 0) {
      const newSess = this.buildSessionObject('Initial Briefing');
      this.sessions = [newSess];
      this.activeSessionId = newSess.id;
      if (!this.currentUserId) {
        this.saveGuestSessions();
        safeLocalStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, newSess.id);
      }
    } else if (!this.activeSessionId || !this.sessions.some((s) => s.id === this.activeSessionId)) {
      this.activeSessionId = this.sessions[0].id;
      if (!this.currentUserId) {
        safeLocalStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, this.sessions[0].id);
      }
    }
  }

  private buildSessionObject(title: string): ChatSession {
    const now = new Date().toISOString();
    const id = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    return {
      id,
      userId: this.currentUserId || 'guest',
      title,
      messages: [
        {
          id: 'init-1',
          sender: 'shadow',
          text: 'Hello! I am Shadow, your AI assistant. How can I help you today? Feel free to speak in English, Hindi, or Hinglish.',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          modelUsed: 'gemini-3.8-flash',
        },
      ],
      createdAt: now,
      updatedAt: now,
    };
  }

  public async createSession(title = 'New Discussion'): Promise<ChatSession> {
    const newSession = this.buildSessionObject(title);
    this.sessions.unshift(newSession);
    this.activeSessionId = newSession.id;

    safeLocalStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, newSession.id);

    if (this.currentUserId && auth.currentUser) {
      const path = `users/${this.currentUserId}/chats/${newSession.id}`;
      try {
        const { metadataDoc } = chunkSession(newSession, this.currentUserId);
        await setDoc(doc(db, 'users', this.currentUserId, 'chats', newSession.id), metadataDoc);
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, path);
      }
    } else {
      this.saveGuestSessions();
    }

    this.notify();
    return newSession;
  }

  public selectSession(id: string): void {
    const found = this.sessions.find((s) => s.id === id);
    if (found) {
      this.activeSessionId = id;
      safeLocalStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, id);
      this.notify();
    }
  }

  public async updateSessionMessages(id: string, messages: ChatMessage[]): Promise<void> {
    const idx = this.sessions.findIndex((s) => s.id === id);
    if (idx === -1) return;

    const now = new Date().toISOString();
    const session = { ...this.sessions[idx] };

    // Auto-derive title from first user message if still default
    if (session.title === 'New Discussion' || session.title === 'Initial Briefing') {
      const firstUserMsg = messages.find((m) => m.sender === 'user');
      if (firstUserMsg && firstUserMsg.text) {
        session.title = firstUserMsg.text.slice(0, 38).trim() + (firstUserMsg.text.length > 38 ? '…' : '');
      }
    }

    // Keep up to latest 80 messages per session
    session.messages = messages.slice(-80);
    session.updatedAt = now;
    this.sessions[idx] = session;

    if (this.currentUserId && auth.currentUser) {
      const path = `users/${this.currentUserId}/chats/${id}`;
      try {
        const { metadataDoc, chunkDocs } = chunkSession(session, this.currentUserId);
        const batch = writeBatch(db);

        // 1. Write metadata doc
        batch.set(doc(db, 'users', this.currentUserId, 'chats', id), metadataDoc);

        // 2. Track new chunk IDs and write chunk docs
        const newChunkIds = new Set<string>();
        for (const chk of chunkDocs) {
          newChunkIds.add(chk.id);
          batch.set(doc(db, 'users', this.currentUserId, 'chats', chk.id), chk);
        }

        // 3. Delete any obsolete chunk docs if total chunk count decreased
        const prevChunkIds = this.sessionChunkIds.get(id);
        if (prevChunkIds) {
          for (const oldId of prevChunkIds) {
            if (!newChunkIds.has(oldId)) {
              batch.delete(doc(db, 'users', this.currentUserId, 'chats', oldId));
            }
          }
        }

        this.sessionChunkIds.set(id, newChunkIds);
        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, path);
      }
    } else {
      this.saveGuestSessions();
      this.notify();
    }
  }

  public async renameSession(id: string, newTitle: string): Promise<void> {
    const cleanTitle = newTitle.trim().slice(0, 80);
    if (!cleanTitle) return;

    const idx = this.sessions.findIndex((s) => s.id === id);
    if (idx === -1) return;

    this.sessions[idx].title = cleanTitle;
    this.sessions[idx].updatedAt = new Date().toISOString();

    if (this.currentUserId && auth.currentUser) {
      const path = `users/${this.currentUserId}/chats/${id}`;
      try {
        const { metadataDoc } = chunkSession(this.sessions[idx], this.currentUserId);
        await setDoc(doc(db, 'users', this.currentUserId, 'chats', id), metadataDoc);
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, path);
      }
    } else {
      this.saveGuestSessions();
      this.notify();
    }
  }

  public async deleteSession(id: string): Promise<void> {
    this.sessions = this.sessions.filter((s) => s.id !== id);
    this.ensureAtLeastOneSession();

    if (this.currentUserId && auth.currentUser) {
      const path = `users/${this.currentUserId}/chats/${id}`;
      try {
        const batch = writeBatch(db);
        batch.delete(doc(db, 'users', this.currentUserId, 'chats', id));

        const chunkIds = this.sessionChunkIds.get(id);
        if (chunkIds) {
          for (const chkId of chunkIds) {
            batch.delete(doc(db, 'users', this.currentUserId, 'chats', chkId));
          }
          this.sessionChunkIds.delete(id);
        }

        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, path);
      }
    } else {
      this.saveGuestSessions();
    }

    this.notify();
  }

  public exportSession(session: ChatSession, format: 'markdown' | 'json'): void {
    let fileContent = '';
    let mimeType = 'text/plain';
    let extension = 'txt';

    if (format === 'markdown') {
      mimeType = 'text/markdown';
      extension = 'md';
      fileContent = `# SHADOW AI Session: ${session.title}\n`;
      fileContent += `Date: ${new Date(session.updatedAt).toLocaleString()}\n\n---\n\n`;
      for (const msg of session.messages) {
        const senderLabel = msg.sender === 'user' ? '**User**' : '**SHADOW**';
        fileContent += `### ${senderLabel} (${msg.timestamp})\n${msg.text}\n\n`;
      }
    } else {
      mimeType = 'application/json';
      extension = 'json';
      fileContent = JSON.stringify(session, null, 2);
    }

    const blob = new Blob([fileContent], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shadow_session_${session.id}.${extension}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Fast, private, in-memory conversation search across message contents, titles, and speakers.
   * Strictly searches only the currently authorized user's loaded sessions (guest or auth).
   * Generates formatted snippets with surrounding context for matching keywords.
   */
  public searchConversations(rawQuery: string, maxResults = 50): ConversationSearchResult {
    const query = (rawQuery || '').trim();
    if (!query) {
      return {
        query: '',
        totalMatches: 0,
        matchedThreadsCount: 0,
        matches: [],
      };
    }

    const queryLower = query.toLowerCase();
    const queryTokens = queryLower
      .replace(/[^\w\s\u0900-\u097F]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 0);

    const matches: ConversationSearchMatch[] = [];
    const matchedSessionIds = new Set<string>();

    for (const session of this.sessions) {
      const titleLower = (session.title || '').toLowerCase();
      let sessionMatched = false;

      // 1. Thread Title Match
      const titleExact = titleLower.includes(queryLower);
      const titleTokenMatches = queryTokens.filter((tok) => titleLower.includes(tok));
      const titleAllTokens = queryTokens.length > 0 && titleTokenMatches.length === queryTokens.length;

      if (titleExact || titleAllTokens) {
        sessionMatched = true;
        const firstMsg = (session.messages && session.messages[0]) || {
          id: `first-${session.id}`,
          sender: 'shadow' as const,
          text: session.title,
          timestamp: '',
        };
        matches.push({
          sessionId: session.id,
          sessionTitle: session.title,
          sessionUpdatedAt: session.updatedAt,
          messageId: firstMsg.id,
          sender: firstMsg.sender,
          text: firstMsg.text,
          snippet: session.title,
          timestamp: firstMsg.timestamp || '',
          matchType: 'title',
          score: titleExact ? 120 : 80,
        });
      }

      // 2. Message Matches (both user questions and assistant responses)
      if (Array.isArray(session.messages)) {
        for (const msg of session.messages) {
          if (!msg || !msg.text) continue;
          const textLower = msg.text.toLowerCase();

          let matchScore = 0;
          let matchedKeyword = query;

          if (textLower.includes(queryLower)) {
            matchScore += 100;
            // Whole-word boundary boost
            const escaped = queryLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            if (new RegExp(`\\b${escaped}\\b`, 'i').test(textLower)) {
              matchScore += 25;
            }
          } else if (queryTokens.length > 1) {
            const tokenMatches = queryTokens.filter((tok) => textLower.includes(tok));
            if (tokenMatches.length === queryTokens.length) {
              matchScore += 80;
              matchedKeyword = tokenMatches[0];
            } else if (tokenMatches.length > 0) {
              matchScore += (tokenMatches.length / queryTokens.length) * 50;
              matchedKeyword = tokenMatches[0];
            }
          } else if (queryTokens.length === 1 && textLower.includes(queryTokens[0])) {
            matchScore += 65;
            matchedKeyword = queryTokens[0];
          }

          if (matchScore > 0) {
            sessionMatched = true;
            matches.push({
              sessionId: session.id,
              sessionTitle: session.title,
              sessionUpdatedAt: session.updatedAt,
              messageId: msg.id,
              sender: msg.sender,
              text: msg.text,
              snippet: extractSearchSnippet(msg.text, matchedKeyword),
              timestamp: msg.timestamp || '',
              matchType: 'content',
              score: matchScore,
            });
          }
        }
      }

      if (sessionMatched) {
        matchedSessionIds.add(session.id);
      }
    }

    // Sort by relevance score descending, then by session recency
    matches.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return new Date(b.sessionUpdatedAt).getTime() - new Date(a.sessionUpdatedAt).getTime();
    });

    return {
      query,
      totalMatches: matches.length,
      matchedThreadsCount: matchedSessionIds.size,
      matches: matches.slice(0, maxResults),
    };
  }

  public resetForAccountDeletion(): void {
    if (this.unsubscribeFirestore) {
      this.unsubscribeFirestore();
      this.unsubscribeFirestore = null;
    }
    this.currentUserId = null;
    this.sessions = [];
    this.activeSessionId = null;
    this.sessionChunkIds.clear();
    safeLocalStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
    safeLocalStorage.removeItem(GUEST_SESSIONS_STORAGE_KEY);
    this.ensureAtLeastOneSession();
    this.notify();
  }

  // Test inspection and mock hooks (isolated testing only)
  public getCurrentUserId(): string | null {
    return this.currentUserId;
  }

  public getCurrentAuthGeneration(): number {
    return this.currentAuthGeneration;
  }

  public hasActiveFirestoreListener(): boolean {
    return this.unsubscribeFirestore !== null;
  }

  public setFirestoreListenerMock(unsub: () => void): void {
    this.unsubscribeFirestore = unsub;
  }

  public handleAuthChangeForTesting(user: UserProfile | null, skipFirestore = false): void {
    this.sessionChunkIds.clear();
    if (skipFirestore) {
      this.currentAuthGeneration++;
      if (this.unsubscribeFirestore) {
        this.unsubscribeFirestore();
        this.unsubscribeFirestore = null;
      }
      this.sessions = [];
      safeLocalStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
      this.activeSessionId = null;
      if (user && !user.isGuest) {
        this.currentUserId = user.uid;
      } else {
        this.currentUserId = null;
      }
      return;
    }
    this.handleAuthChange(user);
  }

  public setSessionsForTesting(sessions: ChatSession[]): void {
    this.sessions = [...sessions];
    this.ensureAtLeastOneSession();
    this.notify();
  }
}

export const sessionService = new SessionService();
