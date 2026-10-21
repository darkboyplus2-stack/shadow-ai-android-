import { collection, doc, writeBatch, getDocs } from 'firebase/firestore';
import { db } from './firebase';
import { memoryService, MemoryDocument, GUEST_STORAGE_KEY } from './memoryService';
import {
  sessionService,
  ChatSession,
  GUEST_SESSIONS_STORAGE_KEY,
  chunkSession,
  calculateDocumentByteSize,
  FIRESTORE_MAX_DOCUMENT_BYTES,
} from './sessionService';
import { authService } from './authService';

export interface PendingGuestData {
  memories: MemoryDocument[];
  sessions: ChatSession[];
  hasData: boolean;
  summary: {
    memoryCount: number;
    sessionCount: number;
  };
}

export interface MigrationSummary {
  success: boolean;
  migratedMemoriesCount: number;
  migratedSessionsCount: number;
  targetUserId: string;
}

export interface MigrationStorageAdapter {
  getGuestMemories: () => MemoryDocument[];
  getGuestSessions: () => ChatSession[];
  saveCloudMemories: (userId: string, memories: MemoryDocument[]) => Promise<void>;
  saveCloudSessions?: (userId: string, sessions: ChatSession[]) => Promise<void>;
  saveRawSessionDocs?: (userId: string, docs: { id: string; data: any; byteSize: number }[]) => Promise<void>;
  clearGuestStorage: () => void;
}

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

const safeSessionStorage = {
  getItem: (key: string): string | null => {
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) return window.sessionStorage.getItem(key);
      if (typeof globalThis !== 'undefined' && (globalThis as any).sessionStorage) return (globalThis as any).sessionStorage.getItem(key);
    } catch {}
    return null;
  },
  setItem: (key: string, value: string): void => {
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) { window.sessionStorage.setItem(key, value); return; }
      if (typeof globalThis !== 'undefined' && (globalThis as any).sessionStorage) { (globalThis as any).sessionStorage.setItem(key, value); return; }
    } catch {}
  },
  removeItem: (key: string): void => {
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) { window.sessionStorage.removeItem(key); return; }
      if (typeof globalThis !== 'undefined' && (globalThis as any).sessionStorage) { (globalThis as any).sessionStorage.removeItem(key); return; }
    } catch {}
  },
};

export const MIGRATION_BATCH_LIMIT = 450;

class MigrationService {
  private isMigrationInProgress = false;

  /**
   * Inspects local storage for pending unimported guest data (memories and meaningful conversations).
   * Automatically deduplicates records and filters out blank starter sessions.
   */
  public getPendingGuestData(adapter?: MigrationStorageAdapter): PendingGuestData {
    let rawMemories: MemoryDocument[] = [];
    let rawSessions: ChatSession[] = [];

    if (adapter) {
      rawMemories = adapter.getGuestMemories();
      rawSessions = adapter.getGuestSessions();
    } else {
      try {
        const memStr = safeLocalStorage.getItem(GUEST_STORAGE_KEY);
        if (memStr) rawMemories = JSON.parse(memStr);
      } catch {
        rawMemories = [];
      }

      try {
        const sessStr = safeLocalStorage.getItem(GUEST_SESSIONS_STORAGE_KEY);
        if (sessStr) rawSessions = JSON.parse(sessStr);
      } catch {
        rawSessions = [];
      }
    }

    // Deduplicate memories by id
    const memMap = new Map<string, MemoryDocument>();
    for (const m of rawMemories) {
      if (m && m.id && m.content) {
        memMap.set(m.id, m);
      }
    }
    const memories = Array.from(memMap.values());

    // Deduplicate sessions and filter out empty or placeholder sessions where user never spoke
    const sessMap = new Map<string, ChatSession>();
    for (const s of rawSessions) {
      if (s && s.id && Array.isArray(s.messages) && s.messages.some((m) => m.sender === 'user')) {
        sessMap.set(s.id, s);
      }
    }
    const meaningfulSessions = Array.from(sessMap.values());

    const hasData = memories.length > 0 || meaningfulSessions.length > 0;

    return {
      memories,
      sessions: meaningfulSessions,
      hasData,
      summary: {
        memoryCount: memories.length,
        sessionCount: meaningfulSessions.length,
      },
    };
  }

