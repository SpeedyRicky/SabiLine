import { describe, it, expect } from 'vitest';
import { calculateSentenceBLEU, calculateChrF } from './bleu';

describe('calculateSentenceBLEU', () => {
  it('is 1.0 on an exact match', () => {
    const text = 'take your medication with clean water';
    expect(calculateSentenceBLEU(text, text)).toBe(1.0);
  });

  it('is 0 when either side is empty', () => {
    expect(calculateSentenceBLEU('', 'some text')).toBe(0);
    expect(calculateSentenceBLEU('some text', '')).toBe(0);
  });

  it('scores a partial match between 0 and 1', () => {
    const score = calculateSentenceBLEU('take your medication with clean water', 'take some medication');
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });
});

describe('calculateChrF', () => {
  it('is 1.0 on an exact match', () => {
    expect(calculateChrF('ogwu', 'ogwu')).toBe(1.0);
  });

  it('is 0 when either side is empty', () => {
    expect(calculateChrF('', 'ogwu')).toBe(0);
    expect(calculateChrF('ogwu', '')).toBe(0);
  });
});
