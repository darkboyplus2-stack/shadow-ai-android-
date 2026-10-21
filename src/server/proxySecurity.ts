import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import firebaseConfig from '../../firebase-applet-config.json';

// Extend Express Request type to carry verified client identity
declare global {
  namespace Express {
    interface Request {
      verifiedUser?: { uid: string; email?: string } | null;
      clientIdentity?: ClientIdentity;
    }
  }
}

export interface ClientIdentity {
  type: 'authenticated' | 'unauthenticated';
  id: string; // verified UID or sanitized IP address
}

export interface RateLimitOptions {
  name: string;
  windowMs: number;
  maxUnauthenticated: number;
  maxAuthenticated: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  resetEpochSeconds: number;
}

// ---------------------------------------------------------------------------
// 1. In-Memory Sliding-Window Rate Limiter
// ---------------------------------------------------------------------------
export class SlidingWindowRateLimiter {
  private requests = new Map<string, number[]>();
  private options: RateLimitOptions;

  constructor(options: RateLimitOptions) {
    this.options = options;

    // Prune stale records every 2 minutes
    const timer = setInterval(() => {
      this.cleanup();
    }, 2 * 60 * 1000);
    if (timer.unref) {
      timer.unref();
    }
  }

  public check(identity: ClientIdentity, now = Date.now()): RateLimitResult {
    const isAuth = identity.type === 'authenticated';
    const limit = isAuth ? this.options.maxAuthenticated : this.options.maxUnauthenticated;
    const windowStart = now - this.options.windowMs;
    const key = `${this.options.name}:${identity.type}:${identity.id}`;

    let timestamps = this.requests.get(key) || [];
    // Discard timestamps older than sliding window
    timestamps = timestamps.filter((t) => t > windowStart);

    if (timestamps.length >= limit) {
      const oldestInWindow = timestamps[0] || windowStart;
      const retryAfterSeconds = Math.max(1, Math.ceil((oldestInWindow + this.options.windowMs - now) / 1000));
      const resetEpochSeconds = Math.ceil((oldestInWindow + this.options.windowMs) / 1000);

      this.requests.set(key, timestamps);
      return {
        allowed: false,
        limit,
        remaining: 0,
        retryAfterSeconds,
        resetEpochSeconds,
      };
    }

    timestamps.push(now);
    this.requests.set(key, timestamps);
    const resetEpochSeconds = Math.ceil((now + this.options.windowMs) / 1000);

    return {
      allowed: true,
      limit,
      remaining: Math.max(0, limit - timestamps.length),
      retryAfterSeconds: 0,
      resetEpochSeconds,
    };
  }

  public cleanup(now = Date.now()): void {
    const windowStart = now - this.options.windowMs;
    for (const [key, timestamps] of this.requests.entries()) {
      const active = timestamps.filter((t) => t > windowStart);
      if (active.length === 0) {
        this.requests.delete(key);
      } else {
        this.requests.set(key, active);
      }
    }
  }

  public reset(): void {
    this.requests.clear();
  }
}

// ---------------------------------------------------------------------------
// 2. Client IP Resolution (Safe, Reverse-Proxy Aware)
// ---------------------------------------------------------------------------
export function resolveClientIp(req: Request): string {
  // Express 'req.ip' is populated when 'trust proxy' is set
  if (req.ip) {
    return cleanIp(req.ip);
  }

  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    // Left-most IP is the original client address
    const firstIp = forwarded.split(',')[0].trim();
    if (firstIp) return cleanIp(firstIp);
  } else if (Array.isArray(forwarded) && forwarded[0]) {
    return cleanIp(forwarded[0].trim());
  }

  return cleanIp(req.socket?.remoteAddress || '127.0.0.1');
}

function cleanIp(ip: string): string {
  // Normalize IPv6 mapped IPv4 (e.g. ::ffff:192.168.1.1 -> 192.168.1.1)
  if (ip.startsWith('::ffff:')) {
    return ip.slice(7);
  }
  return ip || '127.0.0.1';
}

// ---------------------------------------------------------------------------
// 3. Firebase ID Token Verification (Zero Secrets / Client Admin Free)
// ---------------------------------------------------------------------------
interface GoogleCertsCache {
  certs: Record<string, string>;
  expiresAt: number;
}
let googleCertsCache: GoogleCertsCache | null = null;

