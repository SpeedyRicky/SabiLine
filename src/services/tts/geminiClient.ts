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
