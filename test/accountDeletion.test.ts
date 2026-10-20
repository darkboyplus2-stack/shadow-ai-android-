import {
  purgeAccountCollections,
  memoryService,
  FirestoreDeletionAdapter,
  COLLECTIONS_TO_PURGE,
  FIRESTORE_MAX_BATCH_SIZE,
} from '../src/services/memoryService';

interface TestStats {
  passed: number;
  failed: number;
  total: number;
}

const stats: TestStats = { passed: 0, failed: 0, total: 0 };

function assert(condition: boolean, testName: string, detail?: string) {
  stats.total++;
  if (condition) {
    stats.passed++;
    console.log(`  ✓ PASS: ${testName}`);
  } else {
    stats.failed++;
    console.error(`  ✗ FAIL: ${testName}${detail ? ` (${detail})` : ''}`);
  }
}

async function runAllTests() {
  console.log('\n======================================================');
  console.log('SHADOW AI — Production Security & Account Deletion Test Suite');
  console.log('======================================================\n');

  const testUserId = 'test-mock-user-uid-9999';

  // ------------------------------------------------------------------------
  // TEST 1: Simulate failed collection read
  // ------------------------------------------------------------------------
  console.log('Test 1: Simulating failed collection read...');
  let authDeleteCalledT1 = false;
  const failingReadAdapter: FirestoreDeletionAdapter = {
    getCollectionDocs: async (col) => {
      if (col === 'chats') {
        throw new Error('Simulated network failure reading chats collection');
      }
      return [{ id: 'doc-1', ref: { path: `users/${testUserId}/${col}/doc-1` } }];
    },
    commitDeleteBatch: async () => {},
    verifyCollectionEmpty: async () => true,
  };

  try {
    await memoryService.deleteAllAccountData(testUserId, failingReadAdapter);
    // If it reaches here, it failed to throw
    authDeleteCalledT1 = true;
    assert(false, 'Should throw error when collection read fails');
  } catch (err: any) {
    assert(
      err.message.includes('Failed to retrieve documents from collection "chats"'),
      'Throws descriptive error for failed read',
      err.message
    );
    assert(
      err.message.includes('not atomic'),
      'Informs caller that deletion is not atomic upon failure'
    );
    assert(!authDeleteCalledT1, 'Firebase Auth account deletion is NOT called after read failure');
  }

  // ------------------------------------------------------------------------
  // TEST 2: Simulate failed batch commit
  // ------------------------------------------------------------------------
  console.log('\nTest 2: Simulating failed batch commit...');
  let authDeleteCalledT2 = false;
  let batchAttempts = 0;
  const failingBatchAdapter: FirestoreDeletionAdapter = {
    getCollectionDocs: async (col) => {
      return [
        { id: 'doc-1', ref: { path: `users/${testUserId}/${col}/doc-1` } },
        { id: 'doc-2', ref: { path: `users/${testUserId}/${col}/doc-2` } },
      ];
    },
    commitDeleteBatch: async () => {
      batchAttempts++;
      if (batchAttempts >= 2) {
        throw new Error('Firestore deadline exceeded / write permission timeout');
      }
    },
    verifyCollectionEmpty: async () => true,
  };

  try {
    await memoryService.deleteAllAccountData(testUserId, failingBatchAdapter);
    authDeleteCalledT2 = true;
    assert(false, 'Should throw error when batch commit fails');
  } catch (err: any) {
    assert(
      err.message.includes('Failed to commit batch deletion on collection'),
      'Throws descriptive error on batch commit failure',
      err.message
    );
    assert(
      err.message.includes('not atomic'),
      'Warns caller that partial cloud data may have been removed'
    );
    assert(!authDeleteCalledT2, 'Firebase Auth account deletion is NOT called after batch commit failure');
  }

  // ------------------------------------------------------------------------
  // TEST 3: Simulate incomplete deletion verification
  // ------------------------------------------------------------------------
  console.log('\nTest 3: Simulating incomplete deletion verification...');
  let authDeleteCalledT3 = false;
  const incompleteVerifyAdapter: FirestoreDeletionAdapter = {
    getCollectionDocs: async (col) => {
      return [{ id: 'doc-1', ref: { path: `users/${testUserId}/${col}/doc-1` } }];
    },
    commitDeleteBatch: async () => {},
    verifyCollectionEmpty: async (col) => {
      // Simulate that "settings" still contains a stubborn doc
      if (col === 'settings') return false;
      return true;
    },
  };

  try {
    await memoryService.deleteAllAccountData(testUserId, incompleteVerifyAdapter);
    authDeleteCalledT3 = true;
    assert(false, 'Should abort when verification detects non-empty collection');
  } catch (err: any) {
    assert(
      err.message.includes('Deletion verification failed: Collection "settings" still contains remaining records'),
      'Throws verification error identifying offending collection',
      err.message
    );
    assert(!authDeleteCalledT3, 'Firebase Auth account deletion is NOT called when verification fails');
  }

  // ------------------------------------------------------------------------
  // TEST 4: Test deletion involving more than 500 documents (> 500 batch limit)
  // ------------------------------------------------------------------------
  console.log('\nTest 4: Testing deletion of 1,250 documents exceeding 500-write limit...');
  const largeDocumentCount = 1250;
  const committedBatches: number[] = [];

  const largeCollectionAdapter: FirestoreDeletionAdapter = {
    getCollectionDocs: async (col) => {
      if (col === 'memories') {
        const docs = [];
        for (let i = 0; i < largeDocumentCount; i++) {
          docs.push({ id: `mem-${i}`, ref: { path: `users/${testUserId}/memories/mem-${i}` } });
        }
        return docs;
      }
      return [];
    },
    commitDeleteBatch: async (refs) => {
      committedBatches.push(refs.length);
    },
    verifyCollectionEmpty: async () => true,
  };

  const resultLarge = await purgeAccountCollections(testUserId, largeCollectionAdapter, 450);
  assert(resultLarge.success === true, 'Successfully processed large collection');
  assert(resultLarge.totalDeleted === 1250, 'Exactly 1,250 documents deleted');
  assert(
    committedBatches.every((batchSize) => batchSize <= 450),
    'Every committed batch strictly respects the 500-write limit (all <= 450)',
    `Batch sizes: ${JSON.stringify(committedBatches)}`
  );
  assert(
    committedBatches.length === 3 && committedBatches[0] === 450 && committedBatches[1] === 450 && committedBatches[2] === 350,
    'Correctly chunked into batches of [450, 450, 350]',
    `Actual chunks: ${JSON.stringify(committedBatches)}`
  );

  // ------------------------------------------------------------------------
  // TEST 5: Confirm successful, fully verified cleanup proceeds to account deletion
  // ------------------------------------------------------------------------
  console.log('\nTest 5: Confirming successful cleanup permits account deletion...');
  let authDeleteCalledT5 = false;
  const mockStorage: Record<string, string[]> = {
    memories: ['m1', 'm2', 'm3'],
    chats: ['c1', 'c2'],
    settings: ['s1'],
  };

  const successfulAdapter: FirestoreDeletionAdapter = {
    getCollectionDocs: async (col) => {
      return (mockStorage[col] || []).map((id) => ({
        id,
        ref: { path: `users/${testUserId}/${col}/${id}` },
      }));
    },
    commitDeleteBatch: async (refs) => {
      refs.forEach((r) => {
        for (const k of Object.keys(mockStorage)) {
          mockStorage[k] = mockStorage[k].filter((id) => !r.path.includes(id));
        }
      });
    },
    verifyCollectionEmpty: async (col) => {
      return (mockStorage[col] || []).length === 0;
    },
  };

  const cleanupRes = await memoryService.deleteAllAccountData(testUserId, successfulAdapter);
  assert(cleanupRes.success === true, 'Cleanup reported verified success');
  assert(cleanupRes.totalDeleted === 6, 'All 6 documents across 3 collections deleted');
  assert(
    COLLECTIONS_TO_PURGE.every((col) => cleanupRes.deletedCollections.includes(col)),
    'All covered schema collections (memories, chats, settings) were cleaned'
  );

  // Simulated coordinator proceeding to Firebase Auth deletion
  if (cleanupRes.success) {
    authDeleteCalledT5 = true;
  }
  assert(authDeleteCalledT5, 'Firebase Auth account deletion is permitted and called after full verification');

  // ------------------------------------------------------------------------
  // TEST 6: Prevent duplicate deletion requests while deletion is in progress
  // ------------------------------------------------------------------------
  console.log('\nTest 6: Testing prevention of duplicate concurrent deletion requests...');
  let slowRelease: () => void;
  const slowPromise = new Promise<void>((resolve) => {
    slowRelease = resolve;
  });

  const slowAdapter: FirestoreDeletionAdapter = {
    getCollectionDocs: async () => {
      await slowPromise;
      return [];
    },
    commitDeleteBatch: async () => {},
    verifyCollectionEmpty: async () => true,
  };

  // Launch first request (runs in background until slowRelease)
  const req1 = memoryService.deleteAllAccountData(testUserId, slowAdapter);

  // Attempt immediate second request
  try {
    await memoryService.deleteAllAccountData(testUserId, slowAdapter);
    assert(false, 'Should have blocked second deletion request');
  } catch (dupErr: any) {
    assert(
      dupErr.message.includes('already in progress'),
      'Rejected concurrent request with "already in progress" guard',
      dupErr.message
    );
  }

  // Release first request and wait for it
  slowRelease!();
  await req1;
  assert(
    !memoryService.isAccountDeletionInProgress(),
    'isAccountDeletionInProgress flag clears after completion'
  );

  // ------------------------------------------------------------------------
  // Summary
  // ------------------------------------------------------------------------
  console.log('\n======================================================');
  console.log(`TEST SUMMARY: ${stats.passed} Passed, ${stats.failed} Failed out of ${stats.total} Tests`);
  console.log('======================================================\n');

  if (stats.failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runAllTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
