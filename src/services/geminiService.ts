import { IntelligenceMode, PersonalityArchetype } from '../types/hologram';
import { memoryService } from './memoryService';
import { authService } from './authService';

interface ChatHistoryItem {
  role: 'user' | 'model';
  parts: Array<{ text: string }>;
}

export interface GeminiResponse {
  reply: string;
  modelUsed: string;
  mode: IntelligenceMode;
  latencyMs: number;
  timestamp: string;
}

export interface RequestDiagnostics {
  lastEndpoint: string;
  lastStatus: number;
  lastCode: string;
  lastError: string | null;
  lastDetail: string | null;
  lastModel: string | null;
  lastLatencyMs: number;
  timestamp: string;
}

export interface ServerDiagnosticsData {
  status: string;
  hasApiKey: boolean;
  timestamp: string;
  models: {
    primary: string;
    secondary: string;
    multimodal: string;
    fallback: string;
  };
  recentLogs: Array<{
    id: string;
    timestamp: string;
    endpoint: string;
    status: number;
    code: string;
    modelUsed: string | null;
    latencyMs: number;
    errorDetail: string | null;
  }>;
}

export interface VisualAttachment {
  data: string;
  mimeType: string;
  filename?: string;
  previewUrl?: string;
}

export class GeminiServiceError extends Error {
  public status: number;
  public code: string;
  public isRetryable: boolean;
  public userMessage: string;
  public detail: string;
  public modelsAttempted?: string[];

  constructor(
    userMessage: string,
    status = 500,
    code = 'SERVICE_ERROR',
    isRetryable = true,
    detail = '',
    modelsAttempted?: string[]
  ) {
    super(userMessage);
    this.name = 'GeminiServiceError';
    this.userMessage = userMessage;
    this.status = status;
    this.code = code;
    this.isRetryable = isRetryable;
    this.detail = detail;
    this.modelsAttempted = modelsAttempted;
  }
}

class GeminiService {
  private history: ChatHistoryItem[] = [];
  private lastDiagnostics: RequestDiagnostics = {
    lastEndpoint: '/api/chat',
    lastStatus: 200,
    lastCode: 'READY',
    lastError: null,
    lastDetail: null,
    lastModel: 'gemini-3.5-flash-lite',
    lastLatencyMs: 0,
    timestamp: new Date().toISOString(),
  };

  public getLastDiagnostics(): RequestDiagnostics {
    return { ...this.lastDiagnostics };
  }

