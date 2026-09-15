import { GoogleGenAI } from '@google/genai';

// Server-only. Never import this from a .vue file or any client bundle path
// — it reads process.env directly and holds a live API client.
let geminiClient: GoogleGenAI | null = null;

export function getGeminiClient(): GoogleGenAI | null {
  // Trimmed defensively: a key pasted into a dashboard's env-var field can
  // easily pick up a trailing newline/space, which silently turns every
  // call into an auth failure that looks identical to "not configured."
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  if (!geminiClient) {
    geminiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return geminiClient;
}

// Google's free-tier quota errors surface as a 429 RESOURCE_EXHAUSTED with
// this text; detecting it lets callers offer a fallback (e.g. device speech)
// instead of just showing a raw API error.
export function isQuotaExceededError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes('RESOURCE_EXHAUSTED') || message.includes('429');
}

// A key that is set but rejected by Google ("API key not valid") is, for the
// patient, the same situation as no key at all: nothing will work until the
// deployment's GEMINI_API_KEY is corrected. Surfacing it as "not configured"
// gives a clear, actionable message instead of a raw 500.
export function isInvalidApiKeyError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes('API_KEY_INVALID') || message.includes('API key not valid');
}

// A 503 UNAVAILABLE ("model is currently experiencing high demand") is
// Google's own transient overload signal, observed in practice to clear up
// within a second or two — distinct from a 429 quota exhaustion, which
// retrying immediately will not fix. Retrying this specific case once or
// twice turns a real fraction of "please try again" user-facing failures
// into ones that just work, without masking anything genuinely broken.
function isTransientOverloadError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes('UNAVAILABLE') || message.includes('"code":503') || message.includes(' 503 ');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Distinguishable from a generic Gemini failure so callers can show "please
// try again" instead of a raw error, and so the flag survives to the client.
export class GeminiTimeoutError extends Error {
  constructor(message = 'Gemini took too long to respond.') {
    super(message);
    this.name = 'GeminiTimeoutError';
  }
}

/**
 * Vercel kills a serverless function once it hits the platform's execution
 * limit — and when it does, the response is the *platform's* HTML/plain-text
 * error page, not anything our Express code gets a chance to produce, so
 * even the asyncHandler wrapper in server.ts can't turn it into clean JSON.
 * Gemini has been observed taking 15+ seconds on a slow-but-otherwise-fine
 * call, which is enough to hit that limit on its own, with no error to
 * retry. Racing every call against a timeout comfortably under the
 * platform's cap means OUR code is always the one that responds, in valid
 * JSON, before the platform can step in.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new GeminiTimeoutError()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export function isTimeoutError(err: unknown): boolean {
  return err instanceof GeminiTimeoutError;
}

// Kept comfortably under Vercel's default 10s serverless function limit,
// leaving headroom for cold start and our own request/response handling.
export const GEMINI_CALL_TIMEOUT_MS = 8000;

/**
 * Runs a Gemini call, retrying up to `maxRetries` times (with a short delay)
 * only when the failure looks like Google's own transient overload — any
 * other error (quota exhaustion, a real bad request, an auth failure)
 * surfaces immediately, unretried, since retrying it would not help and
 * would only add latency before the same honest error.
 */
export async function withGeminiRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransientOverloadError(err) || attempt === maxRetries) throw err;
      await sleep(500 * (attempt + 1));
    }
  }
  throw lastErr;
}
