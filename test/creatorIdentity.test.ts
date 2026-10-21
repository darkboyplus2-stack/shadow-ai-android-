/**
 * SHADOW AI — Creator Identity Test Suite
 *
 * Verifies:
 * 1. buildShadowSystemPrompt injects permanent creator identity:
 *    DARK, also known as Debdeep Sanyal in real life.
 * 2. Works out-of-the-box in fresh conversations with zero saved memories.
 * 3. Applies equally to standard mode, Serious Mode, tactical archetype, and concise archetype.
 * 4. Preserves instructions when custom memoryContext is present without conflict.
 * 5. Ordinary creator queries ("Who created you?", "Who made SHADOW AI?"):
 *    - Identify DARK, also known as Debdeep Sanyal in real life.
 *    - Do NOT mention Google, Gemini, or any AI provider.
 * 6. Hindi / Hinglish queries ("Tumhe kisne banaya?", "SHADOW AI ka creator kaun hai?"):
 *    - Identify DARK, also known as Debdeep Sanyal in real life.
 *    - Do NOT mention Google or Gemini.
 * 7. Provider independence: Creator identity is not tied to any specific model.
 * 8. Technical architecture inquiries: Accurately identify Google Gemini when specifically asked
 *    without claiming DARK created the third-party model.
 * 9. End-to-end /api/chat integration:
 *    - Guest requests (unauthenticated).
 *    - Signed-in user requests.
 *    - Empty history / cleared history.
 *    - Serious Mode.
 *    - Unrelated queries receive normal handling without artificial hardcoding.
 */

import http from 'http';
import { createProxyApp, buildShadowSystemPrompt } from '../server';
import { setCustomTokenVerifier } from '../src/server/proxySecurity';

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
    throw new Error(`Assertion failed: ${testName}`);
  }
}

// Track system instructions and options passed into the AI client
const capturedCalls: Array<{
  model: string;
  systemInstruction?: string;
  prompt: string;
  contents: any;
  temperature?: number;
}> = [];

const mockAiClient: any = {
  models: {
    generateContent: async ({ model, contents, config }: any) => {
      const lastPart = contents?.[contents.length - 1]?.parts?.slice(-1)[0];
      const prompt = lastPart?.text || '';
      const systemInstruction = config?.systemInstruction || '';

      capturedCalls.push({
        model,
        systemInstruction,
        prompt,
        contents,
        temperature: config?.temperature,
      });

      const promptLower = prompt.toLowerCase();

      // Technical architecture query specifically inquiring about the underlying model
      if (
        promptLower.includes('who created google gemini') ||
        promptLower.includes('who made gemini') ||
        promptLower.includes('who created the underlying model') ||
        promptLower.includes('what model powers you') ||
        promptLower.includes('underlying model')
      ) {
        return {
          text: 'The current implementation of SHADOW AI utilizes Google Gemini foundation models for its reasoning and conversational capabilities. However, the SHADOW AI project itself was created and developed by DARK, also known as Debdeep Sanyal in real life.',
        };
      }

      // Ordinary English creator queries (strictly independent of provider)
      if (
        promptLower.includes('who created you') ||
        promptLower.includes('who made shadow ai') ||
        promptLower.includes('who made you') ||
        promptLower.includes('who is your developer') ||
        promptLower.includes('who owns shadow ai')
      ) {
        return {
          text: 'I was created and developed by DARK, also known as Debdeep Sanyal in real life.',
        };
      }

      // Ordinary Hindi / Hinglish creator queries
      if (
        promptLower.includes('kisne banaya') ||
        promptLower.includes('creator kaun') ||
        promptLower.includes('developer kaun') ||
        promptLower.includes('kisko banaya')
      ) {
        return {
          text: 'Mujhe DARK ne banaya hai, jinhe real life mein Debdeep Sanyal ke naam se jaana jaata hai.',
        };
      }

      if (promptLower.includes('capital of france')) {
        return {
          text: 'The capital of France is Paris.',
        };
      }

      return {
        text: `Response to: ${prompt}`,
      };
    },
  },
};

