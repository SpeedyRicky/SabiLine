import type { SpeechModelProvider } from './types';

/**
 * Generic "bring your own ASR endpoint" provider — used for the Model B /
 * Model C identities, which the original build only ever gave placeholder
 * names (OmniLLM / Azure-Whisper) without binding either to a real,
 * verifiable API. Rather than guess at and fake a specific vendor's
 * contract, this exposes a plain extension point: set both `<PREFIX>_API_KEY`
 * and `<PREFIX>_API_URL` to point at any real ASR endpoint that accepts
 * POST { audio: base64Wav, mimeType, language } and returns { transcript }.
 * Until both are set, isConfigured() is false and the model is honestly
 * reported as not configured.
 */
export function createCustomEndpointProvider(
  id: string,
  displayName: string,
  keyEnvVar: string,
  urlEnvVar: string
): SpeechModelProvider {
  return {
    id,
    displayName,
    isConfigured: () => Boolean(process.env[keyEnvVar] && process.env[urlEnvVar]),

    async transcribe(audioBase64, mimeType, language) {
      const start = Date.now();
      const apiKey = process.env[keyEnvVar];
      const endpointUrl = process.env[urlEnvVar];
      if (!apiKey || !endpointUrl) {
        return {
          success: false,
          error: `${keyEnvVar} and ${urlEnvVar} are not both configured.`,
          latencyMs: Date.now() - start,
        };
      }

      try {
        const response = await fetch(endpointUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ audio: audioBase64, mimeType, language }),
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`${displayName} returned status ${response.status}: ${errText}`);
        }

        const data = await response.json();
        const transcript = String(data.transcript || data.text || '').trim();
        if (!transcript) {
          throw new Error(`${displayName} response did not include a transcript field.`);
        }

        return { success: true, transcript, latencyMs: Date.now() - start };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : `${displayName} transcription failed.`,
          latencyMs: Date.now() - start,
        };
      }
    },
  };
}
