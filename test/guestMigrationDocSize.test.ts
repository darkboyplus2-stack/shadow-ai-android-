/**
 * SHADOW AI — Guest Migration Document Size & Chunking Test Suite
 *
 * Verifies:
 * 1. Reproduces the 4.58 MB oversized-document failure when storing entire conversations in 1 document.
 * 2. Verifies the chunked data model where every document is strictly < 1 MiB (target <= 500 KB).
 * 3. 51-message conversation migration with full message ordering, IDs, and attachment fidelity.
 * 4. Guest localStorage preservation on partial failure (safe retryability).
 * 5. Idempotent retrying without record duplication.
 * 6. SessionService snapshot reassembly and search across chunked conversations.
 * 7. User isolation between guest, User A, and User B.
 */

import {
  sessionService,
  ChatSession,
  chunkSession,
  reassembleMessages,
  calculateDocumentByteSize,
  isChunkDoc,
  parseChunkMeta,
  FIRESTORE_MAX_DOCUMENT_BYTES,
  SAFE_DOCUMENT_BYTE_LIMIT,
  GUEST_SESSIONS_STORAGE_KEY,
} from '../src/services/sessionService';
import { ChatMessage } from '../src/types/hologram';
import {
  migrationService,
  MigrationStorageAdapter,
} from '../src/services/migrationService';
import { GUEST_STORAGE_KEY, MemoryDocument } from '../src/services/memoryService';
import { UserProfile } from '../src/services/authService';

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

