import http from 'http';
import {
  createProxyApp,
  chatRateLimiter,
  memoryExtractRateLimiter,
  transcribeRateLimiter,
  ttsRateLimiter,
  globalApiRateLimiter,
} from '../server';
import {
  SlidingWindowRateLimiter,
  setCustomTokenVerifier,
  resolveClientIp,
} from '../src/server/proxySecurity';

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

// Mock GoogleGenAI client for proxy endpoint handling during testing
const mockAiClient: any = {
  models: {
    generateContent: async ({ contents, model }: any) => {
      // Echo response for verification
      const promptText = contents?.[0]?.parts?.[contents[0].parts.length - 1]?.text || 'Mock AI Response';
      return {
        text: `Echo: ${promptText}`,
        candidates: [
          {
            content: {
              parts: [{ inlineData: { data: Buffer.from('RIFF....WAVEfmt ').toString('base64'), mimeType: 'audio/wav' } }],
            },
          },
        ],
      };
    },
  },
};

async function runSecurityTests() {
  console.log('\n======================================================');
  console.log('SHADOW AI — SEC-02 Gemini API Proxy Security Test Suite');
  console.log('======================================================\n');

  // Reset all rate limiters before test run
  chatRateLimiter.reset();
  memoryExtractRateLimiter.reset();
  transcribeRateLimiter.reset();
  ttsRateLimiter.reset();
  globalApiRateLimiter.reset();

  // Configure custom token verifier for deterministic testing
  setCustomTokenVerifier(async (token: string) => {
    if (token === 'valid_mock_token_uid_101') {
      return { uid: 'user_101', email: 'pilot@shadow.ai' };
    }
    return null; // Invalid or untrusted token
  });

  const app = createProxyApp(mockAiClient);
  const server = http.createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // ------------------------------------------------------------------------
    // TEST 1: Rate-Limit Enforcement on /api/chat (HTTP 429 + Retry-After)
    // ------------------------------------------------------------------------
    console.log('Test 1: Rate-Limit Enforcement on /api/chat...');
    chatRateLimiter.reset();
    globalApiRateLimiter.reset();

    // Send 20 legitimate requests (unauthenticated IP limit is 20)
    for (let i = 0; i < 20; i++) {
      const res = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: `Message ${i}` }),
      });
      if (res.status !== 200) {
        throw new Error(`Expected request ${i} to succeed, got status ${res.status}`);
      }
    }

    // 21st request should be blocked with 429 Too Many Requests
    const blockedRes = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Over quota message' }),
    });

    assert(blockedRes.status === 429, 'Returns HTTP 429 Too Many Requests when rate limit exceeded');
    const retryHeader = blockedRes.headers.get('retry-after');
    assert(Boolean(retryHeader && Number(retryHeader) >= 1), 'Includes valid Retry-After header (seconds >= 1)', retryHeader || 'none');
    assert(blockedRes.headers.get('x-ratelimit-remaining') === '0', 'X-RateLimit-Remaining header is 0');

    const blockedJson = await blockedRes.json();
    assert(blockedJson.code === 'RATE_LIMIT_EXCEEDED', 'Returns code RATE_LIMIT_EXCEEDED in JSON response');
    assert(Boolean(blockedJson.isRetryable), 'Marks rate limit as retryable');

    // ------------------------------------------------------------------------
    // TEST 2: Rate-Limit Enforcement on other expensive endpoints
    // ------------------------------------------------------------------------
    console.log('\nTest 2: Rate-Limit Enforcement on /api/memory/extract, /api/transcribe, /api/tts...');
    memoryExtractRateLimiter.reset();
    transcribeRateLimiter.reset();
    ttsRateLimiter.reset();
    globalApiRateLimiter.reset();

    // Memory extract limit = 25
    for (let i = 0; i < 25; i++) {
      await fetch(`${baseUrl}/api/memory/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userMessage: `Extract memory test ${i}` }),
      });
    }
    const memBlocked = await fetch(`${baseUrl}/api/memory/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userMessage: 'Extract blocked' }),
    });
    assert(memBlocked.status === 429, 'Blocks /api/memory/extract at limit with HTTP 429');

    // TTS limit = 30
    for (let i = 0; i < 30; i++) {
      await fetch(`${baseUrl}/api/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: `Speech test ${i}` }),
      });
    }
    const ttsBlocked = await fetch(`${baseUrl}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Speech blocked' }),
    });
    assert(ttsBlocked.status === 429, 'Blocks /api/tts at limit with HTTP 429');

    // Transcribe limit = 25
    for (let i = 0; i < 25; i++) {
      await fetch(`${baseUrl}/api/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioBase64: 'UklGRg==' }),
      });
    }
    const transBlocked = await fetch(`${baseUrl}/api/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audioBase64: 'UklGRg==' }),
    });
    assert(transBlocked.status === 429, 'Blocks /api/transcribe at limit with HTTP 429');

    // ------------------------------------------------------------------------
    // TEST 3: Oversized Requests Rejection
    // ------------------------------------------------------------------------
    console.log('\nTest 3: Oversized Payload Rejection...');
    chatRateLimiter.reset();
    memoryExtractRateLimiter.reset();
    ttsRateLimiter.reset();
    globalApiRateLimiter.reset();

    // 3a: Message exceeding 12,000 characters
    const hugeMessage = 'A'.repeat(12500);
    const hugeMsgRes = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: hugeMessage }),
    });
    assert(hugeMsgRes.status === 400, 'Rejects chat message exceeding 12,000 characters with HTTP 400');
    const hugeMsgData = await hugeMsgRes.json();
    assert(hugeMsgData.code === 'PAYLOAD_TOO_LARGE', 'Returns code PAYLOAD_TOO_LARGE for huge text prompt');

    // 3b: Text-to-Speech exceeding 2,000 characters
    const hugeTtsText = 'T'.repeat(2500);
    const hugeTtsRes = await fetch(`${baseUrl}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: hugeTtsText }),
    });
    assert(hugeTtsRes.status === 400, 'Rejects TTS text exceeding 2,000 characters with HTTP 400');

    // 3c: Memory extract userMessage exceeding 4,000 characters
    const hugeMemText = 'M'.repeat(4500);
    const hugeMemRes = await fetch(`${baseUrl}/api/memory/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userMessage: hugeMemText }),
    });
    assert(hugeMemRes.status === 400, 'Rejects userMessage exceeding 4,000 characters with HTTP 400');

    // ------------------------------------------------------------------------
    // TEST 4: Invalid Payloads & Malformed Input Rejection
    // ------------------------------------------------------------------------
    console.log('\nTest 4: Invalid Payloads & Malformed Input Rejection...');

    // 4a: Missing required message in /api/chat
    const emptyChatRes = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert(emptyChatRes.status === 400, 'Rejects empty message in /api/chat with HTTP 400');
    const emptyChatData = await emptyChatRes.json();
    assert(emptyChatData.code === 'INVALID_PAYLOAD', 'Returns code INVALID_PAYLOAD');

    // 4b: Malformed history type (string instead of array)
    const badHistoryRes = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hello', history: 'not-an-array' }),
    });
    assert(badHistoryRes.status === 400, 'Rejects malformed history type with HTTP 400');

    // 4c: Unsupported image MIME type
    const badMimeRes = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Inspect this',
        image: { mimeType: 'application/x-executable', data: 'AAA=' },
      }),
    });
    assert(badMimeRes.status === 400, 'Rejects dangerous or unsupported attachment MIME type with HTTP 400');

    // 4d: Malformed JSON payload
    const malformedJsonRes = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"message": "Broken JSON without closing',
    });
    assert(malformedJsonRes.status === 400, 'Rejects malformed JSON with HTTP 400 INVALID_JSON');
    const malformedJsonData = await malformedJsonRes.json();
    assert(malformedJsonData.code === 'INVALID_JSON', 'Returns code INVALID_JSON for unparseable body');

    // ------------------------------------------------------------------------
    // TEST 5: Anti-Spoofing & Client Identity Isolation
    // ------------------------------------------------------------------------
    console.log('\nTest 5: Anti-Spoofing & Verified Identity Isolation...');
    chatRateLimiter.reset();
    globalApiRateLimiter.reset();

    // 5a: Client attempts to forge identity with { userId: 'admin_123' }
    // Must NOT be granted authenticated rate limits or identity
    for (let i = 0; i < 20; i++) {
      await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': 'admin_123' },
        body: JSON.stringify({ message: `Spoof test ${i}`, userId: 'admin_123' }),
      });
    }
    const spoofBlocked = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': 'admin_123' },
      body: JSON.stringify({ message: '21st message with forged userId', userId: 'admin_123' }),
    });
    assert(spoofBlocked.status === 429, 'Spoofed client userId in body/header is ignored and throttled under IP limits');

    // 5b: Authenticated user with valid verified Firebase ID token gets isolated authenticated bucket (limit = 60)
    chatRateLimiter.reset();
    const authHeaders = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer valid_mock_token_uid_101',
    };

    // User can send more than 20 requests (authenticated limit is 60)
    let authPassedCount = 0;
    for (let i = 0; i < 25; i++) {
      const res = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ message: `Auth user msg ${i}` }),
      });
      if (res.status === 200) authPassedCount++;
    }
    assert(authPassedCount === 25, 'Authenticated user with verified ID token gets higher quota (sent 25 requests without 429)');

    // 5c: Forged Bearer token is safely demoted to unauthenticated IP limits
    chatRateLimiter.reset();
    const forgedTokenRes = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer invalid_forged_token',
      },
      body: JSON.stringify({ message: 'Testing forged token fallback' }),
    });
    assert(forgedTokenRes.status === 200, 'Forged token safely degrades to unauthenticated IP tier without crashing');

    // ------------------------------------------------------------------------
    // TEST 6: Normal Legitimate Requests Pass Unhindered
    // ------------------------------------------------------------------------
    console.log('\nTest 6: Normal Legitimate Requests...');
    chatRateLimiter.reset();
    globalApiRateLimiter.reset();

    const normalRes = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Hello SHADOW, what is quantum computing?',
        mode: 'standard',
        personality: 'sci-fi-companion',
      }),
    });
    assert(normalRes.status === 200, 'Normal legitimate chat request succeeds with HTTP 200');
    const normalData = await normalRes.json();
    assert(Boolean(normalData.reply), 'Response contains generated AI reply');
    assert(normalRes.headers.get('x-ratelimit-remaining') !== null, 'Response includes X-RateLimit headers');

    // Status endpoint is accessible
    const statusRes = await fetch(`${baseUrl}/api/status`);
    assert(statusRes.status === 200, 'Status endpoint is accessible with HTTP 200');

    // Diagnostics endpoint is accessible
    const diagRes = await fetch(`${baseUrl}/api/diagnostics`);
    assert(diagRes.status === 200, 'Diagnostics endpoint is accessible with HTTP 200');

  } finally {
    server.close();
  }

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

runSecurityTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
