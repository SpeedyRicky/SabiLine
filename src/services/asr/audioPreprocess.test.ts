import { describe, it, expect } from 'vitest';
import { normalizeQuietAudio } from './audioPreprocess';
import { pcmToWavBuffer } from '../tts/pcmToWav';

function wavWithSamples(samples: number[]): Buffer {
  const pcm = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => pcm.writeInt16LE(s, i * 2));
  return pcmToWavBuffer(pcm, 24000, 1, 16);
}

function readSamples(wav: Buffer): number[] {
  // data chunk always starts at byte 44 for the simple header pcmToWavBuffer writes
  const dataStart = 44;
  const out: number[] = [];
  for (let i = dataStart; i + 1 < wav.length; i += 2) {
    out.push(wav.readInt16LE(i));
  }
  return out;
}

describe('normalizeQuietAudio', () => {
  it('boosts a quiet clip up toward the target peak', () => {
    // Peak ~3000 (~9% of full scale) simulates a person speaking quietly —
    // well under the MAX_GAIN cap, so it should land close to the target.
    const quietSamples = [3000, -2500, 1800, -1200, 500];
    const quiet = wavWithSamples(quietSamples);
    const result = normalizeQuietAudio(quiet);

    expect(result.applied).toBe(true);
    expect(result.gainApplied).toBeGreaterThan(1);
    expect(result.gainApplied!).toBeLessThan(12);

    const boosted = readSamples(result.buffer);
    const peakBefore = Math.max(...quietSamples.map(Math.abs));
    const peakAfter = Math.max(...boosted.map(Math.abs));
    expect(peakAfter).toBeGreaterThan(peakBefore);
    // Should land close to the ~85% of full-scale target, not overshoot wildly.
    expect(peakAfter).toBeLessThanOrEqual(32767);
    expect(peakAfter).toBeGreaterThan(20000);
  });

  it('never reduces or otherwise alters audio that is already loud enough', () => {
    const loud = wavWithSamples([20000, -25000, 18000, -30000]);
    const result = normalizeQuietAudio(loud);

    expect(result.applied).toBe(false);
    expect(result.buffer).toEqual(loud);
  });

  it('does not amplify pure silence into noise', () => {
    const silence = wavWithSamples([0, 0, 0, 0]);
    const result = normalizeQuietAudio(silence);

    expect(result.applied).toBe(false);
    const samples = readSamples(result.buffer);
    expect(samples.every((s) => s === 0)).toBe(true);
  });

  it('caps gain so a near-silent clip is not amplified into full-scale noise', () => {
    const nearSilent = wavWithSamples([1, -1, 1, -1]);
    const result = normalizeQuietAudio(nearSilent);

    expect(result.applied).toBe(true);
    expect(result.gainApplied).toBeLessThanOrEqual(12);
  });

  it('falls back safely (never throws) for a non-WAV buffer', () => {
    const garbage = Buffer.from('not a wav file at all, just some text bytes');
    expect(() => normalizeQuietAudio(garbage)).not.toThrow();
    const result = normalizeQuietAudio(garbage);
    expect(result.applied).toBe(false);
    expect(result.buffer).toEqual(garbage);
  });

  it('falls back safely for a truncated/malformed WAV header', () => {
    const truncated = Buffer.from('RIFF\x00\x00\x00\x00WAVE');
    expect(() => normalizeQuietAudio(truncated)).not.toThrow();
    expect(normalizeQuietAudio(truncated).applied).toBe(false);
  });
});
