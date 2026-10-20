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
   * Save or update an individual long-term memory
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

    // Extract search tags
    const words = cleanContent
      .toLowerCase()
      .replace(/[^\w\s\u0900-\u097F]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 2);
    const tags = Array.from(new Set(words)).slice(0, 15);

    const memoryId = existingId || `mem-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();
    const existing = existingId ? this.memories.find((m) => m.id === existingId) : undefined;
    const createdAt = existing ? existing.createdAt : now;

    const mem: MemoryDocument = {
      id: memoryId,
      userId: this.currentUserId || 'guest',
      content: cleanContent,
      category,
      tags,
      provenance,
      confidence,
      createdAt,
      updatedAt: now,
    };

    if (this.currentUserId && auth.currentUser) {
      const path = `users/${this.currentUserId}/memories/${memoryId}`;
      try {
        await setDoc(doc(db, 'users', this.currentUserId, 'memories', memoryId), mem);
      } catch (err) {
        handleFirestoreError(err, existingId ? OperationType.UPDATE : OperationType.CREATE, path);
      }
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
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, path);
      }
    } else {
      this.memories = this.memories.filter((m) => m.id !== id);
      this.saveGuestMemories();
      this.notify();
    }
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
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `users/${this.currentUserId}/memories`);
      }
    } else {
      this.memories = [];
      this.saveGuestMemories();
      this.notify();
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
      this.memories = [];
      this.notify();
      return result;
    } finally {
      this.isDeletionInProgress = false;
    }
  }

  /**
   * Retrieve relevant user memories for current query context.
   * Performs lexical and keyword scoring to supply optimal context without exceeding model tokens.
   */
  public getRelevantMemories(prompt: string, maxItems = 6): MemoryDocument[] {
    if (this.memories.length === 0) return [];

    const queryTokens = prompt
      .toLowerCase()
      .replace(/[^\w\s\u0900-\u097F]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2);

    if (queryTokens.length === 0) {
      return this.memories.slice(0, 3);
    }

    const scored = this.memories.map((mem) => {
      let score = 0;
      const contentLower = mem.content.toLowerCase();

      for (const token of queryTokens) {
        if (mem.tags.includes(token)) score += 3;
        if (contentLower.includes(token)) score += 2;
      }

      // Explicit instructions and preferences carry baseline weight
      if (mem.category === 'instruction') score += 1.5;
      if (mem.category === 'preference') score += 1.0;

      return { mem, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored
      .filter((item) => item.score > 0.5)
      .slice(0, maxItems)
      .map((item) => item.mem);
  }

  /**
   * Formats relevant memories into a clean prompt context block
   */
  public formatContextForPrompt(prompt: string): string {
    const relevant = this.getRelevantMemories(prompt, 6);
    if (relevant.length === 0) return '';

    const lines = relevant.map((m) => `- [${m.category.toUpperCase()}] ${m.content}`);
    return `\n\n[USER LONG-TERM MEMORY & CONTEXT]\n${lines.join('\n')}\n(Utilize these facts naturally when relevant. Never invent memories not listed here.)`;
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
