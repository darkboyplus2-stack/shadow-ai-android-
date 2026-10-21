import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  getDocs,
  query,
  limit,
  writeBatch,
} from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from './firebase';
import { authService, UserProfile } from './authService';
import { offlineSyncService } from './offlineSyncService';

export type MemoryCategory = 'preference' | 'project' | 'instruction' | 'constraint' | 'fact';
export type MemoryProvenance = 'explicit_user' | 'implicit_inference';

export interface MemoryDocument {
  id: string;
  userId: string;
  content: string;
  category: MemoryCategory;
  tags: string[];
  provenance: MemoryProvenance;
  confidence: number;
  createdAt: string;
  updatedAt: string;
}

export type MemoriesSubscriber = (memories: MemoryDocument[]) => void;
export type SyncStatus = 'offline' | 'guest' | 'syncing' | 'synced' | 'error';

export const GUEST_STORAGE_KEY = 'shadow_guest_memories';
export const AUTO_MEMORY_CONFIG_KEY = 'shadow_auto_memory_enabled';

/**
 * Validates whether candidate content contains sensitive credentials, keys, or passwords.
 */
export function isSensitiveSecret(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  const patterns = [
    /AIza[0-9A-Za-z-_]{35}/i,
    /gh[pousr]_[0-9A-Za-z]{36}/i,
    /sk-[a-zA-Z0-9_-]{20,}/i,
    /Bearer\s+[a-zA-Z0-9_\-\.]{20,}/i,
    /eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}/i,
    /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/i,
    /(?:password|passwd|api[_-]?key|secret[_-]?key|auth[_-]?token)\s*[:=]\s*\S+/i,
  ];
  return patterns.some((p) => p.test(text));
}

/**
 * Conversational and grammatical stop words excluded from topical indexing.
 */
export const CONVERSATIONAL_STOP_WORDS = new Set([
  'the', 'is', 'at', 'which', 'on', 'and', 'a', 'an', 'in', 'to', 'for', 'of', 'or', 'by',
  'with', 'about', 'can', 'you', 'please', 'tell', 'me', 'what', 'how', 'why', 'when',
  'where', 'who', 'does', 'did', 'do', 'will', 'would', 'could', 'should', 'give', 'show',
  'kaisa', 'kya', 'hai', 'batao', 'karo', 'mujhe', 'mera', 'meri', 'mere', 'aap', 'tum',
  'this', 'that', 'these', 'those', 'there', 'here', 'from', 'into', 'just', 'some', 'any',
  'know', 'have', 'been', 'want', 'need', 'like', 'help', 'your', 'my', 'we', 'he', 'so',
  'no', 'up', 'as', 'if', 'it', 'ki', 'ka', 'ke', 'ko', 'se', 'bhi', 'tha', 'thi', 'the',
]);

