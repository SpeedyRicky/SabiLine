import { describe, it, expect } from 'vitest';
import { calculateAccuracy } from './accuracy';

describe('calculateAccuracy', () => {
  it('is 1.0 when WER is 0', () => {
    expect(calculateAccuracy(0)).toBe(1);
  });

  it('is the complement of WER', () => {
    expect(calculateAccuracy(0.25)).toBe(0.75);
  });

  it('is 0 when WER is 1.0', () => {
    expect(calculateAccuracy(1.0)).toBe(0);
  });

  it('clamps to 0 rather than going negative when WER exceeds 1.0', () => {
    expect(calculateAccuracy(1.5)).toBe(0);
  });
});
