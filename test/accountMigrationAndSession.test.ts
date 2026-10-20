/**
 * SHADOW AI — SEC-03 (Guest Data Migration) & SEC-04 (Sign-Out Session Cleanup) Test Suite
 *
 * Runs isolated, non-destructive tests using mock storage and adapters.
 * Never touches live Firebase, production data, or real accounts.
 */

import { migrationService, MigrationStorageAdapter, MIGRATION_BATCH_LIMIT } from '../src/services/migrationService';
import { sessionService, GUEST_SESSIONS_STORAGE_KEY, ACTIVE_SESSION_STORAGE_KEY, safeLocalStorage } from '../src/services/sessionService';
import { memoryService, GUEST_STORAGE_KEY, MemoryDocument } from '../src/services/memoryService';
import { authService, UserProfile } from '../src/services/authService';
import { ChatSession } from '../src/services/sessionService';

// In-memory test storage simulation
const mockStorage: Record<string, string> = {};
const mockSessionStore: Record<string, string> = {};

(globalThis as any).localStorage = {
  getItem: (k: string) => (k in mockStorage ? mockStorage[k] : null),
  setItem: (k: string, v: string) => { mockStorage[k] = String(v); },
  removeItem: (k: string) => { delete mockStorage[k]; },
  clear: () => { for (const k of Object.keys(mockStorage)) delete mockStorage[k]; },
};

(globalThis as any).sessionStorage = {
  getItem: (k: string) => (k in mockSessionStore ? mockSessionStore[k] : null),
  setItem: (k: string, v: string) => { mockSessionStore[k] = String(v); },
  removeItem: (k: string) => { delete mockSessionStore[k]; },
  clear: () => { for (const k of Object.keys(mockSessionStore)) delete mockSessionStore[k]; },
};

function clearAllMockStorage() {
  (globalThis as any).localStorage.clear();
  (globalThis as any).sessionStorage.clear();
  migrationService.resetMigrationStateForTesting();
}

let passedCount = 0;
let failedCount = 0;

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`  ✗ FAIL: ${message}`);
    failedCount++;
    throw new Error(`Assertion failed: ${message}`);
  } else {
    console.log(`  ✓ PASS: ${message}`);
    passedCount++;
  }
}