// Allow test suites to override or inject mock verification
export type TokenVerifier = (token: string, projectId: string) => Promise<{ uid: string; email?: string } | null>;
let customTokenVerifier: TokenVerifier | null = null;

export function setCustomTokenVerifier(verifier: TokenVerifier | null) {
  customTokenVerifier = verifier;
}

export async function fetchGoogleCertificates(): Promise<Record<string, string>> {
  const now = Date.now();
  if (googleCertsCache && googleCertsCache.expiresAt > now) {
    return googleCertsCache.certs;
  }

  try {
    const res = await fetch('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com');
    if (!res.ok) {
      throw new Error(`Failed to fetch Google certs: HTTP ${res.status}`);
    }

    const certs: Record<string, string> = await res.json();
    // Cache for 6 hours
    googleCertsCache = {
      certs,
      expiresAt: now + 6 * 60 * 60 * 1000,
    };
    return certs;
  } catch (err) {
    if (googleCertsCache) {
      return googleCertsCache.certs; // Stale fallback
    }
    throw err;
  }
}

export async function verifyFirebaseIdToken(
  token: string,
  targetProjectId = firebaseConfig.projectId
): Promise<{ uid: string; email?: string } | null> {
  if (!token || typeof token !== 'string') return null;

  if (customTokenVerifier) {
    return customTokenVerifier(token, targetProjectId);
  }

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const signature = Buffer.from(parts[2], 'base64url');

    if (header.alg !== 'RS256' || !header.kid) return null;

    const nowSeconds = Math.floor(Date.now() / 1000);
    // Allow 5 minutes of clock skew
    if (payload.exp && payload.exp < nowSeconds - 300) return null;
    if (payload.iat && payload.iat > nowSeconds + 300) return null;
    if (payload.aud !== targetProjectId) return null;
    if (payload.iss !== `https://securetoken.google.com/${targetProjectId}`) return null;
    if (!payload.sub || typeof payload.sub !== 'string') return null;

    // Verify digital signature against Google public x509 certificates
    const certs = await fetchGoogleCertificates();
    const certPem = certs[header.kid];
    if (!certPem) return null;

    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(`${parts[0]}.${parts[1]}`);
    const isValid = verifier.verify(certPem, signature);

    if (!isValid) return null;

    return {
      uid: payload.sub,
      email: payload.email,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 4. Express Middleware: Client Identity Extraction
// ---------------------------------------------------------------------------
export async function authenticateOptionalUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  req.verifiedUser = null;

  // Never trust client-supplied identity parameters in body or headers
  delete (req.body as any)?.userId;

  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) {
      try {
        const verified = await verifyFirebaseIdToken(token);
        if (verified) {
          req.verifiedUser = verified;
        }
      } catch {
        // If token verification fails, do not throw; proceed as unauthenticated client
      }
    }
  }

  if (req.verifiedUser?.uid) {
    req.clientIdentity = {
      type: 'authenticated',
      id: req.verifiedUser.uid,
    };
  } else {
    req.clientIdentity = {
      type: 'unauthenticated',
      id: resolveClientIp(req),
    };
  }

  next();
}

// ---------------------------------------------------------------------------
// 5. Rate Limiting Middleware Factory
// ---------------------------------------------------------------------------
export function createRateLimitMiddleware(limiter: SlidingWindowRateLimiter) {
  return (req: Request, res: Response, next: NextFunction) => {
    const identity: ClientIdentity = req.clientIdentity || {
      type: 'unauthenticated',
      id: resolveClientIp(req),
    };

    const result = limiter.check(identity);

    res.setHeader('X-RateLimit-Limit', result.limit);
    res.setHeader('X-RateLimit-Remaining', result.remaining);
    res.setHeader('X-RateLimit-Reset', result.resetEpochSeconds);

    if (!result.allowed) {
      res.setHeader('Retry-After', result.retryAfterSeconds);
      res.status(429).json({
        error: `Rate limit exceeded. Please wait ${result.retryAfterSeconds}s before sending another request.`,
        code: 'RATE_LIMIT_EXCEEDED',
        status: 429,
        retryAfter: result.retryAfterSeconds,
        isRetryable: true,
      });
      return;
    }

    next();
  };
}

