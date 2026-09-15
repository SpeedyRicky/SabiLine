import { getGeminiClient, isQuotaExceededError } from '../tts/geminiClient';
import type { LanguageCode } from '../../types';

export interface DetectLanguageResult {
  success: boolean;
  languageCode?: LanguageCode;
  transcript?: string;
  error?: string;
  quotaExceeded?: boolean;
  latencyMs: number;
}

const SUPPORTED_CODES: LanguageCode[] = ['en', 'pcm', 'yo', 'ig', 'ha'];

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
    return { success: false, error: 'GEMINI_API_KEY is not configured.', latencyMs: Date.now() - start };
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: [
        {
          parts: [
            {
              text: `Listen to this audio of a patient speaking at a health clinic intake desk. First identify which language they are speaking, choosing the closest match from: English (en), Nigerian Pidgin (pcm), Yoruba (yo), Igbo (ig), Hausa (ha). If none of those are a good match, still pick the closest one. Then transcribe exactly what they said, including any code-switching between languages. Return ONLY this JSON shape: {"languageCode": "en"|"pcm"|"yo"|"ig"|"ha", "transcript": string}`,
            },
            { inlineData: { mimeType, data: audioBase64 } },
          ],
        },
      ],
      config: { responseMimeType: 'application/json' },
    });

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
