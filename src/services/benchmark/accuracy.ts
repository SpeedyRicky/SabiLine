/**
 * Word-level transcription accuracy, defined as the complement of WER.
 * WER can exceed 1.0 when a hypothesis has more insertions than the
 * reference has words, so this is clamped to the [0, 1] range rather than
 * going negative.
 */
export function calculateAccuracy(wer: number): number {
  return Number(Math.max(0, 1 - wer).toFixed(4));
}