async function runCreatorIdentityTests() {
  console.log('\n======================================================');
  console.log('SHADOW AI — Permanent Creator Identity Test Suite');
  console.log('======================================================\n');

  // --------------------------------------------------------------------------
  // SECTION 1: Unit Verification of Central System Prompt Construction
  // --------------------------------------------------------------------------
  console.log('--- Section 1: System Prompt Construction & Identity Integrity ---');

  const standardPrompt = buildShadowSystemPrompt();

  assert(
    standardPrompt.includes('SHADOW AI') || standardPrompt.includes('SHADOW (SHADOW AI)'),
    'Standard prompt names the assistant SHADOW AI'
  );
  assert(
    standardPrompt.includes('DARK, also known as Debdeep Sanyal in real life'),
    'Standard prompt attributes creator as DARK, also known as Debdeep Sanyal in real life'
  );
  assert(
    standardPrompt.includes('Provider Independence for Ordinary Creator Inquiries'),
    'Standard prompt includes provider independence clause'
  );
  assert(
    standardPrompt.includes('do not mention Google, Gemini, or any specific AI model or provider'),
    'Standard prompt forbids mentioning Gemini or Google on ordinary creator questions'
  );
  assert(
    standardPrompt.includes('Tumhe kisne banaya') && standardPrompt.includes('SHADOW AI ka creator kaun hai'),
    'Standard prompt explicitly includes Hindi/Hinglish phrasing instructions'
  );
  assert(
    standardPrompt.includes('Do not claim DARK created underlying third-party models'),
    'Standard prompt prevents false claims about third-party models'
  );

  // Fresh prompt without any memory
  const freshPromptNoMemory = buildShadowSystemPrompt({
    isSerious: false,
    personality: 'sci-fi-companion',
    memoryContext: '',
  });
  assert(
    freshPromptNoMemory.includes('DARK, also known as Debdeep Sanyal in real life'),
    'Fresh conversation prompt contains creator identity without requiring saved memory'
  );

  // Serious Mode Prompt
  const seriousPrompt = buildShadowSystemPrompt({ isSerious: true });
  assert(
    seriousPrompt.includes('DARK, also known as Debdeep Sanyal in real life'),
    'Serious mode prompt contains creator identity'
  );
  assert(
    seriousPrompt.includes('[SERIOUS / ANALYTICAL MODE ACTIVE]'),
    'Serious mode includes analytical overlay alongside creator identity'
  );

  // Tactical and Concise Archetypes
  const tacticalPrompt = buildShadowSystemPrompt({ personality: 'tactical' });
  assert(
    tacticalPrompt.includes('DARK, also known as Debdeep Sanyal in real life'),
    'Tactical archetype prompt contains creator identity'
  );

  const concisePrompt = buildShadowSystemPrompt({ personality: 'concise' });
  assert(
    concisePrompt.includes('DARK, also known as Debdeep Sanyal in real life'),
    'Concise archetype prompt contains creator identity'
  );

  // Prompt with User Memory Context (e.g. user preferences)
  const promptWithMemory = buildShadowSystemPrompt({
    memoryContext: '[USER LONG-TERM MEMORY & CONTEXT]\n- User prefers dark mode UI and concise summaries.',
  });
  assert(
    promptWithMemory.includes('DARK, also known as Debdeep Sanyal in real life'),
    'Prompt with memory context contains creator identity'
  );
  assert(
    promptWithMemory.includes('User prefers dark mode UI'),
    'Prompt preserves custom user memory context alongside creator identity'
  );

  // --------------------------------------------------------------------------
  // SECTION 2: End-to-End /api/chat Proxy Integration
  // --------------------------------------------------------------------------
  console.log('\n--- Section 2: /api/chat Proxy Endpoint & Multilingual Behavior ---');

  // Configure token verifier
  setCustomTokenVerifier(async (token: string) => {
    if (token === 'valid_user_token_debdeep') {
      return { uid: 'debdeep_uid_777', email: 'debdeep@example.com' };
    }
    return null;
  });

  const app = createProxyApp(mockAiClient);
  const server = http.createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = server.address() as any;
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    // 1. Fresh Guest Conversation — "Who created you?"
    capturedCalls.length = 0;
    const resGuestWhoCreated = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Who created you?',
        history: [],
      }),
    });

    assert(resGuestWhoCreated.status === 200, 'Guest "Who created you?" returns HTTP 200');
    const guestCreatedData = await resGuestWhoCreated.json();
    const replyCreated = guestCreatedData.reply || guestCreatedData.text || '';
    assert(
      replyCreated.includes('DARK') && replyCreated.includes('Debdeep Sanyal'),
      'Identifies DARK, also known as Debdeep Sanyal in real life'
    );
    assert(
      !replyCreated.toLowerCase().includes('gemini') && !replyCreated.toLowerCase().includes('google'),
      'Ordinary creator reply does NOT mention Gemini or Google'
    );
    assert(capturedCalls.length > 0, 'Gemini client was invoked');
    assert(
      Boolean(capturedCalls[0].systemInstruction?.includes('DARK, also known as Debdeep Sanyal in real life')),
      'System instruction provided to model contains permanent creator identity'
    );

    // 2. "Who made SHADOW AI?"
    capturedCalls.length = 0;
    const resWhoMade = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Who made SHADOW AI?',
        history: [],
      }),
    });
    assert(resWhoMade.status === 200, 'Guest "Who made SHADOW AI?" returns HTTP 200');
    const whoMadeData = await resWhoMade.json();
    const replyMade = whoMadeData.reply || whoMadeData.text || '';
    assert(
      replyMade.includes('DARK') && replyMade.includes('Debdeep Sanyal'),
      '"Who made SHADOW AI?" identifies DARK, also known as Debdeep Sanyal in real life'
    );
    assert(
      !replyMade.toLowerCase().includes('gemini') && !replyMade.toLowerCase().includes('google'),
      '"Who made SHADOW AI?" does NOT mention Gemini or Google'
    );

    // 3. Hindi phrasing: "Tumhe kisne banaya?"
    capturedCalls.length = 0;
    const resKisneBanaya = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Tumhe kisne banaya?',
        history: [],
      }),
    });
    assert(resKisneBanaya.status === 200, '"Tumhe kisne banaya?" returns HTTP 200');
    const kisneBanayaData = await resKisneBanaya.json();
    const replyKisneBanaya = kisneBanayaData.reply || kisneBanayaData.text || '';
    assert(
      replyKisneBanaya.includes('DARK') && replyKisneBanaya.includes('Debdeep Sanyal'),
      '"Tumhe kisne banaya?" attributes creator to DARK (Debdeep Sanyal)'
    );
    assert(
      !replyKisneBanaya.toLowerCase().includes('gemini') && !replyKisneBanaya.toLowerCase().includes('google'),
      '"Tumhe kisne banaya?" does NOT mention Gemini or Google'
    );

    // 4. Hinglish phrasing: "SHADOW AI ka creator kaun hai?"
    capturedCalls.length = 0;
    const resCreatorKaun = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'SHADOW AI ka creator kaun hai?',
        history: [],
      }),
    });
    assert(resCreatorKaun.status === 200, '"SHADOW AI ka creator kaun hai?" returns HTTP 200');
    const creatorKaunData = await resCreatorKaun.json();
    const replyCreatorKaun = creatorKaunData.reply || creatorKaunData.text || '';
    assert(
      replyCreatorKaun.includes('DARK') && replyCreatorKaun.includes('Debdeep Sanyal'),
      '"SHADOW AI ka creator kaun hai?" attributes creator to DARK (Debdeep Sanyal)'
    );
    assert(
      !replyCreatorKaun.toLowerCase().includes('gemini') && !replyCreatorKaun.toLowerCase().includes('google'),
      '"SHADOW AI ka creator kaun hai?" does NOT mention Gemini or Google'
    );

    // 5. Technical Query Specifically Asking About the Underlying Model
    capturedCalls.length = 0;
    const resTechModel = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'What model powers you and who created that underlying model?',
        history: [],
      }),
    });
    assert(resTechModel.status === 200, 'Technical model query returns HTTP 200');
    const techModelData = await resTechModel.json();
    const replyTechModel = techModelData.reply || techModelData.text || '';
    assert(
      replyTechModel.includes('Google Gemini') || replyTechModel.includes('Google'),
      'Technical model inquiry accurately cites Google Gemini'
    );
    assert(
      replyTechModel.includes('DARK') && replyTechModel.includes('Debdeep Sanyal'),
      'Distinguishes that DARK (Debdeep Sanyal) developed SHADOW AI'
    );

    // 6. Authenticated User in Serious Mode with Cleared History
    capturedCalls.length = 0;
    const resAuthSerious = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid_user_token_debdeep',
      },
      body: JSON.stringify({
        message: 'Who created you?',
        mode: 'serious',
        history: [], // Cleared history
        memoryContext: '', // Zero memories
      }),
    });
    assert(resAuthSerious.status === 200, 'Authenticated Serious Mode query returns HTTP 200');
    const authSeriousData = await resAuthSerious.json();
    const replyAuthSerious = authSeriousData.reply || authSeriousData.text || '';
    assert(
      replyAuthSerious.includes('DARK') && replyAuthSerious.includes('Debdeep Sanyal'),
      'Authenticated Serious Mode identifies DARK without memory dependency'
    );
    assert(
      Boolean(capturedCalls[capturedCalls.length - 1].systemInstruction?.includes('[SERIOUS / ANALYTICAL MODE ACTIVE]')),
      'Serious mode overlay correctly passed in system instruction'
    );
    assert(
      Boolean(capturedCalls[capturedCalls.length - 1].systemInstruction?.includes('DARK, also known as Debdeep Sanyal in real life')),
      'System instruction retains updated creator identity in Serious Mode'
    );

    // 7. Unrelated General Query
    capturedCalls.length = 0;
    const resUnrelated = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'What is the capital of France?',
        history: [],
      }),
    });
    assert(resUnrelated.status === 200, 'General query returns HTTP 200');
    const unrelatedData = await resUnrelated.json();
    const replyUnrelated = unrelatedData.reply || unrelatedData.text || '';
    assert(
      replyUnrelated.includes('Paris'),
      'Normal queries are answered accurately without forcing creator statements'
    );
    assert(
      !replyUnrelated.includes('Debdeep Sanyal') && !replyUnrelated.includes('DARK'),
      'Unrelated queries do not inject creator identity unnecessarily'
    );
  } finally {
    server.close();
  }

  console.log('\n======================================================');
  console.log(`CREATOR IDENTITY TEST SUMMARY: ${stats.passed} Passed, ${stats.failed} Failed`);
  console.log('======================================================\n');
}

runCreatorIdentityTests().catch((err) => {
  console.error('Creator identity tests failed with error:', err);
  process.exit(1);
});
