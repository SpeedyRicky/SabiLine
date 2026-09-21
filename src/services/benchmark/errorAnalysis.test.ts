import { describe, it, expect } from 'vitest';
import { analyzeCodeSwitching, performErrorAnalysis } from './errorAnalysis';

describe('analyzeCodeSwitching', () => {
  it('recognizes an English-Hausa intra-utterance switch', () => {
    const result = analyzeCodeSwitching('The patient arrived yau da safe with severe zazzabi and headache', 'en');
    expect(result.isCodeSwitched).toBe(true);
    expect(result.transitionCount).toBeGreaterThanOrEqual(2);
  });

  it('always labels results as model-inferred, never as ground truth', () => {
    const result = analyzeCodeSwitching('The patient arrived yau da safe with severe zazzabi', 'en');
    expect(result.inferredNotice).toContain('Model-inferred');
    for (const segment of result.segments) {
      expect(segment.isInferred).toBe(true);
    }
  });

  it('handles empty text without throwing', () => {
    const result = analyzeCodeSwitching('', 'en');
    expect(result.isCodeSwitched).toBe(false);
    expect(result.segments).toEqual([]);
  });

  it('treats a purely monolingual utterance as not code-switched', () => {
    const result = analyzeCodeSwitching('Take this oral antibiotic capsule every eight hours', 'en');
    expect(result.isCodeSwitched).toBe(false);
  });
});

describe('performErrorAnalysis', () => {
  it('does not throw when codeSwitchData is undefined', () => {
    // This mirrors the real server behavior: codeSwitchAnalysis is only
    // computed for samples flagged hasCodeSwitching. Callers must be able to
    // pass undefined here without crashing.
    expect(() => performErrorAnalysis('take two tablets', 'take three tablets', undefined)).not.toThrow();
  });

  it('flags known clinical terms that were substituted or deleted', () => {
    const result = performErrorAnalysis('give paracetamol for the malaria fever', 'give tylenol for the fever');
    expect(result.medicalTermErrors).toContain('paracetamol');
  });
});