// ---------------------------------------------------------------------------
// 6. Payload Validation Middleware
// ---------------------------------------------------------------------------
export function validateChatPayload(req: Request, res: Response, next: NextFunction): void {
  const body = req.body;
  if (!body || typeof body !== 'object') {
    res.status(400).json({ error: 'Request body must be a valid JSON object.', code: 'INVALID_PAYLOAD', status: 400 });
    return;
  }

  const { message, history, mode, personality, memoryContext, image } = body;

  // Validation: Message text
  if (!image && (!message || typeof message !== 'string' || !message.trim())) {
    res.status(400).json({ error: 'Message text is required when no image is attached.', code: 'INVALID_PAYLOAD', status: 400 });
    return;
  }

  if (message !== undefined) {
    if (typeof message !== 'string') {
      res.status(400).json({ error: 'Field "message" must be a string.', code: 'INVALID_PAYLOAD', status: 400 });
      return;
    }
    if (message.length > 12000) {
      res.status(400).json({
        error: `Message exceeds maximum allowed length of 12,000 characters (received ${message.length}).`,
        code: 'PAYLOAD_TOO_LARGE',
        status: 400,
      });
      return;
    }
  }

  // Validation: Conversation history
  if (history !== undefined) {
    if (!Array.isArray(history)) {
      res.status(400).json({ error: 'Field "history" must be an array of message turns.', code: 'INVALID_PAYLOAD', status: 400 });
      return;
    }
    // Gracefully cap conversation history to the latest 60 turns rather than rejecting long conversations with HTTP 400
    const effectiveHistory = history.length > 60 ? history.slice(-60) : history;
    req.body.history = effectiveHistory;
    for (let i = 0; i < effectiveHistory.length; i++) {
      const turn = effectiveHistory[i];
      if (!turn || typeof turn !== 'object' || !turn.role || !Array.isArray(turn.parts)) {
        res.status(400).json({ error: `History item at index ${i} is malformed.`, code: 'INVALID_PAYLOAD', status: 400 });
        return;
      }
      if (turn.parts[0]?.text && typeof turn.parts[0].text === 'string' && turn.parts[0].text.length > 5000) {
        res.status(400).json({ error: `History text at turn ${i} exceeds 5,000 character limit.`, code: 'PAYLOAD_TOO_LARGE', status: 400 });
        return;
      }
    }
  }

  // Validation: Multimodal image attachment
  if (image !== undefined && image !== null) {
    if (typeof image !== 'object' || !image.mimeType || !image.data) {
      res.status(400).json({ error: 'Field "image" must contain valid "mimeType" and "data" base64 string.', code: 'INVALID_PAYLOAD', status: 400 });
      return;
    }
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'application/pdf'];
    if (!allowedMimes.includes(String(image.mimeType).toLowerCase())) {
      res.status(400).json({ error: `Unsupported image MIME type "${image.mimeType}". Allowed: ${allowedMimes.join(', ')}`, code: 'INVALID_PAYLOAD', status: 400 });
      return;
    }
    if (typeof image.data !== 'string' || image.data.length > 6 * 1024 * 1024) {
      res.status(400).json({ error: 'Attached image exceeds maximum encoded size limit (4MB).', code: 'PAYLOAD_TOO_LARGE', status: 400 });
      return;
    }
  }

  // Validation: Optional scalar metadata
  if (mode !== undefined && (typeof mode !== 'string' || mode.length > 32)) {
    res.status(400).json({ error: 'Invalid "mode" parameter.', code: 'INVALID_PAYLOAD', status: 400 });
    return;
  }
  if (personality !== undefined && (typeof personality !== 'string' || personality.length > 64)) {
    res.status(400).json({ error: 'Invalid "personality" parameter.', code: 'INVALID_PAYLOAD', status: 400 });
    return;
  }
  if (memoryContext !== undefined && (typeof memoryContext !== 'string' || memoryContext.length > 6000)) {
    res.status(400).json({ error: 'Memory context exceeds limit of 6,000 characters.', code: 'PAYLOAD_TOO_LARGE', status: 400 });
    return;
  }

  next();
}

