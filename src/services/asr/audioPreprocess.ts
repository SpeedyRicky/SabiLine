// Server-only. Boosts quiet 16-bit PCM WAV audio before it's handed to an
// ASR provider, so speech recorded (or synthesized) at low volume is still
// heard clearly instead of producing more substitutions/hallucinations.
// Never reduces already-loud audio — this only lifts up quiet clips.

export interface GainNormalizeResult {
  buffer: Buffer;
  applied: boolean;
  reason?: string;
  originalPeakRatio?: number;
  gainApplied?: number;
}

const FULL_SCALE_16BIT = 32767;
const QUIET_THRESHOLD_RATIO = 0.5; // only boost audio quieter than this
const TARGET_PEAK_RATIO = 0.85; // boost quiet audio up to roughly this loud
const MAX_GAIN = 12; // cap amplification so near-silence doesn't become pure noise

/**
 * Boosts the volume of quiet 16-bit PCM WAV audio via peak normalization.
 * Falls back to returning the input unchanged (never throws) for anything
 * that isn't a well-formed 16-bit PCM WAV container, or that's already loud
 * enough.
 */
export function normalizeQuietAudio(wavBuffer: Buffer): GainNormalizeResult {
  if (
    wavBuffer.length < 44 ||
    wavBuffer.toString('ascii', 0, 4) !== 'RIFF' ||
    wavBuffer.toString('ascii', 8, 12) !== 'WAVE'
  ) {
    return { buffer: wavBuffer, applied: false, reason: 'Not a recognized WAV container.' };
  }

  let offset = 12;
  let fmtChunk: { audioFormat: number; bitsPerSample: number } | null = null;
  let dataOffset = -1;
  let dataSize = 0;

  while (offset + 8 <= wavBuffer.length) {
    const chunkId = wavBuffer.toString('ascii', offset, offset + 4);
    const chunkSize = wavBuffer.readUInt32LE(offset + 4);
    const bodyStart = offset + 8;
    if (bodyStart + chunkSize > wavBuffer.length) break;

    if (chunkId === 'fmt ') {
      fmtChunk = {
        audioFormat: wavBuffer.readUInt16LE(bodyStart),
        bitsPerSample: wavBuffer.readUInt16LE(bodyStart + 14),
      };
    } else if (chunkId === 'data') {
      dataOffset = bodyStart;
      dataSize = chunkSize;
    }

    // RIFF chunks are word-aligned: a odd-sized chunk has a padding byte.
    offset = bodyStart + chunkSize + (chunkSize % 2);
  }

  if (!fmtChunk || dataOffset < 0) {
    return { buffer: wavBuffer, applied: false, reason: 'Could not locate fmt/data chunks.' };
  }

  if (fmtChunk.audioFormat !== 1 || fmtChunk.bitsPerSample !== 16) {
    return { buffer: wavBuffer, applied: false, reason: 'Only 16-bit PCM WAV is supported for gain normalization.' };
  }

  const sampleCount = Math.floor(dataSize / 2);
  if (sampleCount === 0) {
    return { buffer: wavBuffer, applied: false, reason: 'No audio samples found.' };
  }

  let peak = 0;
  for (let i = 0; i < sampleCount; i++) {
    const abs = Math.abs(wavBuffer.readInt16LE(dataOffset + i * 2));
    if (abs > peak) peak = abs;
  }

  const originalPeakRatio = peak / FULL_SCALE_16BIT;

  if (peak === 0 || originalPeakRatio >= QUIET_THRESHOLD_RATIO) {
    return { buffer: wavBuffer, applied: false, reason: 'Audio is already loud enough.', originalPeakRatio };
  }

  const gain = Math.min((TARGET_PEAK_RATIO * FULL_SCALE_16BIT) / peak, MAX_GAIN);
  const outBuffer = Buffer.from(wavBuffer);

  for (let i = 0; i < sampleCount; i++) {
    const sample = outBuffer.readInt16LE(dataOffset + i * 2);
    const boosted = Math.max(-32768, Math.min(32767, Math.round(sample * gain)));
    outBuffer.writeInt16LE(boosted, dataOffset + i * 2);
  }

  return {
    buffer: outBuffer,
    applied: true,
    originalPeakRatio,
    gainApplied: Number(gain.toFixed(2)),
  };
}
