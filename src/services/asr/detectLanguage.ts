import { getGeminiClient, isQuotaExceededError, withGeminiRetry } from '../tts/geminiClient';
import type { LanguageCode } from '../../types';

export interface DetectLanguageResult {
  success: boolean;
  languageCode?: LanguageCode;
  transcript?: string;
  error?: string;
  quotaExceeded?: boolean;
  notConfigured?: boolean;
  latencyMs: number;
}

const SUPPORTED_CODES: LanguageCode[] = ['en', 'pcm', 'yo', 'ig', 'ha', 'ful'];
const LANGUAGE_CHOICES_DESC =
  'English (en), Nigerian Pidgin (pcm), Yoruba (yo), Igbo (ig), Hausa (ha), or Fulfulde (ful)';

/**
 * Identifies which language a patient is speaking and transcribes it, in one
 * Gemini call — this is what lets the intake flow skip a manual language
 * picker entirely. Browser speech recognition can't do this: it requires a
 * language hint chosen in advance, so real auto-detection has to go through
 * a model that can listen first and classify after.
 */
export async function detectLanguageAndTranscribe(audioBase64: string, mimeType: string): Promise<DetectLanguageResult> {
  const start = Date.now();
  const ai = getGeminiClient();
  if (!ai) {
    return { success: false, notConfigured: true, error: 'GEMINI_API_KEY is not configured.', latencyMs: Date.now() - start };
  }

  try {
    const response = await withGeminiRetry(() =>
      ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: [
          {
            parts: [
              {
                text: `Listen to this audio of a patient speaking at a health clinic intake desk. First identify which language they are speaking, choosing the closest match from: ${LANGUAGE_CHOICES_DESC}. If none of those are a good match, still pick the closest one. Then transcribe exactly what they said, including any code-switching between languages. Return ONLY this JSON shape: {"languageCode": "en"|"pcm"|"yo"|"ig"|"ha"|"ful", "transcript": string}`,
              },
              { inlineData: { mimeType, data: audioBase64 } },
            ],
          },
        ],
        config: { responseMimeType: 'application/json' },
      })
    );

    const parsed = JSON.parse(response.text || '{}');
    const transcript = String(parsed.transcript || '').trim();
    const languageCode = SUPPORTED_CODES.includes(parsed.languageCode) ? (parsed.languageCode as LanguageCode) : 'en';

    if (!transcript) {
      return { success: false, error: 'Gemini returned an empty transcription.', latencyMs: Date.now() - start };
    }

    return { success: true, languageCode, transcript, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      success: false,
      quotaExceeded: isQuotaExceededError(err),
      error: err instanceof Error ? err.message : 'Language detection failed.',
      latencyMs: Date.now() - start,
    };
  }
}

export interface DetectLanguageFromTextResult {
  success: boolean;
  languageCode?: LanguageCode;
  error?: string;
  quotaExceeded?: boolean;
  notConfigured?: boolean;
  latencyMs: number;
}

/**
 * Text-only counterpart to detectLanguageAndTranscribe, for a patient who
 * types their reply instead of speaking — there's no audio to run through
 * the model, just the typed text itself, so this is a plain classification
 * call rather than the combined listen+transcribe call above.
 */
export async function detectLanguageFromText(text: string): Promise<DetectLanguageFromTextResult> {
  const start = Date.now();
  const ai = getGeminiClient();
  if (!ai) {
    return { success: false, notConfigured: true, error: 'GEMINI_API_KEY is not configured.', latencyMs: Date.now() - start };
  }

  try {
    const response = await withGeminiRetry(() =>
      ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: [
          {
            parts: [
              {
                text: `A patient typed this at a health clinic intake desk: "${text.replace(/"/g, "'")}". Identify which language they most likely intended, choosing the closest match from: ${LANGUAGE_CHOICES_DESC}. Return ONLY this JSON shape: {"languageCode": "en"|"pcm"|"yo"|"ig"|"ha"|"ful"}`,
              },
            ],
          },
        ],
        config: { responseMimeType: 'application/json' },
      })
    );

    const parsed = JSON.parse(response.text || '{}');
    const languageCode = SUPPORTED_CODES.includes(parsed.languageCode) ? (parsed.languageCode as LanguageCode) : 'en';

    return { success: true, languageCode, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      success: false,
      quotaExceeded: isQuotaExceededError(err),
      error: err instanceof Error ? err.message : 'Language detection failed.',
      latencyMs: Date.now() - start,
    };
  }
}
