import { describe, it, expect, afterEach, vi } from 'vitest';

const mockSynthesizeSpeech = vi.fn();

vi.mock('./openaiClient', async () => {
  const actual = await vi.importActual<typeof import('./openaiClient')>('./openaiClient');
  return {
    ...actual,
    openaiSynthesizeSpeech: (...args: unknown[]) => mockSynthesizeSpeech(...args),
  };
});

import { synthesizeReferenceAudio } from './openaiSynthesize';

const FAKE_MP3_BASE64 = Buffer.from('fake-mp3-bytes').toString('base64');

function mockSuccessOnce() {
  mockSynthesizeSpeech.mockResolvedValueOnce({ audioBase64: FAKE_MP3_BASE64, mimeType: 'audio/mpeg' });
}

afterEach(() => {
  mockSynthesizeSpeech.mockReset();
});

describe('synthesizeReferenceAudio', () => {
  it('calls OpenAI once and reuses the real result for an identical (text, language) pair', async () => {
    mockSuccessOnce();

    const first = await synthesizeReferenceAudio('cache test phrase one', 'en');
    expect(first.success).toBe(true);
    expect(first.fromCache).toBeUndefined();
    expect(mockSynthesizeSpeech).toHaveBeenCalledTimes(1);

    const second = await synthesizeReferenceAudio('cache test phrase one', 'en');
    expect(second.success).toBe(true);
    expect(second.fromCache).toBe(true);
    expect(second.audioBase64).toBe(first.audioBase64);
    expect(mockSynthesizeSpeech).toHaveBeenCalledTimes(1);
  });

  it('synthesizes separately when the language differs, even for identical text', async () => {
    mockSuccessOnce();
    mockSuccessOnce();

    await synthesizeReferenceAudio('cache test phrase two', 'en');
    await synthesizeReferenceAudio('cache test phrase two', 'fr');

    expect(mockSynthesizeSpeech).toHaveBeenCalledTimes(2);
  });

  it('flags a 429 rate-limit failure as quotaExceeded, and does not cache the failure', async () => {
    mockSynthesizeSpeech.mockRejectedValueOnce(new Error('OpenAI speech synthesis failed (429): rate_limit exceeded'));

    const result = await synthesizeReferenceAudio('cache test phrase three', 'en');
    expect(result.success).toBe(false);
    expect(result.quotaExceeded).toBe(true);

    mockSuccessOnce();
    const retry = await synthesizeReferenceAudio('cache test phrase three', 'en');
    expect(retry.success).toBe(true);
    expect(retry.fromCache).toBeUndefined();
  });
});
