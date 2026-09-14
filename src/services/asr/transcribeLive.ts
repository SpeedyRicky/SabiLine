import { ASR_PROVIDER_REGISTRY } from './registry';
import type { LanguageCode } from '../../types';
import type { IntakeTranscriptAttempt } from '../intake/types';

// Sahara is the target production ASR partner for this challenge, so it's
// preferred when configured; the custom benchmark endpoints come next; Gemini
// is last since it also carries the confirmation-TTS load elsewhere in this
// same request flow. Whichever provider actually succeeds first, in this
// order, becomes the transcript the rest of the intake pipeline uses.
export const LIVE_ASR_PRIORITY = ['sahara', 'model_b', 'model_c', 'gemini'];

export interface LiveTranscriptionSummary {
  primaryProviderId: string | null;
  primaryTranscript: string | null;
  attempts: Record<string, IntakeTranscriptAttempt>;
}

/**
 * Sends one real audio clip to every requested ASR provider in parallel and
 * picks the first successful transcript by priority order. An unconfigured
 * provider is reported honestly as not-configured, never silently dropped or
 * backfilled — matching the benchmark runner's anti-fabrication contract.
 */
export async function transcribeWithAllProviders(
  audioBase64: string,
  mimeType: string,
  language: LanguageCode,
  selectedModels: string[] = LIVE_ASR_PRIORITY
): Promise<LiveTranscriptionSummary> {
  const attempts: Record<string, IntakeTranscriptAttempt> = {};

  await Promise.all(
    selectedModels.map(async (id) => {
      const provider = ASR_PROVIDER_REGISTRY[id];
      if (!provider) return;

      if (!provider.isConfigured()) {
        attempts[id] = {
          success: false,
          notConfigured: true,
          error: `${provider.displayName} is not configured.`,
          latencyMs: 0,
        };
        return;
      }

      try {
        const result = await provider.transcribe(audioBase64, mimeType, language);
        attempts[id] = result;
      } catch (err) {
        attempts[id] = {
          success: false,
          error: err instanceof Error ? err.message : 'Transcription failed.',
          latencyMs: 0,
        };
      }
    })
  );

  const primaryProviderId =
    LIVE_ASR_PRIORITY.find((id) => selectedModels.includes(id) && attempts[id]?.success && attempts[id]?.transcript) ??
    null;
  const primaryTranscript = primaryProviderId ? attempts[primaryProviderId].transcript ?? null : null;

  return { primaryProviderId, primaryTranscript, attempts };
}
