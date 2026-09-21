import { describe, it, expect } from 'vitest';
import { concatWav, splitForSpeech } from './wavJoin';

/** Builds a minimal but real WAV: RIFF/WAVE, a 16-byte fmt chunk, then data. */
function makeWav(pcm: string, { sampleRate = 48000, extraChunk = false } = {}): Buffer {
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1, 0); // PCM
  fmt.writeUInt16LE(1, 2); // mono
  fmt.writeUInt32LE(sampleRate, 4);
  fmt.writeUInt32LE(sampleRate * 2, 8);
  fmt.writeUInt16LE(2, 12);
  fmt.writeUInt16LE(16, 14);

  const data = Buffer.from(pcm);
  // Some encoders insert a LIST chunk before `data` — a fixed 44-byte slice
  // would splice it into the audio, so the parser must walk chunks instead.
  const list = extraChunk
    ? Buffer.concat([Buffer.from('LIST'), u32(4), Buffer.from('INFO')])
    : Buffer.alloc(0);

  const body = Buffer.concat([
    Buffer.from('WAVE'),
    Buffer.from('fmt '), u32(fmt.length), fmt,
    list,
    Buffer.from('data'), u32(data.length), data,
  ]);
  return Buffer.concat([Buffer.from('RIFF'), u32(body.length), body]);
}

function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n, 0);
  return b;
}

/** Pulls the PCM payload back out, the same way a player would. */
function dataOf(wav: Buffer): string {
  const idx = wav.indexOf(Buffer.from('data'));
  const size = wav.readUInt32LE(idx + 4);
  return wav.subarray(idx + 8, idx + 8 + size).toString();
}

describe('concatWav', () => {
  it('returns a single input untouched', () => {
    const only = makeWav('abc');
    expect(concatWav([only])).toBe(only);
  });

  it('joins the audio of several clips in order', () => {
    const joined = concatWav([makeWav('one'), makeWav('two'), makeWav('three')]);
    expect(dataOf(joined)).toBe('onetwothree');
  });

  it('declares the joined length in both the RIFF and data headers', () => {
    const joined = concatWav([makeWav('aaaa'), makeWav('bbbb')]);
    expect(joined.readUInt32LE(4)).toBe(joined.length - 8);
    const idx = joined.indexOf(Buffer.from('data'));
    expect(joined.readUInt32LE(idx + 4)).toBe(8);
  });

  it('skips non-audio chunks rather than splicing them in as noise', () => {
    const joined = concatWav([makeWav('one', { extraChunk: true }), makeWav('two')]);
    expect(dataOf(joined)).toBe('onetwo');
  });

  it('refuses to join clips recorded in different formats', () => {
    expect(() => concatWav([makeWav('a'), makeWav('b', { sampleRate: 16000 })]))
      .toThrow(/different audio formats/);
  });

  it('rejects something that is not a WAV instead of emitting static', () => {
    expect(() => concatWav([makeWav('a'), Buffer.from('not audio at all')]))
      .toThrow(/RIFF\/WAVE/);
  });

  it('refuses to invent audio out of nothing', () => {
    expect(() => concatWav([])).toThrow(/No audio/);
  });
});

describe('splitForSpeech', () => {
  it('leaves text that already fits as one piece', () => {
    expect(splitForSpeech('Bawo ni.', 100)).toEqual(['Bawo ni.']);
  });

  it('breaks on sentence boundaries and keeps every word', () => {
    const text = 'Bawo ni. Kini oruko re? Mo fe ran o lowo loni. E se pupo fun suuru yin.';
    const pieces = splitForSpeech(text, 30);

    for (const piece of pieces) expect(piece.length).toBeLessThanOrEqual(30);
    expect(pieces.join(' ').replace(/\s+/g, ' ')).toBe(text);
  });

  it('falls back to word boundaries when one sentence is too long', () => {
    const text = 'please tell me exactly where the pain is and how long it has been there';
    const pieces = splitForSpeech(text, 20);

    for (const piece of pieces) expect(piece.length).toBeLessThanOrEqual(20);
    expect(pieces.join(' ')).toBe(text);
    expect(pieces.every((p) => !p.startsWith(' ') && !p.endsWith(' '))).toBe(true);
  });

  it('hard-splits a single word longer than the limit rather than dropping it', () => {
    const pieces = splitForSpeech('a'.repeat(25), 10);
    expect(pieces).toEqual(['aaaaaaaaaa', 'aaaaaaaaaa', 'aaaaa']);
  });

  it('returns nothing for empty text instead of a blank request', () => {
    expect(splitForSpeech('   ', 100)).toEqual([]);
  });
});
