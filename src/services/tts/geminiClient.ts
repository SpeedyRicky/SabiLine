import { GoogleGenAI } from '@google/genai';

// Server-only. Never import this from a .vue file or any client bundle path
// — it reads process.env directly and holds a live API client.
let geminiClient: GoogleGenAI | null = null;

export function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
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
