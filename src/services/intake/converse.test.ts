import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockGenerateContent = vi.fn();

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: { generateContent: mockGenerateContent },
  })),
}));

import { getSabiLineReply } from './converse';
import type { IntakeConversationTurn } from './types';

const savedKey = process.env.GEMINI_API_KEY;

afterEach(() => {
  if (savedKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = savedKey;
});

describe('getSabiLineReply without a configured key', () => {
  beforeEach(() => {
    delete process.env.GEMINI_API_KEY;
  });

  it('fails honestly without a network call when GEMINI_API_KEY is unset', async () => {
    const result = await getSabiLineReply([], 'hello', 'en', 0);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/GEMINI_API_KEY/);
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });
});

describe('getSabiLineReply with a configured key', () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'fake-key-for-test';
    mockGenerateContent.mockReset();
  });

  it('returns the spoken reply and in-progress fields when not yet done', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        spokenReply: 'Thanks — and how old are you?',
        done: false,
        fields: { name: 'Amina', ageOrDob: null, paymentType: null, reasonForVisit: null, symptomDuration: null, allergies: null },
        needsManualReview: false,
      }),
    });

    const result = await getSabiLineReply([], 'My name is Amina', 'en', 0);
    expect(result.success).toBe(true);
    expect(result.spokenReply).toBe('Thanks — and how old are you?');
    expect(result.done).toBe(false);
    expect(result.fields?.name).toBe('Amina');
  });

  it('sends the full conversation history plus the new turn, and never invents an assistant turn', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({ spokenReply: 'Got it.', done: false, fields: {}, needsManualReview: false }),
    });

    const history: IntakeConversationTurn[] = [
      { role: 'model', text: 'Hello, how can I help?' },
      { role: 'user', text: 'I have a fever' },
      { role: 'model', text: 'Sorry to hear that. What is your name?' },
    ];
    await getSabiLineReply(history, 'My name is Amina', 'en', 0);

    const callArgs = mockGenerateContent.mock.calls[0][0];
    expect(callArgs.contents).toHaveLength(4);
    expect(callArgs.contents[3]).toEqual({ role: 'user', parts: [{ text: 'My name is Amina' }] });
    expect(callArgs.contents[0]).toEqual({ role: 'model', parts: [{ text: 'Hello, how can I help?' }] });
  });

  it('includes the topic-drift instruction only once elapsedMinutes reaches 2', async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({ spokenReply: 'Okay.', done: false, fields: {}, needsManualReview: false }),
    });

    await getSabiLineReply([], 'hi', 'en', 1);
    const shortCallInstruction = mockGenerateContent.mock.calls[0][0].config.systemInstruction;
    expect(shortCallInstruction).not.toMatch(/drift/);

    await getSabiLineReply([], 'hi', 'en', 4);
    const longCallInstruction = mockGenerateContent.mock.calls[1][0].config.systemInstruction;
    expect(longCallInstruction).toMatch(/4 minutes/);
    expect(longCallInstruction).toMatch(/SabiLine health line/);
  });

  it('fails honestly rather than fabricating a reply when the response has no spokenReply', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({ spokenReply: '', done: false, fields: {}, needsManualReview: false }),
    });

    const result = await getSabiLineReply([], 'hi', 'en', 0);
    expect(result.success).toBe(false);
  });

  it('flags a 429 RESOURCE_EXHAUSTED failure as quotaExceeded', async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error('429 RESOURCE_EXHAUSTED: quota exceeded'));

    const result = await getSabiLineReply([], 'hi', 'en', 0);
    expect(result.success).toBe(false);
    expect(result.quotaExceeded).toBe(true);
  });
});
