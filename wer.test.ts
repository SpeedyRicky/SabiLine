import { describe, it, expect } from 'vitest';
import { calculateWER } from './wer';

describe('calculateWER', () => {
  const ref = 'take two tablets daily after meal';

  it('is 0 on identical transcripts', () => {
    const result = calculateWER(ref, ref);
    expect(result.wer).toBe(0);
    expect(result.substitutions).toBe(0);
  });

  it('detects a single word substitution', () => {
    const result = calculateWER(ref, 'take three tablets daily after meal');
    expect(result.wer).toBeCloseTo(1 / 6, 3);
    expect(result.substitutions).toBe(1);
  });

  it('detects a word deletion', () => {
    const result = calculateWER(ref, 'take tablets daily after meal');
    expect(result.deletions).toBe(1);
  });

  it('detects a word insertion', () => {
    const result = calculateWER(ref, 'please take two tablets daily after meal');
    expect(result.insertions).toBe(1);
  });

  it('treats an empty reference against non-empty hypothesis as fully wrong (WER 1.0)', () => {
    const result = calculateWER('', 'some words');
    expect(result.wer).toBe(1.0);
    expect(result.insertions).toBe(2);
  });

  it('treats an empty hypothesis as all deletions', () => {
    const result = calculateWER('some words', '');
    expect(result.deletions).toBe(2);
    expect(result.wer).toBe(1.0);
  });

  it('treats two empty strings as a perfect match', () => {
    const result = calculateWER('', '');
    expect(result.wer).toBe(0);
  });

  it('respects normalization options passed through', () => {
    const result = calculateWER('Take TWO tablets.', 'take two tablets', { toLowerCase: true, stripPunctuation: true });
    expect(result.wer).toBe(0);
  });
});
