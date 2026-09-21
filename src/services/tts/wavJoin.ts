// Server-only. Joins several WAV buffers from the SAME voice into one.
//
// Needed because Intron Sahara caps a single text request at 100 characters
// (see saharaTts.ts), which is shorter than a typical intake reply — so a long
// reply is synthesized in pieces and stitched back together here.
//
// This walks the RIFF chunk table rather than assuming the canonical 44-byte
// header: real encoders insert LIST/fact chunks before `data`, and slicing at a
// fixed offset would splice metadata into the audio as noise. A caller gets
// either correct audio or a thrown error — never a buffer that plays as static.

const RIFF = 0x52494646; // "RIFF"
const WAVE = 0x57415645; // "WAVE"

interface ParsedWav {
  /** The `fmt ` chunk body — sample rate, channels, bit depth. */
  fmt: Buffer;
  /** Raw PCM payload from the `data` chunk. */
  data: Buffer;
}

function parseWav(buf: Buffer): ParsedWav {
  if (buf.length < 12 || buf.readUInt32BE(0) !== RIFF || buf.readUInt32BE(8) !== WAVE) {
    throw new Error('Not a RIFF/WAVE file.');
  }

  let fmt: Buffer | null = null;
  let data: Buffer | null = null;
  let offset = 12;

  // Chunks are [4-byte id][4-byte LE size][body], each padded to even length.
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const bodyStart = offset + 8;
    const bodyEnd = Math.min(bodyStart + size, buf.length);

    if (id === 'fmt ') fmt = buf.subarray(bodyStart, bodyEnd);
    else if (id === 'data') data = buf.subarray(bodyStart, bodyEnd);

    offset = bodyStart + size + (size % 2);
  }

  if (!fmt || !data) throw new Error('WAVE file is missing a fmt or data chunk.');
  return { fmt, data };
}

/**
 * Concatenates WAV buffers into a single WAV with a fresh canonical header.
 *
 * Every input must share one audio format — which holds here because all
 * pieces come back from one Sahara voice in one request shape. A mismatch
 * throws rather than producing audio that plays at the wrong pitch.
 */
export function concatWav(buffers: Buffer[]): Buffer {
  if (buffers.length === 0) throw new Error('No audio to join.');
  if (buffers.length === 1) return buffers[0];

  const parsed = buffers.map(parseWav);
  const fmt = parsed[0].fmt;

  for (const p of parsed.slice(1)) {
    if (!p.fmt.equals(fmt)) {
      throw new Error('Cannot join WAV files recorded in different audio formats.');
    }
  }

  const pcm = Buffer.concat(parsed.map((p) => p.data));

  const header = Buffer.alloc(12 + 8 + fmt.length + 8);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(4 + (8 + fmt.length) + (8 + pcm.length), 4); // everything after this field
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(fmt.length, 16);
  fmt.copy(header, 20);
  header.write('data', 20 + fmt.length, 'ascii');
  header.writeUInt32LE(pcm.length, 24 + fmt.length);

  return Buffer.concat([header, pcm]);
}

/**
 * Splits text into pieces of at most `maxChars`, breaking on sentence ends
 * first, then clause punctuation, then word boundaries — so each piece is a
 * unit the voice can read with sensible prosody rather than a blind cut.
 *
 * A single word longer than `maxChars` (rare, but a URL or a long medical term
 * would do it) is hard-split rather than dropped.
 */
export function splitForSpeech(text: string, maxChars: number): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxChars) return [trimmed];

  // Sentence-ish units, keeping their terminating punctuation.
  const units = trimmed.match(/[^.!?]+[.!?]*\s*/g) ?? [trimmed];
  const pieces: string[] = [];
  let current = '';

  const flush = () => {
    const out = current.trim();
    if (out) pieces.push(out);
    current = '';
  };

  for (const unit of units) {
    for (const part of unit.length > maxChars ? splitOnWords(unit, maxChars) : [unit]) {
      if (current.length + part.length > maxChars) flush();
      current += part;
    }
  }
  flush();

  return pieces;
}

function splitOnWords(text: string, maxChars: number): string[] {
  const out: string[] = [];
  let current = '';

  for (const word of text.split(/(\s+)/)) {
    if (word.length > maxChars) {
      if (current) { out.push(current); current = ''; }
      for (let i = 0; i < word.length; i += maxChars) out.push(word.slice(i, i + maxChars));
      continue;
    }
    if (current.length + word.length > maxChars) { out.push(current); current = ''; }
    current += word;
  }

  if (current.trim()) out.push(current);
  return out;
}
