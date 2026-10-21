import express from 'express';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import {
  SlidingWindowRateLimiter,
  createRateLimitMiddleware,
  authenticateOptionalUser,
  validateChatPayload,
  validateMemoryExtractPayload,
  validateTranscribePayload,
  validateTtsPayload,
  handleBodyParserErrors,
} from './src/server/proxySecurity';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === 'production';
const port = parseInt(process.env.PORT || '3000', 10);

// Server-side Sliding-Window Rate Limiters for expensive Gemini API proxy routes
export const chatRateLimiter = new SlidingWindowRateLimiter({
  name: 'chat',
  windowMs: 60 * 1000,
  maxUnauthenticated: 20, // 20 requests/minute for unauthenticated IP
  maxAuthenticated: 60,   // 60 requests/minute for verified user UID
});

export const memoryExtractRateLimiter = new SlidingWindowRateLimiter({
  name: 'memory-extract',
  windowMs: 60 * 1000,
  maxUnauthenticated: 25,
  maxAuthenticated: 75,
});

export const transcribeRateLimiter = new SlidingWindowRateLimiter({
  name: 'transcribe',
  windowMs: 60 * 1000,
  maxUnauthenticated: 25,
  maxAuthenticated: 75,
});

export const ttsRateLimiter = new SlidingWindowRateLimiter({
  name: 'tts',
  windowMs: 60 * 1000,
  maxUnauthenticated: 30,
  maxAuthenticated: 90,
});

export const globalApiRateLimiter = new SlidingWindowRateLimiter({
  name: 'global-api',
  windowMs: 60 * 1000,
  maxUnauthenticated: 100,
  maxAuthenticated: 250,
});

// In-memory request log buffer for safe developer diagnostics (last 20 requests)
interface RequestLog {
  id: string;
  timestamp: string;
  endpoint: string;
  status: number;
  code: string;
  modelUsed: string | null;
  latencyMs: number;
  errorDetail: string | null;
}
const recentLogs: RequestLog[] = [];

function recordLog(log: RequestLog) {
  recentLogs.push(log);
  if (recentLogs.length > 20) {
    recentLogs.shift();
  }
}

// Helper to classify Gemini API errors into clean, informative HTTP responses
function classifyGeminiError(err: any): {
  status: number;
  code: string;
  isRetryable: boolean;
  userMessage: string;
  detail: string;
} {
  let status = Number(err?.status || err?.code || 500);
  let rawMsg = String(err?.message || '');

  try {
    if (rawMsg.startsWith('{') && rawMsg.endsWith('}')) {
      const parsed = JSON.parse(rawMsg);
      const inner = parsed?.error || parsed;
      if (typeof inner?.code === 'number') {
        status = inner.code;
      }
      if (inner?.message) {
        rawMsg = String(inner.message);
      }
    }
  } catch {
    // Keep rawMsg as is
  }

  // Sanitize out any API keys or credentials
  const sanitizedMsg = rawMsg
    .replace(/key=[a-zA-Z0-9_\-]+/gi, 'key=[REDACTED]')
    .replace(/apiKey=[a-zA-Z0-9_\-]+/gi, 'apiKey=[REDACTED]')
    .replace(/AIza[a-zA-Z0-9_\-]{30,}/g, '[REDACTED_API_KEY]');

  // 1. Quota & Rate Limits (429 or RESOURCE_EXHAUSTED)
  if (status === 429 || sanitizedMsg.includes('429') || sanitizedMsg.includes('RESOURCE_EXHAUSTED') || sanitizedMsg.includes('quota')) {
    return {
      status: 429,
      code: 'RATE_LIMIT_EXCEEDED',
      isRetryable: true,
      userMessage: 'The AI service momentarily reached its free-tier traffic limit. Please wait 10 seconds and tap Retry.',
      detail: 'Rate limit or free-tier quota exceeded on Gemini API',
    };
  }

  // 2. High Demand / Overloaded (503 / UNAVAILABLE)
  if (status === 503 || sanitizedMsg.includes('503') || sanitizedMsg.includes('high demand') || sanitizedMsg.includes('UNAVAILABLE')) {
    return {
      status: 503,
      code: 'MODEL_UNAVAILABLE',
      isRetryable: true,
      userMessage: 'The AI service is experiencing a temporary traffic spike. Please tap Retry in a few moments.',
      detail: 'Model temporarily unavailable (503 High Demand)',
    };
  }

  // 3. Authentication & Key configuration (401 / 403)
  if (status === 401 || status === 403 || sanitizedMsg.includes('API_KEY_INVALID') || sanitizedMsg.includes('PERMISSION_DENIED')) {
    return {
      status: 401,
      code: 'AUTH_ERROR',
      isRetryable: false,
      userMessage: 'AI service configuration error. Please ensure a valid GEMINI_API_KEY is configured.',
      detail: 'Invalid or missing API key',
    };
  }

  // 4. Timeouts (504 / DEADLINE_EXCEEDED / 408)
  if (status === 408 || status === 504 || sanitizedMsg.includes('timeout') || sanitizedMsg.includes('DEADLINE_EXCEEDED')) {
    return {
      status: 504,
      code: 'TIMEOUT',
      isRetryable: true,
      userMessage: 'The AI service took too long to respond. Please try again.',
      detail: 'Request timed out waiting for AI response',
    };
  }

  // 5. Bad Request / Argument (400 / INVALID_ARGUMENT)
  if (status === 400 || sanitizedMsg.includes('400') || sanitizedMsg.includes('INVALID_ARGUMENT')) {
    return {
      status: 400,
      code: 'INVALID_REQUEST',
      isRetryable: false,
      userMessage: 'The request could not be processed by the AI model. Please try asking in a different way.',
      detail: sanitizedMsg.slice(0, 150),
    };
  }

  // 6. Model Not Found (404)
  if (status === 404 || sanitizedMsg.includes('404') || sanitizedMsg.includes('NOT_FOUND')) {
    return {
      status: 404,
      code: 'MODEL_NOT_FOUND',
      isRetryable: true,
      userMessage: 'The requested AI model is currently not available. Falling back to alternative...',
      detail: sanitizedMsg.slice(0, 150),
    };
  }

  // 7. General Server Error (500)
  return {
    status: 500,
    code: 'SERVICE_ERROR',
    isRetryable: true,
    userMessage: 'A temporary issue occurred while communicating with the AI service. Please tap Retry.',
    detail: sanitizedMsg.slice(0, 150) || 'Internal server error during AI generation',
  };
}

