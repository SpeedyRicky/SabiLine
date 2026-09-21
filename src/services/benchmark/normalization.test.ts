import { describe, it, expect } from 'vitest';
import { normalizeTranscript, tokenizeWords, tokenizeChars } from './normalization';

describe('normalizeTranscript', () => {
  it('strips punctuation and lowercases by default', () => {
    expect(normalizeTranscript('Kina bukatar... shan maganin iron, da folic acid!')).toBe(
      'kina bukatar shan maganin iron da folic acid'
    );
  });

  it('strips diacritics only when explicitly requested', () => {
    const withDiacritics = normalizeTranscript('Ẹ dín iyọ̀ kù', { toLowerCase: false });
    expect(withDiacritics).toContain('Ẹ');

    const stripped = normalizeTranscript('Ẹ dín iyọ̀ kù', { stripDiacritics: true, toLowerCase: false });
    expect(stripped).not.toMatch(/[Ẹọ̀]/);
  });

  it('collapses repeated whitespace', () => {
    expect(normalizeTranscript('take   two    tablets')).toBe('take two tablets');
  });

  it('returns an empty string for empty input', () => {
    expect(normalizeTranscript('')).toBe('');
  });

  it('removes configured speech fillers when requested', () => {
    expect(normalizeTranscript('um take two tablets', { removeFillers: true })).toBe('take two tablets');
  });
});

describe('tokenizeWords / tokenizeChars', () => {
  it('splits normalized text into words', () => {
    expect(tokenizeWords('Take Two Tablets!')).toEqual(['take', 'two', 'tablets']);
  });

  it('returns an empty array for blank input', () => {
    expect(tokenizeWords('   ')).toEqual([]);
  });

  it('splits normalized text into characters, ignoring spaces', () => {
    expect(tokenizeChars('ab cd')).toEqual(['a', 'b', 'c', 'd']);
  });
});