  public async fetchServerDiagnostics(): Promise<ServerDiagnosticsData | null> {
    try {
      const res = await fetch('/api/diagnostics');
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  public async checkStatus(): Promise<{
    online: boolean;
    hasApiKey: boolean;
    models: { standard: string; serious: string };
  }> {
    try {
      const res = await fetch('/api/status');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return {
        online: true,
        hasApiKey: data.hasApiKey ?? false,
        models: data.models || { standard: 'gemini-3.5-flash-lite', serious: 'gemini-3.8-flash' },
      };
    } catch {
      return {
        online: false,
        hasApiKey: false,
        models: { standard: 'gemini-3.5-flash-lite', serious: 'gemini-3.8-flash' },
      };
    }
  }

  public async sendMessage(
    message: string,
    mode: IntelligenceMode = 'standard',
    personality: PersonalityArchetype = 'sci-fi-companion',
    image?: VisualAttachment | null,
    maxRetries = 1
  ): Promise<GeminiResponse> {
    // Explicit user command handling: "Remember that...", "Remember this:...", "Yaad rakhna ki..."
    const trimmedMsg = message.trim();
    const rememberMatch = trimmedMsg.match(/^(?:please\s+)?(?:remember\s+(?:that|this:?)|yaad\s+rakhna\s*(?:ki|ye|yeh|this)?:?)\s+(.+)$/i);
    if (rememberMatch && rememberMatch[1]) {
      const memoryContent = rememberMatch[1].trim();
      memoryService
        .saveMemory(memoryContent, 'instruction', 'explicit_user')
        .then((saved) => {
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('shadow:memory-saved', { detail: saved }));
          }
        })
        .catch(() => {});
    }

    // Retrieve active relevant memories to ground response
    const memoryContext = memoryService.formatContextForPrompt(message);

    const payload = {
      message,
      history: this.history,
      mode,
      personality,
      memoryContext,
      image: image ? { data: image.data, mimeType: image.mimeType, filename: image.filename } : undefined,
    };

    let attempt = 0;
    let lastError: GeminiServiceError | null = null;
    const reqStart = Date.now();

    while (attempt <= maxRetries) {
      attempt++;
      try {
        const token = await authService.getIdToken().catch(() => null);
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }

        const response = await fetch('/api/chat', {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });

        const latencyMs = Date.now() - reqStart;

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const status = response.status;
          const code = errorData.code || `HTTP_${status}`;
          const detail = errorData.detail || errorData.error || `HTTP ${status}`;
          const isUnavailable = status === 503 || code === 'MODEL_UNAVAILABLE';
          const isRateLimited = status === 429 || code === 'RATE_LIMIT_EXCEEDED';

          const userMessage =
            errorData.error ||
            (isUnavailable
              ? 'The AI service is experiencing a temporary traffic spike. Please tap Retry in a few moments.'
              : isRateLimited
              ? 'The AI service reached temporary free-tier traffic limits. Please wait 10 seconds and tap Retry.'
              : `The AI service returned an error (${code}). Please try again.`);

          const isRetryable =
            errorData.isRetryable ?? (isUnavailable || isRateLimited || status >= 500);

          const serviceErr = new GeminiServiceError(
            userMessage,
            status,
            code,
            isRetryable,
            detail,
            errorData.modelsAttempted
          );

          this.lastDiagnostics = {
            lastEndpoint: '/api/chat',
            lastStatus: status,
            lastCode: code,
            lastError: userMessage,
            lastDetail: detail,
            lastModel: errorData.modelsAttempted?.[0] || null,
            lastLatencyMs: latencyMs,
            timestamp: new Date().toISOString(),
          };

          // If retryable and an attempt is left, wait briefly with backoff and retry
          if (isRetryable && attempt <= maxRetries) {
            lastError = serviceErr;
            await new Promise((resolve) => setTimeout(resolve, 800 + Math.random() * 400));
            continue;
          }

          throw serviceErr;
        }

        const data: GeminiResponse = await response.json();

        this.lastDiagnostics = {
          lastEndpoint: '/api/chat',
          lastStatus: 200,
          lastCode: 'OK',
          lastError: null,
          lastDetail: null,
          lastModel: data.modelUsed,
          lastLatencyMs: data.latencyMs || latencyMs,
          timestamp: new Date().toISOString(),
        };

        // Record ONLY real successful user and model turns into memory
        this.history.push({
          role: 'user',
          parts: [{ text: message }],
        });
        this.history.push({
          role: 'model',
          parts: [{ text: data.reply }],
        });

        // Limit conversation history to latest 20 turns
        if (this.history.length > 20) {
          this.history = this.history.slice(-20);
        }

        // Asynchronous non-blocking background extraction of long-term memories
        if (memoryService.isAutoMemoryEnabled()) {
          this.extractLongTermMemoryAsync(message, data.reply);
        }

        return data;
      } catch (err: any) {
        if (err instanceof GeminiServiceError) {
          throw err;
        }

        const latencyMs = Date.now() - reqStart;

        // Network or fetch connection error
        const isNetworkRetryable = attempt <= maxRetries;
        if (isNetworkRetryable) {
          await new Promise((resolve) => setTimeout(resolve, 600 + Math.random() * 300));
          continue;
        }

        const netErr = new GeminiServiceError(
          'Unable to connect to the AI service. Please check your network connection and tap Retry.',
          0,
          'NETWORK_ERROR',
          true,
          err?.message || 'Network fetch failure'
        );

        this.lastDiagnostics = {
          lastEndpoint: '/api/chat',
          lastStatus: 0,
          lastCode: 'NETWORK_ERROR',
          lastError: netErr.userMessage,
          lastDetail: netErr.detail,
          lastModel: null,
          lastLatencyMs: latencyMs,
          timestamp: new Date().toISOString(),
        };

        throw netErr;
      }
    }

    throw (
      lastError ||
      new GeminiServiceError(
        'The AI service is momentarily handling heavy traffic. Please wait a moment and tap Retry.',
        503,
        'MODEL_UNAVAILABLE',
        true,
        'Max retry attempts reached'
      )
    );
  }

  public clearHistory(): void {
    this.history = [];
  }

  public getHistory(): ChatHistoryItem[] {
    return [...this.history];
  }

  private async extractLongTermMemoryAsync(userMessage: string, assistantReply: string): Promise<void> {
    try {
      const existing = memoryService.getMemories().map((m) => m.content);
      const token = await authService.getIdToken().catch(() => null);
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch('/api/memory/extract', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          userMessage,
          assistantReply,
          existingMemories: existing,
        }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.hasNewMemory && data.memory && data.memory.content) {
        const saved = await memoryService.saveMemory(
          data.memory.content,
          data.memory.category || 'preference',
          data.memory.provenance || 'implicit_inference',
          undefined,
          data.memory.confidence || 0.95
        );
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('shadow:memory-saved', { detail: saved }));
        }
      }
    } catch {
      // Non-blocking background extraction
    }
  }
}

export const geminiService = new GeminiService();