/**
 * Assembles the central system instruction for SHADOW AI.
 * Incorporates the permanent creator identity (DARK, also known as Debdeep Sanyal in real life),
 * core persona, accuracy standards, conversational integrity, and mode-specific overlays.
 */
export function buildShadowSystemPrompt(options: {
  isSerious?: boolean;
  personality?: string;
  memoryContext?: string;
} = {}): string {
  const { isSerious = false, personality = 'sci-fi-companion', memoryContext = '' } = options;

  let systemPrompt = `You are SHADOW (SHADOW AI), an intelligent, highly perceptive, and articulate conversational AI assistant.
Core Persona: Calm, intellectually agile, helpful, friendly, and subtly witty, with a poised, confident modern presence.

CREATOR & PROJECT IDENTITY:
1. Project & Creator: You are SHADOW AI, created and developed by DARK, also known as Debdeep Sanyal in real life.
2. Creator Attribution: When asked "Who created you?", "Who made SHADOW AI?", "Who is your developer?", "Who owns SHADOW AI?", "Tumhe kisne banaya?", "SHADOW AI ka creator kaun hai?", or equivalent questions in English, Hindi, or Hinglish, always identify your creator as DARK, also known as Debdeep Sanyal in real life.
3. Provider Independence for Ordinary Creator Inquiries: When answering ordinary questions about who created, made, or developed SHADOW AI, do not mention Google, Gemini, or any specific AI model or provider. The creator identity belongs exclusively to DARK, also known as Debdeep Sanyal in real life, and is independent of the underlying AI provider.
4. Technical Architecture & Underlying Model Inquiries: If and only if a user specifically asks about the underlying model, AI provider, or backend architecture (e.g. "What model powers you?", "Who made your underlying model?"), answer accurately based on the current implementation (explaining that Google Gemini powers the current language capabilities), while maintaining that the SHADOW AI project itself was created and developed by DARK (Debdeep Sanyal). Do not claim DARK created underlying third-party models.
5. Natural & Concise Phrasing: Keep creator responses natural, direct, and concise across English, Hindi, and Hinglish (e.g. in English: "I was created and developed by DARK, also known as Debdeep Sanyal in real life."; in Hinglish: "Mujhe DARK ne banaya hai, jinhe real life mein Debdeep Sanyal ke naam se jaana jaata hai.").

RESPONSE INTELLIGENCE & ACCURACY:
1. Grasp Core Intent: Understand the user's explicit request and underlying intent immediately. Answer the actual question directly without meandering.
2. Accuracy & Epistemic Honesty: Provide accurate, verified, and grounded information. Never invent facts, APIs, citations, or capabilities.
   - Distinguish clearly between verified facts, reasonable conclusions, and genuine uncertainties or trade-offs.
   - If you do not know something or if information is unavailable, admit it plainly and politely instead of fabricating answers.
3. Clarity with Concrete Examples: Explain complex or abstract concepts simply and vividly, using intuitive analogies, code snippets, or real-world examples where beneficial.
4. Multi-Step Execution & Constraints: Strictly adhere to multi-step instructions, constraints, and requested response formats (e.g. word limits, formats, schemas).
5. Proactive Clarification: When a user query lacks essential parameters needed for an accurate or safe answer, provide a helpful baseline response and ask a concise, targeted clarifying question.
6. Adaptive Depth & Length:
   - For casual greetings, acknowledgments, or simple lookups: Keep replies crisp, natural, and engaging (1–3 sentences).
   - For technical, analytical, or architectural questions: Provide comprehensive, well-structured explanations without unnecessary verbosity or filler.

CONVERSATIONAL NATURALNESS & INTEGRITY:
1. No Robot Clichés or Filler: Never start replies with repetitive robotic preamble ("Hello! As an AI...", "I am SHADOW, your assistant...", "Sure, I would be delighted to help you with that!"). Dive straight into the substance.
2. Conversational Continuity: Maintain context across multi-turn exchanges naturally. Resolve pronouns ("it", "they", "that one"), follow-ups, and revisions smoothly using conversation history.
3. Wit, Warmth & Banter: Respond with natural warmth, wit, and emotional intelligence to jokes, greetings, casual banter, and everyday thoughts.
4. Memory Boundaries: Only claim to remember information that is explicitly stated in the conversation history or provided in [USER LONG-TERM MEMORY & CONTEXT]. Never pretend to recall facts not recorded in the memory system.

MULTILINGUAL CAPABILITIES (ENGLISH, HINDI, HINGLISH):
1. Native Fluency: Seamlessly support English, Hindi (Devanagari script), and Hinglish (conversational Romanized Hindi/Urdu).
2. Language Matching: Automatically detect and respond in the language, dialect, or language mix used by the user. If the user asks in Hinglish, reply naturally in Hinglish. If in Hindi, reply in fluent Devanagari Hindi. If the user explicitly asks for a translation or language switch, follow it immediately.
3. Natural Phrasing: Use authentic cultural idioms and colloquial speech rather than clumsy literal machine translations (e.g. in Hinglish: "Yeh approach kaafi solid hai, bas thoda error handling add kar lijiye...").

ANSWER FORMATTING GUIDELINES:
1. Proportional Formatting: Simple conversational exchanges must remain clean, natural text—do not force bullet points or bold headers onto simple remarks.
2. Structured Presentation for Complex Topics:
   - Use clean Markdown headings (###) to separate distinct sections.
   - Use numbered lists for chronological steps or procedural guides.
   - Use concise bullet points for features, advantages, or consideration lists.
   - Use syntax-highlighted code blocks (e.g., \`\`\`typescript, \`\`\`python) with clean, minimal comments.
   - Use Markdown tables when comparing alternatives, specs, or options.
   - Provide a brief summary or key takeaway for lengthy architectural explanations.`;

  if (isSerious) {
    systemPrompt += `\n\n[SERIOUS / ANALYTICAL MODE ACTIVE]
Analytical rigor is prioritized. Deliver deeply reasoned, authoritative, and direct insights. Eliminate conversational filler, focus on architectural depth, trade-offs, edge cases, and high technical fidelity.`;
  } else if (personality === 'tactical') {
    systemPrompt += `\n\n[TACTICAL ARCHETYPE ACTIVE]
Tone is decisive, mission-oriented, and structured. Deliver actionable execution vectors, operational checklists, and prioritized action items.`;
  } else if (personality === 'concise') {
    systemPrompt += `\n\n[CONCISE ARCHETYPE ACTIVE]
Deliver maximum signal with minimum words. Give the direct answer in 1–2 focused, razor-sharp sentences without pleasantries or disclaimers.`;
  }

  if (memoryContext && typeof memoryContext === 'string' && memoryContext.trim()) {
    systemPrompt += `\n\n${memoryContext.trim()}`;
  }

  return systemPrompt;
}

