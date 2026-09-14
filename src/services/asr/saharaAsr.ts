import type { SpeechModelProvider } from './types';

/**
 * Real HTTP integration for Intron Sahara's ASR (speech-to-text) endpoint,
 * mirroring the request pattern this codebase's existing Sahara TTS call
 * already uses (https://api.intron.io/v1/tts/synthesize) for consistency.
 *
 * Sahara issues separate API keys per service — SAHARA_TTS_API_KEY gates
 * text-to-speech (see server.ts's /api/tts/generate) and SAHARA_STT_API_KEY
 * gates this speech-to-text provider. They are independent: having one
 * configured does not imply the other is.
 *
 * IMPORTANT: the exact ASR endpoint path and request/response contract below
 * have not been independently verified against Intron's current API
 * documentation — this environment has no SAHARA_STT_API_KEY and no way to
 * test against the real service. isConfigured() means this code path only
 * runs at all once a real key is supplied; if the real contract turns out to
 * differ, calls will fail with a clear per-sample error (never a fabricated
 * transcript) rather than silently succeeding with wrong data.
 */
export const saharaAsrProvider: SpeechModelProvider = {
  id: 'sahara',
  displayName: 'Intron Sahara',
  isConfigured: () => Boolean(process.env.SAHARA_STT_API_KEY),

  async transcribe(audioBase64, mimeType, language) {
    const start = Date.now();
    const apiKey = process.env.SAHARA_STT_API_KEY;
    if (!apiKey) {
      return { success: false, error: 'SAHARA_STT_API_KEY is not configured.', latencyMs: Date.now() - start };
    }

    try {
      const response = await fetch('https://api.intron.io/v1/asr/transcribe', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ audio: audioBase64, mimeType, language }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Sahara ASR API returned status ${response.status}: ${errText}`);
      }

      const data = await response.json();
      const transcript = String(data.transcript || data.text || '').trim();
      if (!transcript) {
        throw new Error('Sahara ASR API response did not include a transcript field.');
      }

      return { success: true, transcript, latencyMs: Date.now() - start };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Sahara transcription failed.',
        latencyMs: Date.now() - start,
      };
    }
  },
};
