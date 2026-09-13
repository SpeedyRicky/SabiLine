import type { LanguageCode } from '../../types';

export interface TranscriptionResult {
  success: boolean;
  transcript?: string;
  error?: string;
  latencyMs: number;
}

/**
 * A single real speech-to-text provider identity. Every provider must be
 * honest about whether it's actually configured — isConfigured() gates
 * whether the benchmark runner attempts it at all, so an unconfigured model
 * is reported as "not configured", never silently skipped and never
 * backfilled with a fabricated result.
 */
export interface SpeechModelProvider {
  id: string;
  displayName: string;
  isConfigured(): boolean;
  transcribe(audioBase64: string, mimeType: string, language: LanguageCode): Promise<TranscriptionResult>;
}
