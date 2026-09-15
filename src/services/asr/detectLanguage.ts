import {
  getGeminiClient,
  isQuotaExceededError,
  isTimeoutError,
  withGeminiRetry,
  withTimeout,
  GEMINI_CALL_TIMEOUT_MS,
} from '../tts/geminiClient';
import type { LanguageCode } from '../../types';

export interface DetectLanguageResult {
  success: boolean;
  languageCode?: LanguageCode;
  transcript?: string;
  error?: string;
  quotaExceeded?: boolean;
  notConfigured?: boolean;
  timedOut?: boolean;
  latencyMs: number;
}

const SUPPORTED_CODES: LanguageCode[] = ['en', 'pcm', 'yo', 'ig', 'ha', 'ful'];
const LANGUAGE_CHOICES_DESC =
  'English (en), Nigerian Pidgin (pcm), Yoruba (yo), Igbo (ig), Hausa (ha), or Fulfulde (ful)';

// Nigerian Pidgin draws most of its vocabulary from English, so a classifier
// told only "Nigerian Pidgin (pcm)" reliably returns "en" for it. That single
// misread is costly here: the detected language is locked in for the rest of
// the call, so a Pidgin speaker would be answered in English start to finish.
// Naming the grammatical markers explicitly is what separates the two.
const PIDGIN_DISAMBIGUATION =
  'Important: Nigerian Pidgin is a distinct language and must be labelled "pcm", never "en". It borrows English words but has its own grammar. Treat it as pcm if you hear markers such as: "dey", "don", "go" as a future marker, "wetin", "abeg", "na" as a copula, "no be", "sabi", "comot", "pikin", "belle", "wahala", "small small", "make I", "e be like say". Judge by these structures, not by how many individual words look English. Only use "en" for standard or Nigerian-accented English that lacks this grammar.';

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
    const response = await withTimeout(
      withGeminiRetry(() =>
        ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: [
            {
              parts: [
                {
                  text: `Listen to this audio of a patient speaking at a health clinic intake desk. First identify which language they are speaking, choosing the closest match from: ${LANGUAGE_CHOICES_DESC}. If none of those are a good match, still pick the closest one. ${PIDGIN_DISAMBIGUATION} Then transcribe exactly what they said, including any code-switching between languages. Return ONLY this JSON shape: {"languageCode": "en"|"pcm"|"yo"|"ig"|"ha"|"ful", "transcript": string}`,
                },
                { inlineData: { mimeType, data: audioBase64 } },
              ],
            },
          ],
          config: { responseMimeType: 'application/json' },
        })
      ),
      GEMINI_CALL_TIMEOUT_MS
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
      timedOut: isTimeoutError(err),
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
  timedOut?: boolean;
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
    const response = await withTimeout(
      withGeminiRetry(() =>
        ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: [
            {
              parts: [
                {
                  text: `A patient typed this at a health clinic intake desk: "${text.replace(/"/g, "'")}". Identify which language they most likely intended, choosing the closest match from: ${LANGUAGE_CHOICES_DESC}. ${PIDGIN_DISAMBIGUATION} Return ONLY this JSON shape: {"languageCode": "en"|"pcm"|"yo"|"ig"|"ha"|"ful"}`,
                },
              ],
            },
          ],
          config: { responseMimeType: 'application/json' },
        })
      ),
      GEMINI_CALL_TIMEOUT_MS
    );

    const parsed = JSON.parse(response.text || '{}');
    const languageCode = SUPPORTED_CODES.includes(parsed.languageCode) ? (parsed.languageCode as LanguageCode) : 'en';

    return { success: true, languageCode, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      success: false,
      quotaExceeded: isQuotaExceededError(err),
      timedOut: isTimeoutError(err),
      error: err instanceof Error ? err.message : 'Language detection failed.',
      latencyMs: Date.now() - start,
    };
  }
}
