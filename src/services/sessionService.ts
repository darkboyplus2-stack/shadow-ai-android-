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

class SessionService {
  private sessions: ChatSession[] = [];
  private activeSessionId: string | null = null;
  private subscribers: Set<SessionsSubscriber> = new Set();
  private unsubscribeFirestore: (() => void) | null = null;
  private currentUserId: string | null = null;
  private currentAuthGeneration = 0;

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

        const loaded: ChatSession[] = [];
        snapshot.forEach((docSnap) => {
          loaded.push(docSnap.data() as ChatSession);
        });
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
        await setDoc(doc(db, 'users', this.currentUserId, 'chats', newSession.id), newSession);
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
        await setDoc(doc(db, 'users', this.currentUserId, 'chats', id), session);
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
        await setDoc(doc(db, 'users', this.currentUserId, 'chats', id), this.sessions[idx]);
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
        await deleteDoc(doc(db, 'users', this.currentUserId, 'chats', id));
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

  public resetForAccountDeletion(): void {
    if (this.unsubscribeFirestore) {
      this.unsubscribeFirestore();
      this.unsubscribeFirestore = null;
    }
    this.currentUserId = null;
    this.sessions = [];
    this.activeSessionId = null;
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

  public handleAuthChangeForTesting(user: UserProfile | null): void {
    this.handleAuthChange(user);
  }

  public setSessionsForTesting(sessions: ChatSession[]): void {
    this.sessions = [...sessions];
    this.ensureAtLeastOneSession();
    this.notify();
  }
}

export const sessionService = new SessionService();
