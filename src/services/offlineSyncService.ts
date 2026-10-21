/**
 * SHADOW AI — Offline Safe Synchronization Service
 *
 * Coordinates offline operations and safe reconciliation upon reconnection:
 * - Queues memory operations created while offline without data loss.
 * - Enforces Firebase UID isolation so User A's pending offline operations
 *   are NEVER synced to User B upon account switch or login.
 * - Idempotently commits pending writes and deletes upon network reconnection.
 * - Preserves local guest data until synchronization or migration is confirmed.
 */

import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import { db, auth } from './firebase';
import { MemoryDocument } from './memoryService';
import { safeLocalStorage } from './sessionService';
import { connectivityService } from './connectivityService';

export const PENDING_OPS_STORAGE_KEY = 'shadow_pending_offline_ops';

export interface PendingMemoryOp {
  id: string;
  type: 'SAVE_MEMORY' | 'DELETE_MEMORY';
  userId: string;
  payload?: MemoryDocument;
  targetId?: string;
  timestamp: string;
}

class OfflineSyncService {
  private isSyncing = false;

  constructor() {
    // Listen to connectivity restoration
    connectivityService.subscribe((diag) => {
      if (diag.networkStatus === 'ONLINE' && diag.backendStatus === 'AVAILABLE') {
        this.syncPendingOperations();
      }
    });
  }

  public getPendingOperations(): PendingMemoryOp[] {
    try {
      const raw = safeLocalStorage.getItem(PENDING_OPS_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  private savePendingOperations(ops: PendingMemoryOp[]): void {
    try {
      safeLocalStorage.setItem(PENDING_OPS_STORAGE_KEY, JSON.stringify(ops));
    } catch (e) {
      console.warn('[OfflineSync] Failed to persist pending operations:', e);
    }
  }

  /**
   * Queues an offline memory save operation with UID isolation.
   */
  public queueMemorySave(userId: string, memory: MemoryDocument): void {
    if (!userId || userId === 'guest') return;
    const ops = this.getPendingOperations();

    // Idempotent: replace any existing pending save for this memory ID
    const filtered = ops.filter(
      (op) => !(op.type === 'SAVE_MEMORY' && op.userId === userId && op.payload?.id === memory.id)
    );

    filtered.push({
      id: `op-save-${memory.id}-${Date.now()}`,
      type: 'SAVE_MEMORY',
      userId,
      payload: memory,
      timestamp: new Date().toISOString(),
    });

    this.savePendingOperations(filtered);
  }

  /**
   * Queues an offline memory delete operation.
   */
  public queueMemoryDelete(userId: string, memoryId: string): void {
    if (!userId || userId === 'guest') return;
    const ops = this.getPendingOperations();

    // Remove any pending save for this memory ID since it was deleted
    const filtered = ops.filter(
      (op) => !(op.payload?.id === memoryId && op.userId === userId)
    );

    filtered.push({
      id: `op-del-${memoryId}-${Date.now()}`,
      type: 'DELETE_MEMORY',
      userId,
      targetId: memoryId,
      timestamp: new Date().toISOString(),
    });

    this.savePendingOperations(filtered);
  }

  /**
   * Synchronizes eligible pending operations when network connectivity is restored.
   * Strictly enforces current authenticated UID matching.
   */
  public async syncPendingOperations(): Promise<{ syncedCount: number; errors: string[] }> {
    if (this.isSyncing) return { syncedCount: 0, errors: [] };
    const currentUid = auth.currentUser?.uid;
    if (!currentUid) return { syncedCount: 0, errors: [] };

    const ops = this.getPendingOperations();
    // Only process operations that belong to the current authenticated user
    const userOps = ops.filter((op) => op.userId === currentUid);
    if (userOps.length === 0) return { syncedCount: 0, errors: [] };

    this.isSyncing = true;
    let syncedCount = 0;
    const errors: string[] = [];
    const remainingOps: PendingMemoryOp[] = ops.filter((op) => op.userId !== currentUid);

    for (const op of userOps) {
      try {
        if (op.type === 'SAVE_MEMORY' && op.payload) {
          const docRef = doc(db, 'users', currentUid, 'memories', op.payload.id);
          await setDoc(docRef, op.payload);
          syncedCount++;
        } else if (op.type === 'DELETE_MEMORY' && op.targetId) {
          const docRef = doc(db, 'users', currentUid, 'memories', op.targetId);
          await deleteDoc(docRef);
          syncedCount++;
        }
      } catch (err: any) {
        errors.push(`Failed to sync op ${op.id}: ${err?.message || err}`);
        // Retain uncommitted op for future retry
        remainingOps.push(op);
      }
    }

    this.savePendingOperations(remainingOps);
    this.isSyncing = false;
    return { syncedCount, errors };
  }

  /**
   * Clears pending operations for a specific user (e.g. during account deletion).
   */
  public clearUserOperations(userId: string): void {
    const ops = this.getPendingOperations();
    const remaining = ops.filter((op) => op.userId !== userId);
    this.savePendingOperations(remaining);
  }

  public clearQueueForUser(userId: string): void {
    this.clearUserOperations(userId);
  }

  public getPendingCount(userId?: string): number {
    const ops = this.getPendingOperations();
    if (!userId) return ops.length;
    return ops.filter((op) => op.userId === userId).length;
  }

  public enqueueOperation(op: {
    type: 'save' | 'delete';
    uid: string;
    memory?: MemoryDocument;
    targetId?: string;
  }): void {
    if (op.type === 'save' && op.memory) {
      this.queueMemorySave(op.uid, op.memory);
    } else if (op.type === 'delete' && op.targetId) {
      this.queueMemoryDelete(op.uid, op.targetId);
    }
  }

  /**
   * Test-only helper to clear all queued operations.
   */
  public clearAllForTesting(): void {
    this.savePendingOperations([]);
  }
}

export const offlineSyncService = new OfflineSyncService();