const safeLocalStorage = {
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

export interface DeletionResult {
  success: boolean;
  deletedCollections: string[];
  totalDeleted: number;
}

export interface FirestoreDeletionAdapter {
  getCollectionDocs: (collectionName: string) => Promise<{ id: string; ref: any }[]>;
  commitDeleteBatch: (refs: any[]) => Promise<void>;
  verifyCollectionEmpty: (collectionName: string) => Promise<boolean>;
}

export const COLLECTIONS_TO_PURGE = ['memories', 'chats', 'settings'] as const;
export const FIRESTORE_MAX_BATCH_SIZE = 450;

/**
 * Pure execution function for cloud account data cleanup.
 * Guarantees chunked deletions under Firestore's 500-write limit,
 * strict failure propagation without silent swallowing, explicit verification
 * that all collections are empty, and non-atomic failure explanations.
 */
export async function purgeAccountCollections(
  userId: string,
  adapter?: FirestoreDeletionAdapter,
  batchSize = FIRESTORE_MAX_BATCH_SIZE
): Promise<DeletionResult> {
  if (!userId) {
    throw new Error('User ID is required for cloud account data deletion.');
  }

  const effectiveAdapter: FirestoreDeletionAdapter = adapter || {
    getCollectionDocs: async (sub) => {
      const colRef = collection(db, 'users', userId, sub);
      const snap = await getDocs(colRef);
      return snap.docs.map((d) => ({ id: d.id, ref: d.ref }));
    },
    commitDeleteBatch: async (refs) => {
      const batch = writeBatch(db);
      refs.forEach((ref) => batch.delete(ref));
      await batch.commit();
    },
    verifyCollectionEmpty: async (sub) => {
      const colRef = collection(db, 'users', userId, sub);
      const checkSnap = await getDocs(query(colRef, limit(1)));
      return checkSnap.empty;
    },
  };

  const deletedCollections: string[] = [];
  let totalDeleted = 0;

  // 1. Batch deletion phase
  for (const sub of COLLECTIONS_TO_PURGE) {
    let docs: { id: string; ref: any }[];
    try {
      docs = await effectiveAdapter.getCollectionDocs(sub);
    } catch (readErr: any) {
      throw new Error(
        `Failed to retrieve documents from collection "${sub}": ${readErr?.message || readErr}. Deletion is not atomic; some cloud records may have already been removed. Please retry the cleanup.`
      );
    }

    if (docs.length > 0) {
      for (let i = 0; i < docs.length; i += batchSize) {
        const chunk = docs.slice(i, i + batchSize);
        try {
          await effectiveAdapter.commitDeleteBatch(chunk.map((d) => d.ref));
          totalDeleted += chunk.length;
        } catch (batchErr: any) {
          throw new Error(
            `Failed to commit batch deletion on collection "${sub}" (documents ${i + 1} to ${i + chunk.length} of ${docs.length}): ${batchErr?.message || batchErr}. Deletion is not atomic; some cloud records may have already been removed. Please retry the cleanup.`
          );
        }
      }
    }
    deletedCollections.push(sub);
  }

  // 2. Verification phase (Ensures collections are completely empty)
  for (const sub of COLLECTIONS_TO_PURGE) {
    let isEmpty: boolean;
    try {
      isEmpty = await effectiveAdapter.verifyCollectionEmpty(sub);
    } catch (verifyErr: any) {
      throw new Error(
        `Failed to verify deletion status for collection "${sub}": ${verifyErr?.message || verifyErr}. Deletion is not atomic; some cloud records may have already been removed. Please retry the cleanup.`
      );
    }

    if (!isEmpty) {
      throw new Error(
        `Deletion verification failed: Collection "${sub}" still contains remaining records after deletion attempt. Deletion is not atomic; some cloud records may have already been removed. Please retry the cleanup.`
      );
    }
  }

  return {
    success: true,
    deletedCollections,
    totalDeleted,
  };
}

class MemoryService {
  private memories: MemoryDocument[] = [];
  private subscribers: Set<MemoriesSubscriber> = new Set();
  private unsubscribeFirestore: (() => void) | null = null;
  private currentUserId: string | null = null;
  private syncStatus: SyncStatus = 'guest';
  private autoMemoryEnabled: boolean = true;
  private isDeletionInProgress = false;
  private currentAuthGeneration = 0;

  constructor() {
    // Load local configuration
    const storedConfig = safeLocalStorage.getItem(AUTO_MEMORY_CONFIG_KEY);
    this.autoMemoryEnabled = storedConfig !== null ? storedConfig === 'true' : true;

    // Subscribe to Auth changes
    authService.onAuthStateChanged((user) => {
      this.handleAuthChange(user);
    });
  }

  public getMemories(): MemoryDocument[] {
    return [...this.memories];
  }

  public getSyncStatus(): SyncStatus {
    return this.syncStatus;
  }

  public isAutoMemoryEnabled(): boolean {
    return this.autoMemoryEnabled;
  }

  public setAutoMemoryEnabled(enabled: boolean): void {
    this.autoMemoryEnabled = enabled;
    safeLocalStorage.setItem(AUTO_MEMORY_CONFIG_KEY, String(enabled));
  }

  public subscribe(cb: MemoriesSubscriber): () => void {
    this.subscribers.add(cb);
    queueMicrotask(() => {
      if (this.subscribers.has(cb)) {
        cb([...this.memories]);
      }
    });
    return () => {
      this.subscribers.delete(cb);
    };
  }

  private notify(): void {
    const list = [...this.memories];
    queueMicrotask(() => {
      for (const sub of this.subscribers) {
        sub(list);
      }
    });
  }

  public getGuestMemories(): MemoryDocument[] {
    try {
      const raw = safeLocalStorage.getItem(GUEST_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  private handleAuthChange(user: UserProfile | null): void {
    // Invalidate any in-flight asynchronous operations or snapshots from previous account (SEC-04 Req 6)
    this.currentAuthGeneration++;
    const generation = this.currentAuthGeneration;

    if (this.unsubscribeFirestore) {
      this.unsubscribeFirestore();
      this.unsubscribeFirestore = null;
    }

    // Immediately clear in-memory state to prevent cross-account flash or leakage
    this.memories = [];

    if (user && !user.isGuest) {
      this.currentUserId = user.uid;
      this.syncStatus = 'syncing';
      // Auto-migration intentionally removed (SEC-03); explicit user confirmation required via migrationService
      this.initFirestoreListener(user.uid, generation);
    } else {
      this.currentUserId = null;
      this.syncStatus = 'guest';
      this.loadGuestMemories();
    }
  }

  private loadGuestMemories(): void {
    try {
      const raw = safeLocalStorage.getItem(GUEST_STORAGE_KEY);
      if (raw) {
        this.memories = JSON.parse(raw);
      } else {
        this.memories = [];
      }
      this.notify();
    } catch {
      this.memories = [];
      this.notify();
    }
  }

  private saveGuestMemories(): void {
    try {
      safeLocalStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(this.memories));
    } catch (e) {
      console.warn('[SHADOW AI Memory] Failed to save guest memories:', e);
    }
  }

  private initFirestoreListener(userId: string, generation: number): void {
    const memoriesCol = collection(db, 'users', userId, 'memories');
    this.syncStatus = 'syncing';

    this.unsubscribeFirestore = onSnapshot(
      memoriesCol,
      (snapshot) => {
        // Guard: Discard stale snapshots if user or generation changed (SEC-04 Req 6)
        if (this.currentAuthGeneration !== generation || this.currentUserId !== userId) {
          return;
        }

        const loaded: MemoryDocument[] = [];
        snapshot.forEach((docSnap) => {
          loaded.push(docSnap.data() as MemoryDocument);
        });
        // Sort newest first
        loaded.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        this.memories = loaded;
        this.syncStatus = 'synced';
        this.notify();
      },
      (error) => {
        if (this.currentAuthGeneration !== generation) return;
        console.warn('[SHADOW AI Memory] Firestore snapshot notice:', error);
        this.syncStatus = 'error';
        handleFirestoreError(error, OperationType.GET, `users/${userId}/memories`);
      }
    );
  }

  /**
   * Save or update an individual long-term memory.
   * Enforces security (rejects secrets), deduplication, and conflict resolution.
   */
  public async saveMemory(
    content: string,
    category: MemoryCategory = 'preference',
    provenance: MemoryProvenance = 'explicit_user',
    existingId?: string,
    confidence = 1.0
  ): Promise<MemoryDocument> {
    const cleanContent = content.trim();
    if (!cleanContent) {
      throw new Error('Memory content cannot be empty.');
    }

    // Security guard: Never store sensitive credentials, tokens, or passwords
    if (isSensitiveSecret(cleanContent)) {
      throw new Error('Sensitive credentials, tokens, or passwords cannot be stored in conversation memory for security.');
    }

    // Extract normalized search tags excluding conversational stop words
    const words = cleanContent
      .toLowerCase()
      .replace(/[^\w\s\u0900-\u097F]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1 && !CONVERSATIONAL_STOP_WORDS.has(w));
    const tags = Array.from(new Set(words)).slice(0, 15);

    // Smart deduplication: check if an identical or near-duplicate memory already exists
    let effectiveId = existingId;
    if (!effectiveId) {
      const incomingNorm = cleanContent.toLowerCase().replace(/[^\w\u0900-\u097F]/g, '');
      const duplicate = this.memories.find((m) => {
        const mNorm = m.content.toLowerCase().replace(/[^\w\u0900-\u097F]/g, '');
        if (mNorm === incomingNorm) return true;
        // Jaccard similarity of tags for matching category
        if (m.category === category && tags.length > 0 && m.tags.length > 0) {
          const mTagSet = new Set(m.tags);
          const shared = tags.filter((t) => mTagSet.has(t));
          const union = new Set([...tags, ...m.tags]);
          if (shared.length / union.size >= 0.7) return true;
        }
        return false;
      });

      if (duplicate) {
        effectiveId = duplicate.id;
      }
    }

    const memoryId = effectiveId || `mem-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();
    const existing = effectiveId ? this.memories.find((m) => m.id === effectiveId) : undefined;
    const createdAt = existing ? existing.createdAt : now;
    const effectiveProvenance = provenance === 'explicit_user' || existing?.provenance === 'explicit_user' ? 'explicit_user' : provenance;
    const effectiveConfidence = Math.max(existing?.confidence || 0.85, confidence);

    const mem: MemoryDocument = {
      id: memoryId,
      userId: this.currentUserId || 'guest',
      content: cleanContent,
      category,
      tags,
      provenance: effectiveProvenance,
      confidence: Math.min(1.0, effectiveConfidence),
      createdAt,
      updatedAt: now,
    };

    if (this.currentUserId && auth.currentUser) {
      const path = `users/${this.currentUserId}/memories/${memoryId}`;
      try {
        await setDoc(doc(db, 'users', this.currentUserId, 'memories', memoryId), mem);
      } catch (err: any) {
        // Queue operation safely for background reconciliation upon reconnecting
        offlineSyncService.queueMemorySave(this.currentUserId, mem);
        console.warn(`[SHADOW AI Memory] Queued offline memory save for user ${this.currentUserId}:`, err?.message || err);
      }
      // Keep in-memory list updated for immediate responsiveness
      const idx = this.memories.findIndex((m) => m.id === memoryId);
      if (idx >= 0) {
        this.memories[idx] = mem;
      } else {
        this.memories.unshift(mem);
      }
      this.notify();
    } else {
      // Guest local storage
      const idx = this.memories.findIndex((m) => m.id === memoryId);
      if (idx >= 0) {
        this.memories[idx] = mem;
      } else {
        this.memories.unshift(mem);
      }
      this.saveGuestMemories();
      this.notify();
    }

    return mem;
  }

  /**
   * Delete a specific memory by ID
   */
  public async deleteMemory(id: string): Promise<void> {
    if (this.currentUserId && auth.currentUser) {
      const path = `users/${this.currentUserId}/memories/${id}`;
      try {
        await deleteDoc(doc(db, 'users', this.currentUserId, 'memories', id));
      } catch (err: any) {
        offlineSyncService.queueMemoryDelete(this.currentUserId, id);
        console.warn(`[SHADOW AI Memory] Queued offline memory delete for user ${this.currentUserId}:`, err?.message || err);
      }
      this.memories = this.memories.filter((m) => m.id !== id);
      this.notify();
    } else {
      this.memories = this.memories.filter((m) => m.id !== id);
      this.saveGuestMemories();
      this.notify();
    }
  }

  /**
   * Search and delete user memories matching a topic query (for explicit Forget commands).
   * Guarantees deleted items are immediately removed from both memory state and persistent storage.
   */
  public async forgetMemoryByQuery(queryStr: string): Promise<{ deleted: MemoryDocument[]; count: number }> {
    const cleanQuery = queryStr.trim().toLowerCase();
    if (!cleanQuery) return { deleted: [], count: 0 };

    const queryTokens = cleanQuery
      .replace(/[^\w\s\u0900-\u097F]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !CONVERSATIONAL_STOP_WORDS.has(w));

    const matched = this.memories.filter((mem) => {
      const contentLower = mem.content.toLowerCase();
      // Direct substring match
      if (contentLower.includes(cleanQuery)) return true;
      // Match query tokens against content or tags
      if (queryTokens.length > 0) {
        const tokenMatches = queryTokens.filter(
          (t) => mem.tags.includes(t) || contentLower.includes(t)
        );
        if (tokenMatches.length >= Math.min(2, queryTokens.length)) return true;
      }
      return false;
    });

    if (matched.length === 0) {
      return { deleted: [], count: 0 };
    }

    // Delete each matched memory
    for (const mem of matched) {
      await this.deleteMemory(mem.id);
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('shadow:memory-deleted', { detail: { count: matched.length } }));
    }

    return { deleted: matched, count: matched.length };
  }

  /**
   * Clear all memories for current user (chunked into safe batches)
   */
  public async clearAllMemories(): Promise<void> {
    if (this.currentUserId && auth.currentUser) {
      try {
        const snapshot = await getDocs(collection(db, 'users', this.currentUserId, 'memories'));
        const docs = snapshot.docs;
        const batchSize = FIRESTORE_MAX_BATCH_SIZE;
        for (let i = 0; i < docs.length; i += batchSize) {
          const chunk = docs.slice(i, i + batchSize);
          const batch = writeBatch(db);
          chunk.forEach((snap) => {
            batch.delete(snap.ref);
          });
          await batch.commit();
        }
        this.memories = [];
        this.notify();
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `users/${this.currentUserId}/memories`);
      }
    } else {
      this.memories = [];
      this.saveGuestMemories();
      this.notify();
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('shadow:memory-cleared'));
    }
  }

  public isAccountDeletionInProgress(): boolean {
    return this.isDeletionInProgress;
  }

  /**
   * Delete complete account data from cloud (memories, chats, settings)
   * Strictly respects 500-write batch limit, verifies empty state, prevents concurrent calls,
   * and propagates any failure with details on non-atomic partial deletion.
   */
  public async deleteAllAccountData(
    userId: string,
    customAdapter?: FirestoreDeletionAdapter
  ): Promise<DeletionResult> {
    if (this.isDeletionInProgress) {
      throw new Error('An account deletion request is already in progress. Please wait.');
    }

    this.isDeletionInProgress = true;
    try {
      const result = await purgeAccountCollections(userId, customAdapter);
      offlineSyncService.clearUserOperations(userId);
      this.memories = [];
      this.notify();
      return result;
    } finally {
      this.isDeletionInProgress = false;
    }
  }

  /**
   * Retrieve relevant user memories for current query context.
   * Performs semantic topic matching, recency prioritization, and conflict filtering.
   * Strictly returns [] if no memories match the current topic.
   */
  public getRelevantMemories(prompt: string, maxItems = 4): MemoryDocument[] {
    if (this.memories.length === 0) return [];

    const promptClean = prompt.trim();
    if (!promptClean) return [];

    const promptLower = promptClean.toLowerCase();

    // 1. General meta-inquiry about overall user memory or profile (without specific topic constraint)
    const isGeneralMetaQuery = /^(?:please\s+)?(?:what\s+do\s+you\s+remember(?:\s+(?:about\s+me|about\s+us))?|what\s+are\s+my\s+memories|who\s+am\s+i|mere\s+baare\s+me(?:n)?(?:\s+kya\s+yaad\s+hai)?|kya\s+yaad\s+hai(?:\s+kuch)?|list\s+(?:all\s+)?(?:my\s+)?memories|show\s+(?:all\s+)?(?:my\s+)?memories|what\s+do\s+you\s+know\s+about\s+me|do\s+you\s+remember\s+me)[.!?\s]*$/i.test(promptClean);

    if (isGeneralMetaQuery) {
      // Return top explicit, high-confidence memories sorted by recency
      return [...this.memories]
        .sort((a, b) => {
          if (a.provenance === 'explicit_user' && b.provenance !== 'explicit_user') return -1;
          if (b.provenance === 'explicit_user' && a.provenance !== 'explicit_user') return 1;
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        })
        .slice(0, maxItems);
    }

    // 2. Extract normalized query tokens excluding conversational stop words (preserves 2+ letter tech tokens like ui, ts, js, db, os)
    const queryTokens = promptClean
      .toLowerCase()
      .replace(/[^\w\s\u0900-\u097F]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1 && !CONVERSATIONAL_STOP_WORDS.has(w));

    // If query has no topical tokens, do NOT inject memories (avoid spamming unrelated context)
    if (queryTokens.length === 0) {
      return [];
    }

    const scored = this.memories.map((mem) => {
      let matchScore = 0;
      const contentLower = mem.content.toLowerCase();

      for (const token of queryTokens) {
        if (mem.tags.includes(token)) {
          matchScore += 4.0;
        } else if (contentLower.includes(token)) {
          // Check for word boundary vs substring
          const isWordMatch = new RegExp(`\\b${token}\\b`, 'i').test(contentLower);
          matchScore += isWordMatch ? 3.5 : 1.5;
        }
      }

      // If no query tokens matched the memory, score is 0
      if (matchScore === 0) {
        return { mem, score: 0 };
      }

      // Category topical alignment boost
      let categoryBoost = 0;
      if (mem.category === 'preference' && /(?:prefer|like|favorite|choice|style|aesthetic|theme)/i.test(promptLower)) {
        categoryBoost += 1.5;
      } else if (mem.category === 'project' && /(?:project|app|building|repo|work|task|codebase|stack)/i.test(promptLower)) {
        categoryBoost += 1.5;
      } else if (mem.category === 'instruction' && /(?:instruction|rule|directive|format|always|never|guideline)/i.test(promptLower)) {
        categoryBoost += 1.5;
      } else if (mem.category === 'constraint' && /(?:constraint|limit|system|hardware|ram|cpu|bandwidth|os)/i.test(promptLower)) {
        categoryBoost += 1.5;
      } else if (mem.category === 'fact' && /(?:who|name|city|location|live|role|company|profession)/i.test(promptLower)) {
        categoryBoost += 1.5;
      }

      // Importance boost for explicit user directives
      let importanceBoost = 0;
      if (mem.provenance === 'explicit_user') importanceBoost += 2.0;

      // Recency boost (within 7 days = +1.0, within 30 days = +0.5)
      const ageMs = Date.now() - new Date(mem.updatedAt).getTime();
      let recencyBoost = 0;
      if (ageMs < 7 * 86400 * 1000) recencyBoost += 1.0;
      else if (ageMs < 30 * 86400 * 1000) recencyBoost += 0.5;

      const finalScore = (matchScore + categoryBoost + importanceBoost + recencyBoost) * (mem.confidence || 1.0);
      return { mem, score: finalScore };
    });

    // Score threshold: require authentic topical match (score >= 2.5)
    const filtered = scored.filter((item) => item.score >= 2.5);
    filtered.sort((a, b) => b.score - a.score);

    // Contradiction and redundancy resolution: group by semantic domain key
    const finalMemories: MemoryDocument[] = [];
    const seenDomains = new Set<string>();

    for (const item of filtered) {
      const primaryTag = item.mem.tags[0] || 'general';
      const domainKey = `${item.mem.category}:${primaryTag}`;
      if (seenDomains.has(domainKey)) {
        // Discard older/superseded conflicting preference in same domain
        continue;
      }
      seenDomains.add(domainKey);
      finalMemories.push(item.mem);
      if (finalMemories.length >= maxItems) break;
    }

    return finalMemories;
  }

  /**
   * Formats relevant memories into a clean prompt context block.
   * Returns empty string if no relevant memories exist.
   */
  public formatContextForPrompt(prompt: string): string {
    const relevant = this.getRelevantMemories(prompt, 4);
    if (relevant.length === 0) return '';

    const lines = relevant.map((m) => `- [${m.category.toUpperCase()}] ${m.content}`);
    return `\n\n[USER LONG-TERM MEMORY & CONTEXT]\n${lines.join('\n')}\n(Utilize these facts naturally when relevant. Never invent unrecorded memories or speculate about unlisted details.)`;
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

  public setMemoriesForTesting(memories: MemoryDocument[]): void {
    this.memories = [...memories];
    this.notify();
  }
}

export const memoryService = new MemoryService();