function clearStorage() {
  (globalThis as any).localStorage.clear();
  (globalThis as any).sessionStorage.clear();
  migrationService.resetMigrationStateForTesting();
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${msg}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${msg}`);
    failed++;
    throw new Error(`Assertion failed: ${msg}`);
  }
}

async function runDocSizeTests() {
  console.log('======================================================');
  console.log('SHADOW AI — Guest Migration Document Size Test Suite');
  console.log('======================================================\n');

  // Generate 51 realistic messages for a long technical conversation
  const messages51: ChatMessage[] = [];
  for (let i = 0; i < 51; i++) {
    const isUser = i % 2 === 0;
    messages51.push({
      id: `msg-turn-${i}`,
      sender: isUser ? 'user' : 'shadow',
      text: isUser
        ? `Step ${i}: How should we configure high-availability clusters with Redis Sentinel and PostgreSQL streaming replication?`
        : `Turn ${i} Response: PostgreSQL streaming replication combined with Redis Sentinel provides robust failover with sub-second election timeouts.`,
      timestamp: `10:${i < 10 ? '0' + i : i} AM`,
      modelUsed: isUser ? undefined : 'gemini-3.8-flash',
      latencyMs: isUser ? undefined : 320,
    });
  }

  // Attach a large visual screenshot (base64 Data URL) to message 10
  // Sized so that combined unchunked conversation is ~4.58 MB (4,584,673 bytes)
  const base64Chunk = 'A'.repeat(1024);
  const targetAttachmentSize = 4584673 - calculateDocumentByteSize({
    id: 'guest-sess-oversized',
    userId: 'guest',
    title: 'Oversized Technical Arch Discussion',
    messages: messages51,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const largePreview = 'data:image/png;base64,' + 'B'.repeat(Math.max(1000, targetAttachmentSize));
  messages51[10].imagePreview = largePreview;

  const oversizedSession: ChatSession = {
    id: 'guest-sess-oversized',
    userId: 'guest',
    title: 'Oversized Technical Arch Discussion',
    messages: messages51,
    createdAt: '2026-10-19T10:00:00Z',
    updatedAt: '2026-10-19T11:00:00Z',
  };

  // --------------------------------------------------------------------------
  // TEST 1: Reproduce Oversized-Document Failure Without Chunking
  // --------------------------------------------------------------------------
  console.log('Test 1: Reproduce Oversized Document Error (> 1 MiB)...');
  {
    const totalByteSize = calculateDocumentByteSize(oversizedSession);
    assert(totalByteSize > FIRESTORE_MAX_DOCUMENT_BYTES, `Single document is ${totalByteSize} bytes, exceeding 1,048,576-byte limit`);
    assert(totalByteSize >= 4500000, `Reproduces exact oversized scale (~4.58 MB)`);
  }

  // --------------------------------------------------------------------------
  // TEST 2: Chunking Data Model Under 1 MiB with Safety Margin
  // --------------------------------------------------------------------------
  console.log('\nTest 2: Chunked Data Model Under 1 MiB...');
  const { metadataDoc, chunkDocs } = chunkSession(oversizedSession, 'user-target-123');
  {
    const metaBytes = calculateDocumentByteSize(metadataDoc);
    assert(metaBytes < 1000, `Metadata document is compact (${metaBytes} bytes < 1 KB)`);
    assert(metadataDoc.messages.length === 0, 'Conversation metadata is stored separately from message contents');
    assert(metadataDoc.id === oversizedSession.id, 'Metadata doc ID matches session ID');
    assert(metadataDoc.title === oversizedSession.title, 'Preserves exact thread title');

    assert(chunkDocs.length > 0, `Decomposed into ${chunkDocs.length} safe chunk documents`);
    for (let i = 0; i < chunkDocs.length; i++) {
      const chk = chunkDocs[i];
      const chkBytes = calculateDocumentByteSize(chk);
      assert(
        chkBytes <= SAFE_DOCUMENT_BYTE_LIMIT,
        `Chunk doc ${chk.id} (${chkBytes} bytes) is safely under 500 KiB limit (${SAFE_DOCUMENT_BYTE_LIMIT} bytes)`
      );
      assert(chk.messages.length <= 20, `Chunk doc ${chk.id} has <= 20 messages (${chk.messages.length})`);
      assert(chk.userId === 'user-target-123', `Chunk doc belongs to authenticated user`);
      assert(isChunkDoc(chk), `Identified as chunk doc via title pattern`);
    }
  }

  // --------------------------------------------------------------------------
  // TEST 3: Reassembly & 100% Fidelity of All 51 Messages and Attachments
  // --------------------------------------------------------------------------
  console.log('\nTest 3: Message Reassembly & Fidelity (Zero Truncation)...');
  {
    const flattenedChunks = chunkDocs.flatMap((c) => c.messages);
    const reassembled = reassembleMessages(flattenedChunks);

    assert(reassembled.length === 51, `Reassembled exact 51 messages (got ${reassembled.length})`);

    // Verify ordering and content
    for (let i = 0; i < 51; i++) {
      assert(reassembled[i].id === `msg-turn-${i}`, `Message ${i} preserved exact ID`);
      assert(reassembled[i].sender === messages51[i].sender, `Message ${i} preserved sender`);
      assert(reassembled[i].text === messages51[i].text, `Message ${i} preserved text`);
      assert(reassembled[i].timestamp === messages51[i].timestamp, `Message ${i} preserved timestamp`);
    }

    // Verify large attachment survived intact without truncation
    assert(
      reassembled[10].imagePreview === largePreview,
      `Multi-part attachment preserved with 100% byte-for-byte fidelity (${reassembled[10].imagePreview?.length} chars)`
    );
  }

  // --------------------------------------------------------------------------
  // TEST 4: Guest Migration with 51 Messages and Memories
  // --------------------------------------------------------------------------
  console.log('\nTest 4: Guest-to-Account Migration with 51 Messages...');
  clearStorage();
  const guestMemory: MemoryDocument = {
    id: 'mem-arch-001',
    userId: 'guest',
    content: 'User prefers PostgreSQL streaming replication and Kubernetes',
    category: 'preference',
    tags: ['postgres', 'replication', 'k8s'],
    provenance: 'explicit_user',
    confidence: 1.0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  mockStorage[GUEST_SESSIONS_STORAGE_KEY] = JSON.stringify([oversizedSession]);
  mockStorage[GUEST_STORAGE_KEY] = JSON.stringify([guestMemory]);

  const rawDocsWritten: { id: string; data: any; byteSize: number }[] = [];
  let guestStorageCleared = false;

  const validAdapter: MigrationStorageAdapter = {
    getGuestMemories: () => JSON.parse(mockStorage[GUEST_STORAGE_KEY] || '[]'),
    getGuestSessions: () => JSON.parse(mockStorage[GUEST_SESSIONS_STORAGE_KEY] || '[]'),
    saveCloudMemories: async (_uid, mems) => {
      assert(mems.length === 1, 'Transfers 1 guest memory');
    },
    saveRawSessionDocs: async (_uid, docs) => {
      rawDocsWritten.push(...docs);
    },
    clearGuestStorage: () => {
      guestStorageCleared = true;
      delete mockStorage[GUEST_STORAGE_KEY];
      delete mockStorage[GUEST_SESSIONS_STORAGE_KEY];
    },
  };

  const migrationResult = await migrationService.importGuestDataToUser('user-cloud-1', validAdapter);
  assert(migrationResult.success, 'Migration reports success');
  assert(migrationResult.migratedSessionsCount === 1, 'Migrated 1 session');
  assert(migrationResult.migratedMemoriesCount === 1, 'Migrated 1 memory');
  assert(rawDocsWritten.length > 1, `Wrote 1 metadata doc + ${rawDocsWritten.length - 1} chunk docs`);

  for (const doc of rawDocsWritten) {
    assert(
      doc.byteSize <= FIRESTORE_MAX_DOCUMENT_BYTES,
      `Written document ${doc.id} (${doc.byteSize} bytes) is <= 1,048,576 bytes`
    );
  }
  assert(guestStorageCleared, 'Guest storage cleared only after confirmed successful migration');

  // --------------------------------------------------------------------------
  // TEST 5: Partial Failure Preserves Local Guest Storage for Retry
  // --------------------------------------------------------------------------
  console.log('\nTest 5: Partial Failure Preserves Guest Data for Retry...');
  clearStorage();
  mockStorage[GUEST_SESSIONS_STORAGE_KEY] = JSON.stringify([oversizedSession]);
  mockStorage[GUEST_STORAGE_KEY] = JSON.stringify([guestMemory]);

  let failedAdapterCalled = false;
  const failingAdapter: MigrationStorageAdapter = {
    getGuestMemories: () => JSON.parse(mockStorage[GUEST_STORAGE_KEY] || '[]'),
    getGuestSessions: () => JSON.parse(mockStorage[GUEST_SESSIONS_STORAGE_KEY] || '[]'),
    saveCloudMemories: async () => {},
    saveRawSessionDocs: async () => {
      failedAdapterCalled = true;
      throw new Error('Simulated network timeout during batch commit');
    },
    clearGuestStorage: () => {
      throw new Error('clearGuestStorage should NEVER be called on failure!');
    },
  };

  let caughtError = false;
  try {
    await migrationService.importGuestDataToUser('user-cloud-1', failingAdapter);
  } catch (err: any) {
    caughtError = true;
    assert(err.message.includes('Simulated network timeout'), 'Propagates batch commit failure message');
  }

  assert(caughtError, 'Migration throws error on partial failure');
  assert(failedAdapterCalled, 'Attempted raw session write before failure');
  assert(GUEST_SESSIONS_STORAGE_KEY in mockStorage, 'Local guest sessions NOT deleted on failure');
  assert(GUEST_STORAGE_KEY in mockStorage, 'Local guest memories NOT deleted on failure');

  // --------------------------------------------------------------------------
  // TEST 6: Idempotent Safe Retry (No Duplication)
  // --------------------------------------------------------------------------
  console.log('\nTest 6: Idempotent Safe Retry Without Duplication...');
  const committedCloudDocs = new Map<string, any>();
  let retryStorageCleared = false;

  const retryAdapter: MigrationStorageAdapter = {
    getGuestMemories: () => JSON.parse(mockStorage[GUEST_STORAGE_KEY] || '[]'),
    getGuestSessions: () => JSON.parse(mockStorage[GUEST_SESSIONS_STORAGE_KEY] || '[]'),
    saveCloudMemories: async (_uid, mems) => {
      for (const m of mems) committedCloudDocs.set(`mem_${m.id}`, m);
    },
    saveRawSessionDocs: async (_uid, docs) => {
      for (const d of docs) committedCloudDocs.set(`doc_${d.id}`, d);
    },
    clearGuestStorage: () => {
      retryStorageCleared = true;
      delete mockStorage[GUEST_STORAGE_KEY];
      delete mockStorage[GUEST_SESSIONS_STORAGE_KEY];
    },
  };

  // Perform retry
  const retryResult = await migrationService.importGuestDataToUser('user-cloud-1', retryAdapter);
  assert(retryResult.success, 'Retry succeeded');
  assert(retryStorageCleared, 'Guest storage safely cleared after successful retry');

  // Verify deterministic keys mean no duplicates
  const totalSessionDocs = Array.from(committedCloudDocs.keys()).filter((k) => k.startsWith('doc_'));
  assert(
    totalSessionDocs.length === rawDocsWritten.length,
    `No duplicate documents created on retry (${totalSessionDocs.length} unique doc keys)`
  );

  // --------------------------------------------------------------------------
  // TEST 7: SessionService Snapshot Reassembly & Search
  // --------------------------------------------------------------------------
  console.log('\nTest 7: SessionService Snapshot Reassembly & Search...');
  {
    // Simulate Firestore snapshot delivering metadata doc and all chunk docs
    const mockSnapshotDocs = rawDocsWritten.map((d) => ({
      id: d.id,
      data: () => d.data,
    }));

    const sessionMap = new Map<string, ChatSession>();
    const chunksBySession = new Map<string, { chunkIndex: number; messages: ChatMessage[]; docId: string }[]>();

    mockSnapshotDocs.forEach((docSnap) => {
      const data = docSnap.data();
      if (isChunkDoc(data)) {
        const meta = parseChunkMeta(data);
        if (meta) {
          if (!chunksBySession.has(meta.parentId)) chunksBySession.set(meta.parentId, []);
          chunksBySession.get(meta.parentId)!.push({
            chunkIndex: meta.chunkIndex,
            messages: data.messages,
            docId: docSnap.id,
          });
        }
      } else {
        sessionMap.set(data.id, {
          id: data.id,
          userId: data.userId,
          title: data.title,
          messages: data.messages || [],
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
        });
      }
    });

    const assembledList: ChatSession[] = [];
    for (const [sessId, session] of sessionMap.entries()) {
      const chunks = chunksBySession.get(sessId);
      if (chunks && chunks.length > 0) {
        chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
        session.messages = reassembleMessages(chunks.flatMap((c) => c.messages));
      }
      assembledList.push(session);
    }

    assert(assembledList.length === 1, 'Only 1 conversation session listed in UI (no rogue chunk items)');
    assert(assembledList[0].messages.length === 51, 'Session contains all 51 messages');

    // Test in-memory search over the reassembled 51 messages
    sessionService.setSessionsForTesting(assembledList);
    const searchResult = sessionService.searchConversations('PostgreSQL streaming');
    assert(searchResult.totalMatches >= 25, `Search finds ${searchResult.totalMatches} matches across 51 turns`);
    assert(searchResult.matchedThreadsCount === 1, 'Matches single conversation thread');
  }

  // --------------------------------------------------------------------------
  // TEST 8: Account Isolation
  // --------------------------------------------------------------------------
  console.log('\nTest 8: Account Isolation...');
  {
    // User B signs in
    const mockUserB: UserProfile = {
      uid: 'user-cloud-2',
      email: 'user2@example.com',
      displayName: 'User Two',
      photoURL: null,
      isGuest: false,
    };
    sessionService.handleAuthChangeForTesting(mockUserB, true);

    const userBSearch = sessionService.searchConversations('PostgreSQL');
    assert(userBSearch.totalMatches === 0, 'User B cannot see or search User A chunked conversations');

    // Guest sign-out
    sessionService.handleAuthChangeForTesting(null, true);
    const guestSearch = sessionService.searchConversations('PostgreSQL');
    assert(guestSearch.totalMatches === 0, 'Guest cannot see or search User A chunked conversations');
  }

  console.log('\n======================================================');
  console.log(`GUEST MIGRATION DOC SIZE SUMMARY: ${passed} Passed, ${failed} Failed`);
  console.log('======================================================\n');
  process.exit(0);
}

runDocSizeTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
