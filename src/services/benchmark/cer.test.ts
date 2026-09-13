import { describe, it, expect } from 'vitest';
import { calculateCER } from './cer';

describe('calculateCER', () => {
  it('is 0 on identical character strings', () => {
    expect(calculateCER('abara', 'abara').cer).toBe(0);
  });

  it('detects a single character substitution', () => {
    const result = calculateCER('obara', 'abara');
    expect(result.substitutions).toBe(1);
    expect(result.cer).toBe(0.2);
  });

  it('handles an empty reference gracefully', () => {
    const result = calculateCER('', 'abc');
    expect(result.cer).toBe(1.0);
    expect(result.insertions).toBe(3);
  });

  it('handles two empty strings as a perfect match', () => {
    expect(calculateCER('', '').cer).toBe(0);
  });
});