  /**
   * Imports local guest data into the specified Google authenticated account.
   * Enforces explicit confirmation, deduplication, batching (<= 450 writes per batch),
   * and clears guest storage strictly upon full success.
   */
  public async importGuestDataToUser(
    userId: string,
    adapter?: MigrationStorageAdapter,
    batchSize = MIGRATION_BATCH_LIMIT
  ): Promise<MigrationSummary> {
    if (!userId) {
      throw new Error('User ID is required for guest data migration.');
    }
    if (this.isMigrationInProgress) {
      throw new Error('Migration is already in progress.');
    }

    this.isMigrationInProgress = true;
    try {
      const pending = this.getPendingGuestData(adapter);
      if (!pending.hasData) {
        return {
          success: true,
          migratedMemoriesCount: 0,
          migratedSessionsCount: 0,
          targetUserId: userId,
        };
      }

      if (adapter) {
        // Test adapter path
        if (pending.memories.length > 0) {
          await adapter.saveCloudMemories(userId, pending.memories);
        }
        if (pending.sessions.length > 0) {
          if (adapter.saveRawSessionDocs) {
            const allSessionDocs: { id: string; data: any; byteSize: number }[] = [];
            for (const sess of pending.sessions) {
              const { metadataDoc, chunkDocs } = chunkSession(sess, userId);
              allSessionDocs.push({
                id: metadataDoc.id,
                data: metadataDoc,
                byteSize: calculateDocumentByteSize(metadataDoc),
              });
              for (const chk of chunkDocs) {
                allSessionDocs.push({
                  id: chk.id,
                  data: chk,
                  byteSize: calculateDocumentByteSize(chk),
                });
              }
            }
            await adapter.saveRawSessionDocs(userId, allSessionDocs);
          }
          if (adapter.saveCloudSessions) {
            await adapter.saveCloudSessions(userId, pending.sessions);
          }
        }
        adapter.clearGuestStorage();
      } else {
        // Production Firestore execution
        // 1. Chunked batch migrate memories (respects Firestore 500-write limit)
        if (pending.memories.length > 0) {
          for (let i = 0; i < pending.memories.length; i += batchSize) {
            const chunk = pending.memories.slice(i, i + batchSize);
            const memBatch = writeBatch(db);
            for (const item of chunk) {
              const itemDoc = doc(db, 'users', userId, 'memories', item.id);
              memBatch.set(itemDoc, {
                ...item,
                userId,
                updatedAt: new Date().toISOString(),
              });
            }
            await memBatch.commit();
          }
        }

        // 2. Chunked batch migrate sessions (respects Firestore 500-write limit and 1 MiB doc limit)
        if (pending.sessions.length > 0) {
          const allSessionDocs: { id: string; data: ChatSession; byteSize: number }[] = [];
          for (const item of pending.sessions) {
            const { metadataDoc, chunkDocs } = chunkSession(item, userId);
            const metaBytes = calculateDocumentByteSize(metadataDoc);
            if (metaBytes > FIRESTORE_MAX_DOCUMENT_BYTES) {
              throw new Error(
                `Session metadata document "${metadataDoc.id}" is ${metaBytes} bytes, exceeding the 1,048,576-byte limit.`
              );
            }
            allSessionDocs.push({ id: metadataDoc.id, data: metadataDoc, byteSize: metaBytes });

            for (const chk of chunkDocs) {
              const chkBytes = calculateDocumentByteSize(chk);
              if (chkBytes > FIRESTORE_MAX_DOCUMENT_BYTES) {
                throw new Error(
                  `Session chunk document "${chk.id}" is ${chkBytes} bytes, exceeding the 1,048,576-byte limit.`
                );
              }
              allSessionDocs.push({ id: chk.id, data: chk, byteSize: chkBytes });
            }
          }

          for (let i = 0; i < allSessionDocs.length; i += batchSize) {
            const chunk = allSessionDocs.slice(i, i + batchSize);
            const sessBatch = writeBatch(db);
            for (const docItem of chunk) {
              const itemDoc = doc(db, 'users', userId, 'chats', docItem.id);
              sessBatch.set(itemDoc, docItem.data);
            }
            await sessBatch.commit();
          }
        }

        // 3. Clear guest storage strictly only after all batch commits succeed
        safeLocalStorage.removeItem(GUEST_STORAGE_KEY);
        safeLocalStorage.removeItem(GUEST_SESSIONS_STORAGE_KEY);
        safeLocalStorage.setItem(`shadow_migrated_${userId}`, new Date().toISOString());
      }

      return {
        success: true,
        migratedMemoriesCount: pending.memories.length,
        migratedSessionsCount: pending.sessions.length,
        targetUserId: userId,
      };
    } finally {
      this.isMigrationInProgress = false;
    }
  }

  /**
   * Skips guest data migration for this user session without transferring or deleting local guest data.
   */
  public skipGuestData(userId: string): void {
    safeSessionStorage.setItem(`shadow_migration_skipped_${userId}`, 'true');
  }

  /**
   * Cancels sign-in when the user chooses not to proceed with account authentication.
   * Signs out without transferring or deleting any guest data.
   */
  public async cancelMigration(): Promise<void> {
    await authService.signOut();
  }

  /**
   * Checks whether migration has been skipped for this session
   */
  public isMigrationSkipped(userId: string): boolean {
    return safeSessionStorage.getItem(`shadow_migration_skipped_${userId}`) === 'true';
  }

  /**
   * Test & state inspection hooks
   */
  public isMigrationRunning(): boolean {
    return this.isMigrationInProgress;
  }

  public resetMigrationStateForTesting(): void {
    this.isMigrationInProgress = false;
  }
}

export const migrationService = new MigrationService();
