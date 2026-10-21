/**
 * SHADOW AI — Smart Conversation Search Feature Unit & Integration Test Suite
 *
 * Verifies:
 * 1. Searching user messages and assistant responses across conversation threads.
 * 2. Case-insensitive, multi-word, and partial keyword matching.
 * 3. Multilingual search (English, Hindi, Hinglish).
 * 4. Empty queries (returns clean zero-state) and no-result states.
 * 5. Extracting relevant snippets with context around matching keywords.
 * 6. Opening the correct thread and locating the matching message ID.
 * 7. Client-side privacy and user isolation (Guest vs User A vs User B).
 * 8. Deleted thread safety and stale result handling.
 */

import {
  sessionService,
  ChatSession,
  extractSearchSnippet,
} from '../src/services/sessionService';
import { UserProfile } from '../src/services/authService';

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

async function runSearchTests() {
  console.log('======================================================');
  console.log('SHADOW AI — Conversation Search Test Suite');
  console.log('======================================================\n');

  // Test 1: Snippet Extraction
  console.log('Test 1: Context Snippet Extraction...');
  {
    const longText = 'We should optimize the Node.js event loop by eliminating long-running synchronous loops and leveraging worker threads for CPU intensive operations.';
    const snippet = extractSearchSnippet(longText, 'event loop');
    assert(snippet.includes('event loop'), 'Snippet contains the search keyword');
    assert(snippet.length <= 150, 'Snippet is appropriately bounded in length');

    const emptySnippet = extractSearchSnippet('', 'test');
    assert(emptySnippet === '', 'Empty text yields empty snippet');

    const nonMatchSnippet = extractSearchSnippet('Short text without keyword', 'missing');
    assert(nonMatchSnippet.includes('Short text'), 'Fallback snippet returns truncated prefix');
  }

  // Setup mock sessions for testing search
  const session1: ChatSession = {
    id: 'sess-arch-1',
    userId: 'guest',
    title: 'Microservices Architecture Review',
    createdAt: new Date('2026-10-18T10:00:00Z').toISOString(),
    updatedAt: new Date('2026-10-18T10:30:00Z').toISOString(),
    messages: [
      {
        id: 'msg-1',
        sender: 'user',
        text: 'How should we architect our backend using Docker and Kubernetes?',
        timestamp: '10:00 AM',
      },
      {
        id: 'msg-2',
        sender: 'shadow',
        text: 'For scalable deployments, Docker containers orchestrated by Kubernetes provide fault tolerance and rolling updates.',
        timestamp: '10:01 AM',
      },
      {
        id: 'msg-3',
        sender: 'user',
        text: 'What about database connections and pooling in PostgreSQL?',
        timestamp: '10:05 AM',
      },
    ],
  };

  const session2: ChatSession = {
    id: 'sess-mobile-2',
    userId: 'guest',
    title: 'Android APK Build Pipeline',
    createdAt: new Date('2026-10-19T14:00:00Z').toISOString(),
    updatedAt: new Date('2026-10-19T14:25:00Z').toISOString(),
    messages: [
      {
        id: 'msg-4',
        sender: 'user',
        text: 'Fix the Gradle build failure in GitHub Actions for my Android APK release.',
        timestamp: '02:00 PM',
      },
      {
        id: 'msg-5',
        sender: 'shadow',
        text: 'The Gradle daemon failed because of a hardcoded Java home path in gradle.properties.',
        timestamp: '02:01 PM',
      },
    ],
  };

  const session3: ChatSession = {
    id: 'sess-hinglish-3',
    userId: 'guest',
    title: 'Hinglish Chai Banter',
    createdAt: new Date('2026-10-20T08:00:00Z').toISOString(),
    updatedAt: new Date('2026-10-20T08:15:00Z').toISOString(),
    messages: [
      {
        id: 'msg-6',
        sender: 'user',
        text: 'Bhai, badhiya chai kaise banate hain masala wali?',
        timestamp: '08:00 AM',
      },
      {
        id: 'msg-7',
        sender: 'shadow',
        text: 'Adrak, elaichi aur thodi daalchini daal kar doodh ko acche se ubaal lo, perfect masala chai banegi!',
        timestamp: '08:01 AM',
      },
    ],
  };

  sessionService.setSessionsForTesting([session1, session2, session3]);

  // Test 2: Searching User Messages and Assistant Responses
  console.log('\nTest 2: Searching User Messages & Assistant Responses...');
  {
    // Search user question term: "Kubernetes"
    const k8sResults = sessionService.searchConversations('Kubernetes');
    assert(k8sResults.totalMatches >= 2, 'Found matches in both user question and assistant reply');
    assert(k8sResults.matchedThreadsCount === 1, 'Correctly matched 1 thread');
    assert(k8sResults.matches.some((m) => m.sender === 'user'), 'Matched user question');
    assert(k8sResults.matches.some((m) => m.sender === 'shadow'), 'Matched assistant response');

    // Search assistant-specific technical term: "gradle.properties"
    const gradleResults = sessionService.searchConversations('gradle.properties');
    assert(gradleResults.totalMatches >= 1, 'Found match for assistant technical explanation');
    assert(gradleResults.matches[0].sessionId === 'sess-mobile-2', 'Matched correct session ID');
    assert(gradleResults.matches[0].messageId === 'msg-5', 'Matched specific assistant message ID');
  }

  // Test 3: Thread Title Matches
  console.log('\nTest 3: Thread Title Matches...');
  {
    const titleResults = sessionService.searchConversations('Architecture Review');
    assert(titleResults.totalMatches > 0, 'Found match on thread title');
    const titleMatch = titleResults.matches.find((m) => m.matchType === 'title');
    assert(Boolean(titleMatch), 'Includes match categorized as "title"');
    assert(titleMatch?.sessionId === 'sess-arch-1', 'Identified session from title');
  }

  // Test 4: Case-Insensitive, Multi-word, and Partial Matching
  console.log('\nTest 4: Case-Insensitive, Multi-Word, and Partial Matching...');
  {
    // Lowercase vs Uppercase
    const lowerRes = sessionService.searchConversations('docker');
    const upperRes = sessionService.searchConversations('DOCKER');
    assert(lowerRes.totalMatches === upperRes.totalMatches, 'Case-insensitive search returns identical match count');

    // Partial word: "deploy" matches "deployments"
    const partialRes = sessionService.searchConversations('deploy');
    assert(partialRes.totalMatches >= 1, 'Partial keyword matches whole word stem');
    assert(partialRes.matches[0].text.includes('deployments'), 'Matched word containing stem');

    // Multi-word across message: "PostgreSQL pooling"
    const multiRes = sessionService.searchConversations('PostgreSQL pooling');
    assert(multiRes.totalMatches >= 1, 'Matches multi-word query across message');
    assert(multiRes.matches[0].messageId === 'msg-3', 'Identified message containing both tokens');
  }

  // Test 5: Multilingual Support (Hindi & Hinglish)
  console.log('\nTest 5: Multilingual Search (Hinglish / Hindi)...');
  {
    const chaiRes = sessionService.searchConversations('masala chai');
    assert(chaiRes.totalMatches >= 2, 'Found Hinglish matches across user and assistant turns');
    assert(chaiRes.matches[0].sessionId === 'sess-hinglish-3', 'Identified Hinglish session');

    const adrakRes = sessionService.searchConversations('adrak elaichi');
    assert(adrakRes.totalMatches >= 1, 'Found specific Hinglish ingredient tokens in assistant reply');
  }

  // Test 6: Empty Queries & No-Result Handling
  console.log('\nTest 6: Empty Queries & No-Result States...');
  {
    const emptyQuery = sessionService.searchConversations('');
    assert(emptyQuery.totalMatches === 0, 'Empty query returns 0 matches');
    assert(emptyQuery.matches.length === 0, 'Empty query returns empty array');

    const whitespaceQuery = sessionService.searchConversations('    ');
    assert(whitespaceQuery.totalMatches === 0, 'Whitespace query returns 0 matches');

    const noMatches = sessionService.searchConversations('quantum teleportation entanglement');
    assert(noMatches.totalMatches === 0, 'Unrelated query returns 0 matches');
    assert(noMatches.matchedThreadsCount === 0, 'Matched threads count is 0');
    assert(noMatches.matches.length === 0, 'Matches array is empty');
  }

  // Test 7: Locating Matching Message and Thread Selection
  console.log('\nTest 7: Navigating to Matching Message & Thread Selection...');
  {
    const searchRes = sessionService.searchConversations('fault tolerance');
    assert(searchRes.totalMatches === 1, 'Found exact match for fault tolerance');
    const topMatch = searchRes.matches[0];

    // Verify session lookup
    const foundSession = sessionService.getSessions().find((s) => s.id === topMatch.sessionId);
    assert(Boolean(foundSession), 'Target session exists in sessionService');
    assert(foundSession?.title === 'Microservices Architecture Review', 'Correct session title retrieved');

    // Verify message lookup inside session
    const targetMsg = foundSession?.messages.find((m) => m.id === topMatch.messageId);
    assert(Boolean(targetMsg), 'Matching message exists in session messages');
    assert(targetMsg?.id === 'msg-2', 'Correct message ID identified for highlight');
    assert(targetMsg?.sender === 'shadow', 'Identified sender as assistant');
  }

  // Test 8: Stale Results & Deleted Thread Safety
  console.log('\nTest 8: Deleted Thread & Stale Result Safety...');
  {
    // Search for Android APK session
    const preDeleteRes = sessionService.searchConversations('APK');
    assert(preDeleteRes.totalMatches > 0, 'Found APK matches before deletion');

    // Delete session
    await sessionService.deleteSession('sess-mobile-2');

    // Verify search results reflect immediate deletion
    const postDeleteRes = sessionService.searchConversations('APK');
    assert(postDeleteRes.totalMatches === 0, 'Deleted session is no longer returned in search results');

    // Verify that attempting to select a deleted session ID safely fails
    const deletedSession = sessionService.getSessions().find((s) => s.id === 'sess-mobile-2');
    assert(!deletedSession, 'Deleted session cannot be resolved from sessionService');
  }

  // Test 9: Data Privacy & User Isolation (Guest vs User A vs User B)
  console.log('\nTest 9: User Isolation & Client-Side Privacy...');
  {
    // 1. User A signs in
    const mockUserA: UserProfile = {
      uid: 'user-alpha-123',
      email: 'alpha@example.com',
      displayName: 'Alpha',
      photoURL: null,
      isGuest: false,
    };

    sessionService.handleAuthChangeForTesting(mockUserA, true);
    sessionService.setSessionsForTesting([
      {
        id: 'sess-alpha-private',
        userId: 'user-alpha-123',
        title: 'Alpha Confidential Strategy',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: [
          {
            id: 'msg-alpha-1',
            sender: 'user',
            text: 'Here is the secret financial quarterly forecast for Q4.',
            timestamp: '11:00 AM',
          },
        ],
      },
    ]);

    // Search when signed in as User A
    const alphaSearch = sessionService.searchConversations('financial');
    assert(alphaSearch.totalMatches >= 1, 'User A finds their private conversation');
    assert(alphaSearch.matches[0].sessionId === 'sess-alpha-private', 'User A matches correct session');

    // 2. User B signs in
    const mockUserB: UserProfile = {
      uid: 'user-beta-456',
      email: 'beta@example.com',
      displayName: 'Beta',
      photoURL: null,
      isGuest: false,
    };

    sessionService.handleAuthChangeForTesting(mockUserB, true);

    // Search when signed in as User B
    const betaSearch = sessionService.searchConversations('financial');
    assert(betaSearch.totalMatches === 0, 'User B CANNOT see or search User A private conversations');

    const betaAllSearch = sessionService.searchConversations('secret');
    assert(betaAllSearch.totalMatches === 0, 'Zero leakage of User A data to User B');

    // 3. Sign out to guest
    sessionService.handleAuthChangeForTesting(null, true);
    const guestSearch = sessionService.searchConversations('financial');
    assert(guestSearch.totalMatches === 0, 'Guest mode CANNOT see or search User A private conversations');
  }

  console.log('\n======================================================');
  console.log(`CONVERSATION SEARCH TESTS SUMMARY: ${passed} Passed, ${failed} Failed`);
  console.log('======================================================\n');
  process.exit(0);
}

runSearchTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
