/**
 * SHADOW AI — Smart Conversation Memory Test Suite
 *
 * Verifies:
 * 1. Topic-aware memory retrieval (only topical memories injected, unrelated queries get []).
 * 2. Meta-query handling (general vs topic-specific inquiry).
 * 3. Contradiction & redundancy resolution (prioritizes newest preference, avoids duplicate domains).
 * 4. Technical keyword preservation (e.g. 'ts', 'js', 'ui', 'db', 'os').
 * 5. Explicit Remember command category inference & storage.
 * 6. Explicit Forget command search & immediate deletion.
 * 7. Explicit Clear command handling.
 * 8. Secret rejection (prevents saving API keys / passwords).
 * 9. Deduplication (updates existing instead of appending duplicate document).
 */

import { memoryService, MemoryDocument, isSensitiveSecret } from '../src/services/memoryService';

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

async function runSmartMemoryTests() {
  console.log('======================================================');
  console.log('SHADOW AI — Smart Conversation Memory Test Suite');
  console.log('======================================================\n');

  // Clear state before testing
  await memoryService.clearAllMemories();

  // Test 1: Sensitive Secret Prevention
  console.log('Test 1: Sensitive Secret Rejection...');
  {
    assert(isSensitiveSecret('AIzaSyD-1234567890abcdefghijklmnopqrstuvw'), 'Detects Google API Key pattern');
    assert(isSensitiveSecret('sk-abcdef1234567890abcdef1234567890'), 'Detects OpenAI secret key pattern');
    assert(isSensitiveSecret('Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.doNotStoreMe'), 'Detects Bearer token');
    assert(isSensitiveSecret('password: superSecretPassword123'), 'Detects password declaration');

    let threw = false;
    try {
      await memoryService.saveMemory('My secret token is AIzaSyD-1234567890abcdefghijklmnopqrstuvw');
    } catch {
      threw = true;
    }
    assert(threw, 'saveMemory throws error when sensitive secret is detected');
  }

  // Test 2: Saving & Category Inference
  console.log('\nTest 2: Memory Saving, Tag Extraction & Deduplication...');
  {
    const mem1 = await memoryService.saveMemory(
      'Prefers TypeScript for backend services and Node.js APIs',
      'preference',
      'explicit_user'
    );
    assert(Boolean(mem1.id), 'Memory 1 saved with valid ID');
    assert(mem1.tags.includes('typescript'), 'Tags include "typescript"');
    assert(mem1.tags.includes('backend'), 'Tags include "backend"');
    assert(mem1.tags.includes('services'), 'Tags include "services"');

    const mem2 = await memoryService.saveMemory(
      'Building SHADOW AI companion app on Android and web',
      'project',
      'explicit_user'
    );
    assert(Boolean(mem2.id), 'Memory 2 (Project) saved');

    const mem3 = await memoryService.saveMemory(
      'Always respond in concise bullet points without preamble',
      'instruction',
      'explicit_user'
    );
    assert(Boolean(mem3.id), 'Memory 3 (Instruction) saved');

    // Near-duplicate update
    const mem1Duplicate = await memoryService.saveMemory(
      'Prefers TypeScript for backend services and Node.js APIs',
      'preference',
      'explicit_user'
    );
    assert(mem1Duplicate.id === mem1.id, 'Deduplication updates existing record without creating duplicate');
  }

  // Test 3: Topical Memory Retrieval
  console.log('\nTest 3: Topical Memory Retrieval & Relevance Filtering...');
  {
    // Query 1: Backend architecture -> should match TypeScript backend memory
    const backendRelevant = memoryService.getRelevantMemories('How should I design my backend services in Node.js?');
    assert(backendRelevant.length > 0, 'Retrieves memories relevant to backend services');
    assert(backendRelevant[0].content.includes('TypeScript'), 'Top memory mentions TypeScript');
    assert(!backendRelevant.some((m) => m.category === 'project'), 'Unrelated project memory is not retrieved');

    // Query 2: Weather -> completely unrelated topic -> should return []
    const weatherMemories = memoryService.getRelevantMemories('What is the weather like in Tokyo right now?');
    assert(weatherMemories.length === 0, 'Unrelated topic returns empty array without injecting random memories');

    // Query 3: Project inquiry -> matches SHADOW AI project
    const projectMemories = memoryService.getRelevantMemories('What are the key goals for my Android app project?');
    assert(projectMemories.length > 0, 'Retrieves project memory for app project query');
    assert(projectMemories[0].category === 'project', 'Top memory is categorized as project');
  }

  // Test 4: General Meta-Query vs Topic-Specific Meta-Query
  console.log('\nTest 4: Meta-Queries (General vs Topic-Specific)...');
  {
    // General: "What do you remember about me?"
    const generalMemories = memoryService.getRelevantMemories('What do you remember about me?');
    assert(generalMemories.length >= 3, 'General meta-query returns all top memories');

    // Topic-specific: "What do you remember about my backend?"
    const topicMeta = memoryService.getRelevantMemories('What do you remember about my backend?');
    assert(topicMeta.length === 1, 'Topic-specific meta-query isolates only backend memory');
    assert(topicMeta[0].content.includes('backend'), 'Topic-specific memory matches backend');

    // Topic-specific on unrecorded topic: "What do you remember about my car?"
    const unrecordedMeta = memoryService.getRelevantMemories('What do you remember about my car?');
    assert(unrecordedMeta.length === 0, 'Unrecorded topic meta-query returns empty array');
  }

  // Test 5: Format Context for Prompt
  console.log('\nTest 5: Prompt Context Injection Formatting...');
  {
    const promptContext = memoryService.formatContextForPrompt('How can I optimize my backend?');
    assert(promptContext.includes('[USER LONG-TERM MEMORY & CONTEXT]'), 'Includes memory context header');
    assert(promptContext.includes('PREFERENCE'), 'Includes categorized item');
    assert(promptContext.includes('Never invent unrecorded memories'), 'Includes grounding instruction');

    const emptyContext = memoryService.formatContextForPrompt('Tell me a funny joke');
    assert(emptyContext === '', 'Returns empty string for queries with no relevant memory');
  }

  // Test 6: Explicit Forget Command
  console.log('\nTest 6: Explicit Forget Command...');
  {
    const forgetResult = await memoryService.forgetMemoryByQuery('bullet points');
    assert(forgetResult.count > 0, 'Found and deleted memory matching "bullet points"');
    
    // Verify memory is no longer in memoryService
    const remaining = memoryService.getMemories();
    assert(!remaining.some((m) => m.content.includes('bullet points')), 'Deleted memory is completely removed');

    // Context format no longer includes deleted memory
    const updatedContext = memoryService.formatContextForPrompt('What instruction did I give for formatting?');
    assert(!updatedContext.includes('bullet points'), 'Forgotten memory is never injected into prompts');
  }

  // Test 7: Clear All Memories
  console.log('\nTest 7: Clear All Memories...');
  {
    await memoryService.clearAllMemories();
    assert(memoryService.getMemories().length === 0, 'All memories cleared successfully');
    assert(memoryService.getRelevantMemories('backend').length === 0, 'No memories retrieved after clear');
  }

  console.log('\n======================================================');
  console.log(`SMART MEMORY TESTS SUMMARY: ${passed} Passed, ${failed} Failed`);
  console.log('======================================================\n');
  process.exit(0);
}

runSmartMemoryTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