export function validateMemoryExtractPayload(req: Request, res: Response, next: NextFunction): void {
  const body = req.body;
  if (!body || typeof body !== 'object') {
    res.status(400).json({ error: 'Request body must be a valid JSON object.', code: 'INVALID_PAYLOAD', status: 400 });
    return;
  }

  const { userMessage, assistantReply, existingMemories } = body;
  if (!userMessage || typeof userMessage !== 'string' || !userMessage.trim()) {
    res.status(400).json({ error: 'Field "userMessage" is required and must be a non-empty string.', code: 'INVALID_PAYLOAD', status: 400 });
    return;
  }

  if (userMessage.length > 4000) {
    res.status(400).json({ error: 'userMessage exceeds maximum length of 4,000 characters.', code: 'PAYLOAD_TOO_LARGE', status: 400 });
    return;
  }

  if (assistantReply !== undefined && typeof assistantReply !== 'string') {
    res.status(400).json({ error: 'Field "assistantReply" must be a string.', code: 'INVALID_PAYLOAD', status: 400 });
    return;
  }

  if (assistantReply && assistantReply.length > 4000) {
    res.status(400).json({ error: 'assistantReply exceeds maximum length of 4,000 characters.', code: 'PAYLOAD_TOO_LARGE', status: 400 });
    return;
  }

  if (existingMemories !== undefined && (!Array.isArray(existingMemories) || existingMemories.length > 50)) {
    res.status(400).json({ error: 'Field "existingMemories" must be an array of at most 50 items.', code: 'INVALID_PAYLOAD', status: 400 });
    return;
  }

  next();
}

export function validateTranscribePayload(req: Request, res: Response, next: NextFunction): void {
  const body = req.body;
  if (!body || typeof body !== 'object') {
    res.status(400).json({ error: 'Request body must be a valid JSON object.', code: 'INVALID_PAYLOAD', status: 400 });
    return;
  }

  const { audioBase64, mimeType, language } = body;
  if (!audioBase64 || typeof audioBase64 !== 'string' || !audioBase64.trim()) {
    res.status(400).json({ error: 'Field "audioBase64" is required and must be a base64 string.', code: 'INVALID_PAYLOAD', status: 400 });
    return;
  }

  // Max 6MB base64 audio data (~4.5MB binary audio)
  if (audioBase64.length > 6 * 1024 * 1024) {
    res.status(400).json({ error: 'Audio data exceeds maximum size limit (4MB).', code: 'PAYLOAD_TOO_LARGE', status: 400 });
    return;
  }

  if (mimeType !== undefined && (typeof mimeType !== 'string' || mimeType.length > 64)) {
    res.status(400).json({ error: 'Invalid audio MIME type parameter.', code: 'INVALID_PAYLOAD', status: 400 });
    return;
  }

  if (language !== undefined && (typeof language !== 'string' || language.length > 16)) {
    res.status(400).json({ error: 'Invalid language parameter.', code: 'INVALID_PAYLOAD', status: 400 });
    return;
  }

  next();
}

export function validateTtsPayload(req: Request, res: Response, next: NextFunction): void {
  const body = req.body;
  if (!body || typeof body !== 'object') {
    res.status(400).json({ error: 'Request body must be a valid JSON object.', code: 'INVALID_PAYLOAD', status: 400 });
    return;
  }

  const { text, voice, language } = body;
  if (!text || typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ error: 'Field "text" is required for speech synthesis.', code: 'INVALID_PAYLOAD', status: 400 });
    return;
  }

  if (text.length > 2000) {
    res.status(400).json({ error: 'Text exceeds maximum speech synthesis length of 2,000 characters.', code: 'PAYLOAD_TOO_LARGE', status: 400 });
    return;
  }

  if (voice !== undefined && (typeof voice !== 'string' || voice.length > 32)) {
    res.status(400).json({ error: 'Invalid "voice" parameter.', code: 'INVALID_PAYLOAD', status: 400 });
    return;
  }

  if (language !== undefined && (typeof language !== 'string' || language.length > 16)) {
    res.status(400).json({ error: 'Invalid "language" parameter.', code: 'INVALID_PAYLOAD', status: 400 });
    return;
  }

  next();
}

// ---------------------------------------------------------------------------
// 7. Standardized Payload-Too-Large (413) Error Handler
// ---------------------------------------------------------------------------
export function handleBodyParserErrors(err: any, _req: Request, res: Response, next: NextFunction): void {
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    res.status(413).json({
      error: 'Request payload exceeded server body size limits. Please reduce input or attachment size.',
      code: 'PAYLOAD_TOO_LARGE',
      status: 413,
      isRetryable: false,
    });
    return;
  }
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({
      error: 'Malformed JSON payload provided.',
      code: 'INVALID_JSON',
      status: 400,
    });
    return;
  }
  next(err);
}
