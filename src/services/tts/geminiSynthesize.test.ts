import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { synthesizeReferenceAudio } from './geminiSynthesize';

const savedKey = process.env.GEMINI_API_KEY;

beforeEach(() => {
  delete process.env.GEMINI_API_KEY;
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = savedKey;
});

describe('synthesizeReferenceAudio', () => {
  it('fails honestly without a network call when GEMINI_API_KEY is unset', async () => {
    const result = await synthesizeReferenceAudio('take two tablets daily', 'en');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/GEMINI_API_KEY/);
    expect(result.audioBase64).toBeUndefined();
  });
});