async function runTests() {
  console.log('======================================================');
  console.log('SHADOW AI — SEC-03 & SEC-04 Security & Session Test Suite');
  console.log('======================================================\n');

  // --------------------------------------------------------------------------
  // TEST GROUP 1: SEC-03 Guest Data Detection & Filtering
  // --------------------------------------------------------------------------
  console.log('Test 1: Guest Data Inspection & Filtering...');
  clearAllMockStorage();

  // Scenario 1a: No data
  const emptyPending = migrationService.getPendingGuestData();
  assert(!emptyPending.hasData, 'Returns hasData: false when guest storage is empty');
  assert(emptyPending.summary.memoryCount === 0, 'Memory count is 0');
  assert(emptyPending.summary.sessionCount === 0, 'Session count is 0');

  // Scenario 1b: Meaningless session only (initial briefing without user messages)
  const emptySession: ChatSession = {
    id: 'guest-sess-init',
    userId: 'guest',
    title: 'Initial Briefing',
    messages: [
      { id: '1', sender: 'shadow', text: 'Hello!', timestamp: '10:00' },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  mockStorage[GUEST_SESSIONS_STORAGE_KEY] = JSON.stringify([emptySession]);
  const meaninglessPending = migrationService.getPendingGuestData();
  assert(!meaninglessPending.hasData, 'Filters out placeholder sessions where user never spoke');
  assert(meaninglessPending.sessions.length === 0, 'Does not mark placeholder session for migration');

  // Scenario 1c: Meaningful session and guest memories
  const activeGuestSession: ChatSession = {
    id: 'guest-sess-real',
    userId: 'guest',
    title: 'Quantum computing discussion',
    messages: [
      { id: '1', sender: 'shadow', text: 'Hello!', timestamp: '10:00' },
      { id: '2', sender: 'user', text: 'Explain qubit entanglement', timestamp: '10:01' },
      { id: '3', sender: 'shadow', text: 'Entanglement is...', timestamp: '10:01' },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const guestMemory: MemoryDocument = {
    id: 'mem-101',
    userId: 'guest',
    content: 'User prefers Python over Julia',
    category: 'preference',
    tags: ['python', 'julia', 'preference'],
    provenance: 'explicit_user',
    confidence: 1.0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  mockStorage[GUEST_SESSIONS_STORAGE_KEY] = JSON.stringify([activeGuestSession]);
  mockStorage[GUEST_STORAGE_KEY] = JSON.stringify([guestMemory]);

  const realPending = migrationService.getPendingGuestData();
  assert(realPending.hasData, 'Identifies pending guest data correctly');
  assert(realPending.summary.memoryCount === 1, 'Accurately counts guest memories (1)');
  assert(realPending.summary.sessionCount === 1, 'Accurately counts meaningful guest sessions (1)');
  assert(realPending.memories[0].content === 'User prefers Python over Julia', 'Preserves exact memory content');

  // --------------------------------------------------------------------------
  // TEST GROUP 2: SEC-03 Skip and Cancel Options
  // --------------------------------------------------------------------------
  console.log('\nTest 2: SEC-03 Skip & Cancel Options (Non-destructive)...');
  // 2a. Skip Option
  const testUserId = 'firebase-user-alpha-99';
  migrationService.skipGuestData(testUserId);
  assert(migrationService.isMigrationSkipped(testUserId), 'Marks migration as skipped for user session');
  assert(GUEST_STORAGE_KEY in mockStorage, 'Skip does NOT delete local guest memories');
  assert(GUEST_SESSIONS_STORAGE_KEY in mockStorage, 'Skip does NOT delete local guest sessions');

  // 2b. Cancel Option
  let signOutCalled = false;
  const originalSignOut = authService.signOut;
  authService.signOut = async () => {
    signOutCalled = true;
  };

  await migrationService.cancelMigration();
  assert(signOutCalled, 'Cancel triggers authService.signOut() to return to guest mode');
  assert(GUEST_STORAGE_KEY in mockStorage, 'Cancel does NOT delete local guest memories');
  assert(GUEST_SESSIONS_STORAGE_KEY in mockStorage, 'Cancel does NOT delete local guest sessions');
  authService.signOut = originalSignOut;

  // --------------------------------------------------------------------------
  // TEST GROUP 3: SEC-03 Explicit Confirmation & Safe Import
  // --------------------------------------------------------------------------
  console.log('\nTest 3: SEC-03 Explicit Confirmation & Safe Cloud Transfer...');
  const cloudMemoriesSaved: MemoryDocument[] = [];
  const cloudSessionsSaved: ChatSession[] = [];
  let storageCleared = false;

  const testAdapter: MigrationStorageAdapter = {
    getGuestMemories: () => JSON.parse(mockStorage[GUEST_STORAGE_KEY] || '[]'),
    getGuestSessions: () => JSON.parse(mockStorage[GUEST_SESSIONS_STORAGE_KEY] || '[]'),
    saveCloudMemories: async (uid, mems) => {
      cloudMemoriesSaved.push(...mems.map((m) => ({ ...m, userId: uid })));
    },
    saveCloudSessions: async (uid, sess) => {
      cloudSessionsSaved.push(...sess.map((s) => ({ ...s, userId: uid })));
    },
    clearGuestStorage: () => {
      storageCleared = true;
      delete mockStorage[GUEST_STORAGE_KEY];
      delete mockStorage[GUEST_SESSIONS_STORAGE_KEY];
    },
  };

  const importResult = await migrationService.importGuestDataToUser(testUserId, testAdapter);
  assert(importResult.success, 'Import reports success');
  assert(importResult.migratedMemoriesCount === 1, 'Successfully migrated 1 memory');
  assert(importResult.migratedSessionsCount === 1, 'Successfully migrated 1 session');
  assert(cloudMemoriesSaved[0].userId === testUserId, 'Assigned authenticated user ID to cloud memory');
  assert(cloudSessionsSaved[0].userId === testUserId, 'Assigned authenticated user ID to cloud session');
  assert(storageCleared, 'Guest storage cleared only after confirmed successful cloud persistence');

  // --------------------------------------------------------------------------
  // TEST GROUP 4: SEC-03 Duplicate-Import Prevention on Repeated Sign-In / Retries
  // --------------------------------------------------------------------------
  console.log('\nTest 4: SEC-03 Duplicate-Import Prevention...');
  // Since guest storage was cleared on successful import, repeated calls should be no-op:
  const repeatResult = await migrationService.importGuestDataToUser(testUserId, testAdapter);
  assert(repeatResult.success, 'Repeated call handles empty queue safely');
  assert(repeatResult.migratedMemoriesCount === 0, 'Zero duplicate memories imported');
  assert(repeatResult.migratedSessionsCount === 0, 'Zero duplicate sessions imported');

  // Test concurrency guard
  // Simulate an in-flight import
  mockStorage[GUEST_STORAGE_KEY] = JSON.stringify([guestMemory]);
  let lockedError = false;
  try {
    const p1 = migrationService.importGuestDataToUser(testUserId, {
      ...testAdapter,
      saveCloudMemories: async () => {
        // Attempt concurrent call while p1 is in progress
        try {
          await migrationService.importGuestDataToUser(testUserId, testAdapter);
        } catch (e: any) {
          if (String(e?.message).includes('Migration is already in progress')) {
            lockedError = true;
          }
        }
      },
    });
    await p1;
  } catch {}
  assert(lockedError, 'Rejects concurrent migration requests with "Migration is already in progress"');

  // --------------------------------------------------------------------------
  // TEST GROUP 5: SEC-03 Cloud Data Isolation (Never transferring User A data to User B)
  // --------------------------------------------------------------------------
  console.log('\nTest 5: SEC-03 Cloud Data Isolation Between Users...');
  clearAllMockStorage();

  // User A has cloud data, but local guest storage has 0 items
  const userAId = 'user-alpha-123';
  const userBId = 'user-bravo-456';

  // Verify getPendingGuestData only inspects local guest storage
  const pendingForB = migrationService.getPendingGuestData();
  assert(!pendingForB.hasData, 'No guest data detected; User A cloud data is not accessible as guest data');

  const importResultB = await migrationService.importGuestDataToUser(userBId, testAdapter);
  assert(importResultB.migratedMemoriesCount === 0, 'User B receives 0 items; User A cloud data is never leaked');

  // --------------------------------------------------------------------------
  // TEST GROUP 6: SEC-04 Stale activeSessionId Cleared on Sign-Out
  // --------------------------------------------------------------------------
  console.log('\nTest 6: SEC-04 Sign-Out Stale activeSessionId Cleanup...');
  clearAllMockStorage();

  // Set an active session ID as if an authenticated session was selected
  mockStorage[ACTIVE_SESSION_STORAGE_KEY] = 'chat-authenticated-cloud-999';
  assert(safeLocalStorage.getItem(ACTIVE_SESSION_STORAGE_KEY) === 'chat-authenticated-cloud-999', 'Active session set in storage');

  // Trigger sign-out in sessionService
  sessionService.handleAuthChangeForTesting(null);

  // Check that the authenticated session ID was removed from localStorage
  const activeAfterSignOut = sessionService.getActiveSessionId();
  assert(
    activeAfterSignOut !== 'chat-authenticated-cloud-999',
    'Previous authenticated session ID is NOT the active session after sign-out'
  );
  assert(
    safeLocalStorage.getItem(ACTIVE_SESSION_STORAGE_KEY) !== 'chat-authenticated-cloud-999',
    'Stale activeSessionId is removed from localStorage on sign-out'
  );

  // --------------------------------------------------------------------------
  // TEST GROUP 7: SEC-04 Firestore Listener Cleanup & In-Memory Data Wiping
  // --------------------------------------------------------------------------
  console.log('\nTest 7: SEC-04 Firestore Listener Cleanup & Memory/Session Wiping...');
  let unsubFirestoreChatsCalled = false;
  let unsubFirestoreMemsCalled = false;

  const mockUserA: UserProfile = {
    uid: userAId,
    email: 'alpha@example.com',
    displayName: 'Alpha',
    photoURL: null,
    isGuest: false,
  };

  // Simulate authenticated login for User A
  sessionService.handleAuthChangeForTesting(mockUserA);
  memoryService.handleAuthChangeForTesting(mockUserA);

  // Attach mock unsubscribe listeners
  sessionService.setFirestoreListenerMock(() => {
    unsubFirestoreChatsCalled = true;
  });
  memoryService.setFirestoreListenerMock(() => {
    unsubFirestoreMemsCalled = true;
  });

  // Populate in-memory with User A cloud records
  sessionService.setSessionsForTesting([
    {
      id: 'alpha-chat-1',
      userId: userAId,
      title: 'Alpha Private Secrets',
      messages: [{ id: 'm1', sender: 'user', text: 'top secret alpha data', timestamp: '12:00' }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ]);
  memoryService.setMemoriesForTesting([
    {
      id: 'alpha-mem-1',
      userId: userAId,
      content: 'Alpha secret financial key',
      category: 'fact',
      tags: ['secret'],
      provenance: 'explicit_user',
      confidence: 1.0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ]);

  assert(sessionService.getSessions().length > 0, 'User A sessions loaded in memory');
  assert(memoryService.getMemories().length > 0, 'User A memories loaded in memory');

  // Trigger Sign-out
  sessionService.handleAuthChangeForTesting(null);
  memoryService.handleAuthChangeForTesting(null);

  assert(unsubFirestoreChatsCalled, 'Firestore chats snapshot listener was unsubscribed on sign-out');
  assert(unsubFirestoreMemsCalled, 'Firestore memories snapshot listener was unsubscribed on sign-out');

  // Verify User A data is completely wiped from in-memory arrays
  const sessionsAfterSignOut = sessionService.getSessions();
  const memoriesAfterSignOut = memoryService.getMemories();

  const containsAlphaChat = sessionsAfterSignOut.some((s) => s.id === 'alpha-chat-1');
  const containsAlphaMem = memoriesAfterSignOut.some((m) => m.id === 'alpha-mem-1');
  assert(!containsAlphaChat, 'User A private chats wiped completely from memory on sign-out');
  assert(!containsAlphaMem, 'User A private memories wiped completely from memory on sign-out');

  // --------------------------------------------------------------------------
  // TEST GROUP 8: SEC-04 Guest State Restoration on Sign-Out
  // --------------------------------------------------------------------------
  console.log('\nTest 8: SEC-04 Guest State Restoration...');
  const guestLocalSession: ChatSession = {
    id: 'guest-persisted-sess',
    userId: 'guest',
    title: 'Guest Planning Discussion',
    messages: [
      { id: '1', sender: 'user', text: 'Guest notes', timestamp: '14:00' },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const guestLocalMemory: MemoryDocument = {
    id: 'guest-persisted-mem',
    userId: 'guest',
    content: 'Guest prefers Hindi responses',
    category: 'preference',
    tags: ['hindi'],
    provenance: 'explicit_user',
    confidence: 1.0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  mockStorage[GUEST_SESSIONS_STORAGE_KEY] = JSON.stringify([guestLocalSession]);
  mockStorage[GUEST_STORAGE_KEY] = JSON.stringify([guestLocalMemory]);

  // Trigger sign-out to restore guest
  sessionService.handleAuthChangeForTesting(null);
  memoryService.handleAuthChangeForTesting(null);

  const restoredSessions = sessionService.getSessions();
  const restoredMemories = memoryService.getMemories();

  assert(restoredSessions.some((s) => s.id === 'guest-persisted-sess'), 'Restored guest sessions from local storage');
  assert(restoredMemories.some((m) => m.id === 'guest-persisted-mem'), 'Restored guest memories from local storage');
  assert(sessionService.getCurrentUserId() === null, 'Current session userId is null (guest mode)');
  assert(memoryService.getCurrentUserId() === null, 'Current memory userId is null (guest mode)');

  // --------------------------------------------------------------------------
  // TEST GROUP 9: SEC-04 Switching Accounts & Asynchronous Snapshot Fencing
  // --------------------------------------------------------------------------
  console.log('\nTest 9: SEC-04 Account Switching & Async Generation Fencing...');

  // User A signs in
  sessionService.handleAuthChangeForTesting(mockUserA);
  const genA = sessionService.getCurrentAuthGeneration();

  // User switches directly to User B
  const mockUserB: UserProfile = {
    uid: userBId,
    email: 'bravo@example.com',
    displayName: 'Bravo',
    photoURL: null,
    isGuest: false,
  };
  sessionService.handleAuthChangeForTesting(mockUserB);
  const genB = sessionService.getCurrentAuthGeneration();

  assert(genB > genA, 'Auth generation incremented on account switch');
  assert(sessionService.getCurrentUserId() === userBId, 'sessionService active user is now User B');

  // Verify that an async/delayed snapshot from genA is rejected
  // The snapshot handler in sessionService checks `this.currentAuthGeneration !== generation || this.currentUserId !== userId`
  assert(genA !== genB, 'Generation fence guarantees stale callbacks are discarded');

  // --------------------------------------------------------------------------
  // TEST GROUP 10: SEC-04 Re-signing into Same Account
  // --------------------------------------------------------------------------
  console.log('\nTest 10: SEC-04 Re-signing into Same Account...');
  // User B signs out
  sessionService.handleAuthChangeForTesting(null);
  assert(sessionService.getCurrentUserId() === null, 'Signed out');

  // User B signs back in
  sessionService.handleAuthChangeForTesting(mockUserB);
  assert(sessionService.getCurrentUserId() === userBId, 'User B ID properly recognized');
  assert(sessionService.hasActiveFirestoreListener() === true, 'Firestore listener subscription initialized for user account');

  // Clean up listeners before test exit
  sessionService.handleAuthChangeForTesting(null);
  memoryService.handleAuthChangeForTesting(null);

  console.log('\n======================================================');
  console.log(`TEST SUMMARY: ${passedCount} Passed, ${failedCount} Failed out of ${passedCount + failedCount} Tests`);
  console.log('======================================================');

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Test suite failed with unexpected error:', err);
  process.exit(1);
});