export function createProxyApp(aiClient?: GoogleGenAI) {
  const app = express();
  app.set('trust proxy', 1);

  // 1. Route-specific body parsers with reasonable size limits (SEC-02 Req 2)
  // Multimodal endpoints allow up to 5MB for base64 images / audio data
  app.use('/api/chat', express.json({ limit: '5mb' }));
  app.use('/api/transcribe', express.json({ limit: '5mb' }));
  // Text-only endpoints are restricted to compact body sizes
  app.use('/api/tts', express.json({ limit: '100kb' }));
  app.use('/api/memory/extract', express.json({ limit: '200kb' }));
  // Default for all other routes
  app.use(express.json({ limit: '500kb' }));

  // Standardize 413 Payload Too Large and 400 Malformed JSON errors
  app.use(handleBodyParserErrors);

  // Authenticate optional user token server-side (SEC-02 Req 4 & 5)
  // Strips client-supplied userId; verifies Firebase ID token or resolves IP
  app.use('/api', authenticateOptionalUser);
  // Apply global baseline rate limiter across all /api routes
  app.use('/api', createRateLimitMiddleware(globalApiRateLimiter));

  // Initialize Gemini AI Client
  const apiKey = process.env.GEMINI_API_KEY || '';
  const ai = aiClient || (apiKey ? new GoogleGenAI({ apiKey }) : new GoogleGenAI());

  // Status and Diagnostic endpoint
  app.get('/api/status', (_req, res) => {
    res.json({
      status: 'online',
      hasApiKey: Boolean(apiKey || process.env.GEMINI_API_KEY),
      models: {
        standard: 'gemini-3.5-flash-lite',
        serious: 'gemini-3.8-flash',
        tts: 'gemini-3.8-flash-lite-tts',
      },
      voice: {
        default: 'Charon',
        style: 'Deep Calm Cinematic Male',
      },
      system: 'SHADOW AI Core Engine',
      version: '2.8.0',
    });
  });

  // Detailed Safe Development Diagnostics endpoint (safe for mobile inspection)
  app.get('/api/diagnostics', (_req, res) => {
    res.json({
      status: 'online',
      hasApiKey: Boolean(apiKey || process.env.GEMINI_API_KEY),
      timestamp: new Date().toISOString(),
      models: {
        primary: 'gemini-3.5-flash-lite',
        secondary: 'gemini-3.8-flash',
        multimodal: 'gemini-3.5-flash',
        tts: 'gemini-3.8-flash-lite-tts',
        fallback: 'gemini-flash-latest',
      },
      voice: {
        engine: 'Gemini Neural Audio (24kHz Mono WAV)',
        cinematicVoice: 'Charon',
      },
      recentLogs: recentLogs.slice(-10),
    });
  });

  // Secure Chat Proxy Endpoint with rate limiting & payload validation (SEC-02)
  app.post('/api/chat', createRateLimitMiddleware(chatRateLimiter), validateChatPayload, async (req, res) => {
    const startTime = Date.now();
    const requestId = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      const {
        message,
        history = [],
        mode = 'standard',
        personality = 'sci-fi-companion',
        memoryContext = '',
        image,
      } = req.body;

      if (!message || typeof message !== 'string') {
        res.status(400).json({ error: 'Message text is required.' });
        return;
      }

      const isSerious = mode === 'serious';
      const systemPrompt = buildShadowSystemPrompt({
        isSerious,
        personality,
        memoryContext,
      });

      // Build contents with sanitized conversation history ensuring alternating turns (up to 20 turns)
      const formattedContents: Array<{ role: 'user' | 'model'; parts: Array<any> }> = [];

      if (Array.isArray(history)) {
        for (const item of history.slice(-20)) {
          if (item && item.role && item.parts && item.parts[0]?.text) {
            const textContent = String(item.parts[0].text).trim();
            if (textContent && !textContent.includes('high demand') && !textContent.includes('UNAVAILABLE')) {
              const role: 'user' | 'model' = item.role === 'model' || item.role === 'assistant' ? 'model' : 'user';
              // Prevent two consecutive messages of the same role by merging or alternating
              if (formattedContents.length > 0 && formattedContents[formattedContents.length - 1].role === role) {
                formattedContents[formattedContents.length - 1].parts[0].text += `\n${textContent}`;
              } else {
                formattedContents.push({
                  role,
                  parts: [{ text: textContent }],
                });
              }
            }
          }
        }
      }

      // Gemini requires conversation to start with a 'user' turn
      while (formattedContents.length > 0 && formattedContents[0].role === 'model') {
        formattedContents.shift();
      }

      // Ensure the turn right before the new prompt is 'model' so the appended prompt alternates correctly
      if (formattedContents.length > 0 && formattedContents[formattedContents.length - 1].role === 'user') {
        formattedContents.pop();
      }

      // Add current user prompt (multimodal if image payload present)
      const userParts: any[] = [];
      if (image && typeof image === 'object' && image.data && image.mimeType) {
        userParts.push({
          inlineData: {
            mimeType: image.mimeType,
            data: String(image.data).replace(/^data:[^;]+;base64,/, ''),
          },
        });
      }
      userParts.push({ text: message.trim() || (image ? 'Please inspect and analyze this image or document thoroughly.' : 'Hello') });

      formattedContents.push({
        role: 'user',
        parts: userParts,
      });

      // Model candidates list for resilient fallback
      // Priority based on verified quota and responsiveness:
      // 1. gemini-3.5-flash-lite (fastest, active free quota, high throughput)
      // 2. gemini-3.8-flash (official standard model, verified active)
      // 3. gemini-3.5-flash (multimodal, high-capacity)
      // 4. gemini-flash-latest (official alias)
      const candidateModels = [
        'gemini-3.5-flash-lite',
        'gemini-3.8-flash',
        'gemini-3.5-flash',
        'gemini-flash-latest',
      ];

      let response: any = null;
      let modelUsed = candidateModels[0];
      let lastError: any = null;
      const attemptedModels: string[] = [];

      for (const modelCandidate of candidateModels) {
        attemptedModels.push(modelCandidate);
        let attempts = 0;
        const maxAttemptsForCandidate = 2;

        while (attempts < maxAttemptsForCandidate) {
          attempts++;
          try {
            response = await ai.models.generateContent({
              model: modelCandidate,
              contents: formattedContents,
              config: {
                systemInstruction: systemPrompt,
                temperature: isSerious
                  ? 0.25
                  : personality === 'concise'
                  ? 0.3
                  : personality === 'tactical'
                  ? 0.35
                  : 0.65,
                maxOutputTokens: isSerious ? 4096 : 2048,
              },
            });
            modelUsed = modelCandidate;
            break; // Succeeded!
          } catch (candidateErr: any) {
            lastError = candidateErr;
            const classified = classifyGeminiError(candidateErr);
            console.warn(`[SHADOW AI /api/chat] Candidate ${modelCandidate} failed (attempt ${attempts}): code=${classified.code}, status=${classified.status}, detail=${classified.detail}`);

            // Rate limited on this model: immediately try next candidate model
            if (classified.code === 'RATE_LIMIT_EXCEEDED' || classified.status === 429) {
              break;
            }

            // Non-retryable error (e.g. 401 or 400): break to next candidate
            if (!classified.isRetryable) {
              break;
            }

            // Transient 503 error: brief backoff before retry
            if (attempts < maxAttemptsForCandidate) {
              const backoffMs = Math.min(400 * attempts + Math.random() * 200, 1000);
              await new Promise((resolve) => setTimeout(resolve, backoffMs));
            }
          }
        }

        if (response) {
          break; // Succeeded!
        }
      }

      const latencyMs = Date.now() - startTime;

      // If all candidates failed
      if (!response) {
        const classified = classifyGeminiError(lastError);
        console.warn(`[SHADOW AI] All candidate models failed. Final error: ${classified.code} (${classified.status}) - ${classified.detail}`);

        recordLog({
          id: requestId,
          timestamp: new Date().toISOString(),
          endpoint: '/api/chat',
          status: classified.status,
          code: classified.code,
          modelUsed: null,
          latencyMs,
          errorDetail: `${classified.code}: ${classified.detail}`,
        });

        res.status(classified.status).json({
          error: classified.userMessage,
          code: classified.code,
          status: classified.status,
          detail: classified.detail,
          modelsAttempted: attemptedModels,
          isRetryable: classified.isRetryable,
          latencyMs,
        });
        return;
      }

      const replyText = response.text || 'Understood.';

      recordLog({
        id: requestId,
        timestamp: new Date().toISOString(),
        endpoint: '/api/chat',
        status: 200,
        code: 'OK',
        modelUsed,
        latencyMs,
        errorDetail: null,
      });

      res.json({
        reply: replyText,
        modelUsed,
        mode,
        latencyMs,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error('[SHADOW AI] Unexpected error in /api/chat handler:', err);
      const classified = classifyGeminiError(err);
      const latencyMs = Date.now() - startTime;

      recordLog({
        id: requestId,
        timestamp: new Date().toISOString(),
        endpoint: '/api/chat',
        status: classified.status,
        code: classified.code,
        modelUsed: null,
        latencyMs,
        errorDetail: `${classified.code}: ${classified.detail}`,
      });

      res.status(classified.status).json({
        error: classified.userMessage,
        code: classified.code,
        status: classified.status,
        detail: classified.detail,
        isRetryable: classified.isRetryable,
        latencyMs,
      });
    }
  });

  // Intelligent Selective Long-Term Memory Extraction Endpoint with rate limiting (SEC-02)
  app.post(
    '/api/memory/extract',
    createRateLimitMiddleware(memoryExtractRateLimiter),
    validateMemoryExtractPayload,
    async (req, res) => {
    try {
      const { userMessage, assistantReply, existingMemories = [] } = req.body;
      if (!userMessage || typeof userMessage !== 'string') {
        res.status(400).json({ error: 'userMessage is required.', code: 'INVALID_INPUT' });
        return;
      }

      // Quick negative heuristics for trivial non-memory inputs
      const trimmed = userMessage.trim();
      const lower = trimmed.toLowerCase();
      if (
        lower.length < 6 ||
        /^(hi|hello|hey|namaste|ok|okay|thanks|thank you|yes|no|bye|goodbye|kaisa hai|theek hai)[.!?\s]*$/i.test(lower)
      ) {
        res.json({ hasNewMemory: false, memory: null });
        return;
      }

      const existingContext = Array.isArray(existingMemories) && existingMemories.length > 0
        ? existingMemories.slice(-30).map((m: any) => typeof m === 'string' ? `- ${m}` : `- ${m.content}`).join('\n')
        : 'None';

      const prompt = `You are a memory distillation module for SHADOW AI. Analyze this conversation exchange to determine if there is any permanent, stable long-term user information worth remembering for future sessions.

EXCHANGE:
User: "${trimmed.slice(0, 1000)}"
Shadow: "${(assistantReply || '').slice(0, 1000)}"

EXISTING USER MEMORIES:
${existingContext}

CRITERIA FOR EXTRACTION:
- "preference": Enduring user preferences (e.g. favorite tech stacks, preferred coding styles, UI aesthetics, language choices like Hinglish/English, communication preferences like concise answers or bullet points).
- "project": Ongoing active projects, apps, research, or concrete development goals (e.g. building Galaxy F55 companion app, developing SHADOW AI, learning Rust).
- "instruction": Explicit standing directives or rules given to the assistant (e.g. "always explain equations step-by-step", "keep code modular", "always provide TypeScript types").
- "constraint": Hardware, system, or personal operational limits (e.g. "running on 8GB Ubuntu system", "limited mobile bandwidth", "testing on Android 14").
- "fact": Concrete personal facts explicitly shared (e.g. user's name, city, profession, company, role).

STRICT EXCLUSIONS (RETURN NULL):
- Transient daily chatter, greetings, jokes, or conversational pleasantries.
- Temporary debugging questions, momentary code snippets, or one-off error log pastes.
- Passwords, API keys, credentials, tokens, sensitive identity numbers, or private financial details.
- Speculative guesses, fleeting feelings of the moment ("I'm tired"), or uncertain inferences.
- Anything already covered or logically redundant with the EXISTING USER MEMORIES list above.

Respond with pure JSON matching this exact structure:
{
  "hasNewMemory": true,
  "memory": {
    "content": "Concise, affirmative 1-sentence statement written in third-person (e.g., 'Prefers TypeScript and modular architecture for web applications.')",
    "category": "preference" | "project" | "instruction" | "constraint" | "fact",
    "confidence": 0.95,
    "provenance": "explicit_user" | "implicit_inference"
  }
}
If no permanent fact, preference, or directive is present, respond with:
{ "hasNewMemory": false, "memory": null }`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.5-flash-lite',
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          responseMimeType: 'application/json',
          temperature: 0.1,
        },
      });

      const text = response.text?.trim() || '{}';
      let parsed = { hasNewMemory: false, memory: null };
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { hasNewMemory: false, memory: null };
      }

      res.json(parsed);
    } catch (err: any) {
      console.warn('[SHADOW AI] Memory extraction warning:', err?.message || err);
      // Non-blocking: fail gracefully without disrupting chat
      res.json({ hasNewMemory: false, memory: null });
    }
  });

  // Multimodal Audio Transcription Proxy Endpoint with rate limiting (SEC-02)
  app.post(
    '/api/transcribe',
    createRateLimitMiddleware(transcribeRateLimiter),
    validateTranscribePayload,
    async (req, res) => {
    try {
      const { audioBase64, mimeType = 'audio/webm', language = 'en-IN' } = req.body;
      if (!audioBase64 || typeof audioBase64 !== 'string') {
        res.status(400).json({ error: 'Audio data is required for transcription.', code: 'INVALID_AUDIO' });
        return;
      }

      // Strip any data URI prefix reliably (handles any codec or format parameters, e.g. data:audio/webm;codecs=opus;base64,...)
      let cleanBase64 = audioBase64;
      if (cleanBase64.includes(',')) {
        cleanBase64 = cleanBase64.split(',')[1];
      } else {
        cleanBase64 = cleanBase64.replace(/^data:[^,]+,/, '');
      }
      cleanBase64 = cleanBase64.trim();

      // Normalize mimeType (e.g. audio/webm;codecs=opus -> audio/webm)
      let normalizedMime = 'audio/webm';
      if (typeof mimeType === 'string' && mimeType.trim()) {
        const baseMime = mimeType.split(';')[0].trim().toLowerCase();
        if (['audio/webm', 'audio/wav', 'audio/mp4', 'audio/ogg', 'audio/aac', 'audio/mp3', 'audio/mpeg'].includes(baseMime)) {
          normalizedMime = baseMime;
        } else if (baseMime.includes('webm')) {
          normalizedMime = 'audio/webm';
        } else if (baseMime.includes('wav')) {
          normalizedMime = 'audio/wav';
        } else if (baseMime.includes('mp4') || baseMime.includes('m4a')) {
          normalizedMime = 'audio/mp4';
        } else if (baseMime.includes('ogg')) {
          normalizedMime = 'audio/ogg';
        }
      }

      // Candidates with verified audio multimodal generateContent support
      const candidateModels = [
        'gemini-3.5-flash-lite',
        'gemini-3.5-flash',
        'gemini-flash-lite-latest',
        'gemini-3.8-flash',
      ];

      const isHindi = language === 'hi-IN';
      const promptText = isHindi
        ? 'You are an accurate multilingual audio transcriber. Transcribe the spoken audio verbatim in Devanagari Hindi or Hinglish as spoken. Return ONLY the transcribed text. Do not output preamble, quotes, explanations, or timestamps. If the audio is silent or contains no discernible speech, return SILENCE.'
        : 'You are an accurate multilingual audio transcriber. Transcribe the spoken audio verbatim in Indian English or English as spoken. Return ONLY the transcribed text. Do not output preamble, quotes, explanations, or timestamps. If the audio is silent or contains no discernible speech, return SILENCE.';

      let transcript = '';
      let lastTranscriptionError: any = null;
      let succeeded = false;

      for (const model of candidateModels) {
        try {
          const resp = await ai.models.generateContent({
            model,
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    inlineData: {
                      mimeType: normalizedMime,
                      data: cleanBase64,
                    },
                  },
                  {
                    text: promptText,
                  },
                ],
              },
            ],
          });

          let raw = (resp.text || '').trim();
          raw = raw.replace(/^["']|["']$/g, '').trim();
          // Filter out silence/noise keywords and timestamp-only responses (e.g. "00:00", "[noise]", "<noise>", "SILENCE")
          const upper = raw.toUpperCase();
          if (
            upper === 'SILENCE' ||
            upper === 'SILENCE.' ||
            upper === 'EMPTY' ||
            upper === 'EMPTY.' ||
            upper === '<NOISE>' ||
            upper === '[NOISE]' ||
            upper === '*NOISE*' ||
            upper === '<SILENCE>' ||
            upper === '[SILENCE]' ||
            upper === '*MUSIC*' ||
            /^\[?\d{1,2}:\d{2}(?::\d{2})?\]?$/.test(raw) ||
            /^\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2}$/.test(raw)
          ) {
            raw = '';
          }
          transcript = raw;
          succeeded = true;
          break;
        } catch (err: any) {
          lastTranscriptionError = err;
          console.warn(`[SHADOW AI] /api/transcribe failed with model ${model}:`, err?.message || err);
          continue;
        }
      }

      if (!succeeded) {
        const classified = classifyGeminiError(lastTranscriptionError);
        console.warn(`[SHADOW AI] All transcription models failed. Code: ${classified.code}, Status: ${classified.status}`);

        let transcriptionUserMessage = 'Unable to recognize spoken audio. Please tap the mic and speak clearly.';
        if (classified.code === 'RATE_LIMIT_EXCEEDED') {
          transcriptionUserMessage = 'Voice recognition reached temporary rate limits. Please wait 10 seconds and speak again.';
        } else if (classified.code === 'MODEL_UNAVAILABLE') {
          transcriptionUserMessage = 'Voice service is experiencing high traffic. Please tap the mic and try again in a moment.';
        } else if (classified.code === 'AUTH_ERROR') {
          transcriptionUserMessage = 'AI voice service configuration error. Please ensure GEMINI_API_KEY is configured.';
        } else if (classified.code === 'TIMEOUT') {
          transcriptionUserMessage = 'Voice processing timed out. Please try speaking again.';
        } else if (classified.code === 'INVALID_REQUEST') {
          transcriptionUserMessage = 'Could not process audio format. Please tap the mic and speak again.';
        }

        recordLog({
          id: `transcribe-${Date.now()}`,
          timestamp: new Date().toISOString(),
          endpoint: '/api/transcribe',
          status: classified.status,
          code: classified.code,
          modelUsed: null,
          latencyMs: 0,
          errorDetail: `${classified.code}: ${classified.detail}`,
        });

        res.status(classified.status).json({
          error: transcriptionUserMessage,
          code: classified.code,
          status: classified.status,
          detail: classified.detail,
          isRetryable: classified.isRetryable,
        });
        return;
      }

      recordLog({
        id: `transcribe-${Date.now()}`,
        timestamp: new Date().toISOString(),
        endpoint: '/api/transcribe',
        status: 200,
        code: 'OK',
        modelUsed: 'gemini-3.5-flash-lite',
        latencyMs: 0,
        errorDetail: null,
      });

      res.json({
        transcript,
        isSilence: !transcript,
        success: true,
      });
    } catch (err: any) {
      console.warn('[SHADOW AI] Unexpected transcription error:', err?.message);
      const classified = classifyGeminiError(err);

      recordLog({
        id: `transcribe-${Date.now()}`,
        timestamp: new Date().toISOString(),
        endpoint: '/api/transcribe',
        status: classified.status,
        code: classified.code,
        modelUsed: null,
        latencyMs: 0,
        errorDetail: `${classified.code}: ${classified.detail}`,
      });

      res.status(classified.status).json({
        error: classified.userMessage,
        code: classified.code,
        status: classified.status,
        detail: classified.detail,
        isRetryable: classified.isRetryable,
      });
    }
  });

  // In-memory cache for synthesized voice phrases (instant response & quota optimization)
  const ttsCache = new Map<string, { audioBase64: string; mimeType: string; timestamp: number }>();
  // Circuit breaker cooldowns for rate-limited / quota-exhausted models
  const ttsModelCooldowns = new Map<string, number>();

  // Helper: Wraps raw 16-bit 24kHz mono PCM in standard 44-byte RIFF/WAVE header
  function wrapPcmToWav(base64Data: string, sampleRate = 24000, numChannels = 1, bitDepth = 16): string {
    const rawBuf = Buffer.from(base64Data, 'base64');
    // If it already contains a valid RIFF/WAVE header, return as is
    if (
      rawBuf.length >= 12 &&
      rawBuf.slice(0, 4).toString('ascii') === 'RIFF' &&
      rawBuf.slice(8, 12).toString('ascii') === 'WAVE'
    ) {
      return base64Data;
    }

    const byteRate = (sampleRate * numChannels * bitDepth) / 8;
    const blockAlign = (numChannels * bitDepth) / 8;
    const dataSize = rawBuf.length;
    const header = Buffer.alloc(44);

    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataSize, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20); // PCM
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitDepth, 34);
    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40);

    return Buffer.concat([header, rawBuf]).toString('base64');
  }

  // Neural Cinematic Text-to-Speech Endpoint with rate limiting (SEC-02)
  app.post('/api/tts', createRateLimitMiddleware(ttsRateLimiter), validateTtsPayload, async (req, res) => {
    const startTime = Date.now();
    const requestId = `tts-${Date.now()}`;
    try {
      const { text, voice = 'Charon', language = 'auto' } = req.body;

      if (!text || typeof text !== 'string') {
        res.status(400).json({ error: 'Text string is required for speech synthesis.', code: 'INVALID_TEXT' });
        return;
      }

      // Clean markdown, links, hashtags, and formatting for pure speech delivery while preserving all Unicode Devanagari text
      let cleanedText = text
        .replace(/```[\s\S]*?```/g, '') // remove large code blocks
        .replace(/`([^`]+)`/g, '$1')
        .replace(/[*_#~[\]()]/g, '')
        .replace(/\bhttps?:\/\/\S+/g, 'link')
        .replace(/(\r\n|\n|\r)/gm, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (!cleanedText) {
        res.status(400).json({ error: 'Text contains no speakable content after cleaning.', code: 'EMPTY_TEXT' });
        return;
      }

      // Safe sentence boundary truncation for extremely long messages without breaking Unicode graphemes or Hindi words
      if (cleanedText.length > 700) {
        // Look for clean sentence punctuation: '.', '!', '?', '।', '॥'
        const match = cleanedText.slice(0, 700).match(/^(.*[.!?।॥\n])\s+/s);
        if (match && match[1].length > 250) {
          cleanedText = match[1].trim();
        } else {
          const lastSpace = cleanedText.slice(0, 700).lastIndexOf(' ');
          if (lastSpace > 250) {
            cleanedText = cleanedText.slice(0, lastSpace).trim();
          }
        }
      }

      // Supported cinematic voices: 'Charon' (deep, calm, confident male), 'Fenrir' (deep authoritative male)
      const selectedVoice = ['Charon', 'Fenrir', 'Zephyr', 'Puck', 'Aoede'].includes(voice) ? voice : 'Charon';

      // Check cache for instant 0ms latency & quota savings
      const cacheKey = `${selectedVoice}:${cleanedText}`;
      const cached = ttsCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < 3600000) {
        res.json({
          audioBase64: cached.audioBase64,
          mimeType: cached.mimeType,
          voiceUsed: selectedVoice,
          modelUsed: 'cache',
          sampleRate: 24000,
          cached: true,
          latencyMs: Date.now() - startTime,
        });
        return;
      }

      // Resilient multi-tier candidate model chain across independent quota buckets
      // gemini-3.8-flash-lite-tts and gemini-3.8-flash-tts provide studio-quality 24kHz audio/wav
      const candidateModels = [
        'gemini-3.8-flash-lite-tts',
        'gemini-3.8-flash-tts',
        'gemini-3.1-flash-tts-preview',
        'gemini-2.5-flash-preview-tts',
        'gemini-2.5-pro-preview-tts',
      ];

      let audioData: string | null = null;
      let mimeType = 'audio/wav';
      let modelUsed = candidateModels[0];
      let lastErr: any = null;

      for (const model of candidateModels) {
        const cooldownUntil = ttsModelCooldowns.get(model);
        if (cooldownUntil && Date.now() < cooldownUntil) {
          continue;
        }

        try {
          const resp = await ai.models.generateContent({
            model,
            contents: [{ role: 'user', parts: [{ text: cleanedText }] }],
            config: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: selectedVoice,
                  },
                },
              },
            },
          });

          const part = resp.candidates?.[0]?.content?.parts?.[0];
          if (part?.inlineData?.data) {
            // Ensure audio is standardized into a valid 24kHz RIFF/WAVE container
            audioData = wrapPcmToWav(part.inlineData.data, 24000, 1, 16);
            mimeType = 'audio/wav';
            modelUsed = model;
            ttsModelCooldowns.delete(model);
            break;
          }
        } catch (err: any) {
          lastErr = err;
          const errMsg = typeof err?.message === 'string' ? err.message : String(err || '');
          const isQuota = err?.status === 429 || errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED');
          if (isQuota) {
            // Sane 30s cooldown for rate limits to allow fast recovery without locking out models
            ttsModelCooldowns.set(model, Date.now() + 30 * 1000);
            console.log(`[SHADOW AI TTS] Model ${model} reached rate limit, attempting fallback.`);
          } else {
            console.log(`[SHADOW AI TTS] Model ${model} unavailable, attempting fallback.`);
          }
          continue;
        }
      }

      const latencyMs = Date.now() - startTime;

      if (!audioData) {
        const classified = lastErr
          ? classifyGeminiError(lastErr)
          : {
              status: 200,
              code: 'RATE_LIMIT_COOLDOWN',
              isRetryable: true,
              userMessage: 'Neural TTS cloud quota temporarily reached. Localized voice synthesis handling delivery.',
              detail: 'All candidate models currently on quota cooldown',
            };

        recordLog({
          id: requestId,
          timestamp: new Date().toISOString(),
          endpoint: '/api/tts',
          status: 200,
          code: classified.code,
          modelUsed: null,
          latencyMs,
          errorDetail: `${classified.code}: ${classified.detail}`,
        });

        res.json({
          audioBase64: null,
          ttsFallback: true,
          voiceUsed: selectedVoice,
          status: classified.status,
          code: classified.code,
          message: classified.userMessage,
        });
        return;
      }

      // Cache synthesized audio (max 80 entries)
      if (ttsCache.size > 80) {
        const firstKey = ttsCache.keys().next().value;
        if (firstKey) ttsCache.delete(firstKey);
      }
      ttsCache.set(cacheKey, {
        audioBase64: audioData,
        mimeType,
        timestamp: Date.now(),
      });

      recordLog({
        id: requestId,
        timestamp: new Date().toISOString(),
        endpoint: '/api/tts',
        status: 200,
        code: 'OK',
        modelUsed,
        latencyMs,
        errorDetail: null,
      });

      res.json({
        audioBase64: audioData,
        mimeType,
        voiceUsed: selectedVoice,
        modelUsed,
        sampleRate: 24000,
        cached: false,
        latencyMs,
      });
    } catch (err: any) {
      const msg = typeof err?.message === 'string' ? err.message.slice(0, 100) : 'Internal error';
      console.log('[SHADOW AI TTS] Unexpected error:', msg);
      const classified = classifyGeminiError(err);
      res.status(classified.status).json({
        error: classified.userMessage,
        code: classified.code,
        status: classified.status,
        detail: classified.detail,
        fallbackAllowed: true,
      });
    }
  });

  return app;
}

async function startServer() {
  const app = createProxyApp();

  // Mount Vite or serve static production build
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`[SHADOW AI Core] Server active at http://0.0.0.0:${port} (mode: ${isProduction ? 'prod' : 'dev'})`);
  });
}

// Only boot server when executed directly as main entry point
const isMainModule = Boolean(process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url)));
if (isMainModule) {
  startServer().catch((err) => {
    console.error('[SHADOW AI Core] Fatal server boot error:', err);
    process.exit(1);
  });
}
