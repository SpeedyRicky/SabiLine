import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockChatCompletion = vi.fn();
let configured = true;

vi.mock('../tts/openaiClient', async () => {
  const actual = await vi.importActual<typeof import('../tts/openaiClient')>('../tts/openaiClient');
  return {
    ...actual,
    isOpenAIConfigured: () => configured,
    openaiChatCompletion: (...args: unknown[]) => mockChatCompletion(...args),
  };
});

import { getSabiLineReply, SYMPTOM_PRESERVATION, SYMPTOM_GLOSSARY } from './converse';
import { isTimeoutError } from '../tts/openaiClient';
import type { IntakeConversationTurn } from './types';
import type { LanguageCode } from '../../types';

afterEach(() => {
  configured = true;
  mockChatCompletion.mockReset();
});

describe('getSabiLineReply without a configured key', () => {
  beforeEach(() => {
    configured = false;
  });

  it('fails honestly without a network call when no OpenAI key is set', async () => {
    const result = await getSabiLineReply([], 'hello', 'en', 0);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/OPEN_AI_KEY/);
    expect(result.notConfigured).toBe(true);
    expect(mockChatCompletion).not.toHaveBeenCalled();
  });
});

describe('getSabiLineReply with a configured key', () => {
  it('returns the spoken reply and in-progress fields when not yet done', async () => {
    mockChatCompletion.mockResolvedValueOnce(
      JSON.stringify({
        spokenReply: 'Thanks — and how old are you?',
        done: false,
        fields: { name: 'Amina', ageOrDob: null, paymentType: null, reasonForVisit: null, symptomDuration: null, allergies: null },
        needsManualReview: false,
      })
    );

    const result = await getSabiLineReply([], 'My name is Amina', 'en', 0);
    expect(result.success).toBe(true);
    expect(result.spokenReply).toBe('Thanks — and how old are you?');
    expect(result.done).toBe(false);
    expect(result.fields?.name).toBe('Amina');
  });

  it('returns the assigned department and appointment slot once a time is confirmed', async () => {
    mockChatCompletion.mockResolvedValueOnce(
      JSON.stringify({
        spokenReply: "You're all set — see you then!",
        done: true,
        fields: { name: 'Amina', ageOrDob: null, phoneNumber: null, paymentType: null, reasonForVisit: 'fever', symptomDuration: null, allergies: null },
        department: 'Malaria & Fever Care',
        appointmentSlot: 'Mon Sep 15, 10:30am',
        needsManualReview: false,
      })
    );

    const result = await getSabiLineReply([], 'Yes, Monday at 10:30am works', 'en', 3);
    expect(result.success).toBe(true);
    expect(result.department).toBe('Malaria & Fever Care');
    expect(result.appointmentSlot).toBe('Mon Sep 15, 10:30am');
  });

  it('reports department and appointmentSlot as null before a time is confirmed', async () => {
    mockChatCompletion.mockResolvedValueOnce(
      JSON.stringify({
        spokenReply: 'And how long have you had the fever?',
        done: false,
        fields: {},
        needsManualReview: false,
      })
    );

    const result = await getSabiLineReply([], 'Since yesterday', 'en', 0);
    expect(result.department).toBeNull();
    expect(result.appointmentSlot).toBeNull();
  });

  it('sends the full conversation history plus the new turn, and never invents an assistant turn', async () => {
    mockChatCompletion.mockResolvedValueOnce(
      JSON.stringify({ spokenReply: 'Got it.', done: false, fields: {}, needsManualReview: false })
    );

    const history: IntakeConversationTurn[] = [
      { role: 'model', text: 'Hello, how can I help?' },
      { role: 'user', text: 'I have a fever' },
      { role: 'model', text: 'Sorry to hear that. What is your name?' },
    ];
    await getSabiLineReply(history, 'My name is Amina', 'en', 0);

    const messages = mockChatCompletion.mock.calls[0][0];
    // messages[0] is the system instruction; the rest mirror history + the new turn.
    expect(messages).toHaveLength(5);
    expect(messages[4]).toEqual({ role: 'user', content: 'My name is Amina' });
    expect(messages[1]).toEqual({ role: 'assistant', content: 'Hello, how can I help?' });
  });

  it('includes the topic-drift instruction only once elapsedMinutes reaches 2', async () => {
    mockChatCompletion.mockResolvedValue(
      JSON.stringify({ spokenReply: 'Okay.', done: false, fields: {}, needsManualReview: false })
    );

    await getSabiLineReply([], 'hi', 'en', 1);
    const shortCallInstruction = mockChatCompletion.mock.calls[0][0][0].content;
    expect(shortCallInstruction).not.toMatch(/drift/);

    await getSabiLineReply([], 'hi', 'en', 4);
    const longCallInstruction = mockChatCompletion.mock.calls[1][0][0].content;
    expect(longCallInstruction).toMatch(/4 minutes/);
    expect(longCallInstruction).toMatch(/SabiLine health line/);
  });

  it('fails honestly rather than fabricating a reply when the response has no spokenReply', async () => {
    mockChatCompletion.mockResolvedValueOnce(
      JSON.stringify({ spokenReply: '', done: false, fields: {}, needsManualReview: false })
    );

    const result = await getSabiLineReply([], 'hi', 'en', 0);
    expect(result.success).toBe(false);
  });

  it('flags a 429 rate-limit failure as quotaExceeded', async () => {
    mockChatCompletion.mockRejectedValueOnce(new Error('OpenAI chat completion failed (429): rate_limit exceeded'));

    const result = await getSabiLineReply([], 'hi', 'en', 0);
    expect(result.success).toBe(false);
    expect(result.quotaExceeded).toBe(true);
  });

  it('flags timedOut and fails fast when the model hangs past the platform-safe budget', async () => {
    vi.useFakeTimers();
    try {
      mockChatCompletion.mockReturnValueOnce(new Promise(() => {})); // never resolves
      const resultPromise = getSabiLineReply([], 'hi', 'en', 0);
      await vi.runAllTimersAsync();
      const result = await resultPromise;
      expect(result.success).toBe(false);
      expect(result.timedOut).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens with a greeting when userText is null, without inventing a patient turn', async () => {
    mockChatCompletion.mockResolvedValueOnce(
      JSON.stringify({
        spokenReply: 'Hello, thanks for calling SabiLine — how can I help you today?',
        done: false,
        fields: {},
        needsManualReview: false,
      })
    );

    const result = await getSabiLineReply([], null, 'en', 0);
    expect(result.success).toBe(true);
    expect(result.spokenReply).toMatch(/Hello/);

    const messages = mockChatCompletion.mock.calls[0][0];
    expect(messages).toHaveLength(2); // system + the synthetic opening turn
    expect(messages[1].role).toBe('user');
    expect(messages[0].content).toMatch(/call has just connected/);
  });
});

describe('getSabiLineReply language switching', () => {
  it('returns the languageCode the model reports for this turn', async () => {
    mockChatCompletion.mockResolvedValueOnce(
      JSON.stringify({ spokenReply: 'Bawo ni', languageCode: 'yo', done: false, fields: {}, needsManualReview: false })
    );

    const result = await getSabiLineReply([], 'Mo ni iba', 'en', 1);
    expect(result.languageCode).toBe('yo');
  });

  it('falls back to the given language anchor when the model omits languageCode', async () => {
    mockChatCompletion.mockResolvedValueOnce(
      JSON.stringify({ spokenReply: 'Okay.', done: false, fields: {}, needsManualReview: false })
    );

    const result = await getSabiLineReply([], 'hi', 'ha', 0);
    expect(result.languageCode).toBe('ha');
  });

  it('falls back to the given language anchor when the model returns an unsupported languageCode', async () => {
    mockChatCompletion.mockResolvedValueOnce(
      JSON.stringify({ spokenReply: 'Bonjour.', languageCode: 'fr', done: false, fields: {}, needsManualReview: false })
    );

    const result = await getSabiLineReply([], 'hi', 'en', 0);
    expect(result.languageCode).toBe('en');
  });

  it('mentions the anchor language by name in the prompt, and follows a switch reported on the next turn', async () => {
    mockChatCompletion.mockResolvedValueOnce(
      JSON.stringify({ spokenReply: 'Bawo ni, kini oruko re?', languageCode: 'yo', done: false, fields: {}, needsManualReview: false })
    );
    const first = await getSabiLineReply([], 'Mo ni iba', 'en', 1);
    expect(first.languageCode).toBe('yo');
    const firstSystemPrompt = mockChatCompletion.mock.calls[0][0][0].content;
    expect(firstSystemPrompt).toMatch(/English/);

    mockChatCompletion.mockResolvedValueOnce(
      JSON.stringify({ spokenReply: 'Okay, thank you.', languageCode: 'en', done: false, fields: {}, needsManualReview: false })
    );
    const history: IntakeConversationTurn[] = [
      { role: 'model', text: 'Bawo ni...' },
      { role: 'user', text: 'Mo ni iba' },
      { role: 'model', text: 'Bawo ni, kini oruko re?' },
    ];
    const second = await getSabiLineReply(history, 'Actually can we continue in English', 'yo', 2);
    expect(second.languageCode).toBe('en');
    const secondSystemPrompt = mockChatCompletion.mock.calls[1][0][0].content;
    expect(secondSystemPrompt).toMatch(/Yoruba/);
  });

  it('sets the opening greeting language to English without needing a network-returned languageCode', async () => {
    mockChatCompletion.mockResolvedValueOnce(
      JSON.stringify({ spokenReply: 'Hello, thanks for calling SabiLine.', done: false, fields: {}, needsManualReview: false })
    );

    const result = await getSabiLineReply([], null, 'en', 0);
    expect(result.languageCode).toBe('en');
    const systemPrompt = mockChatCompletion.mock.calls[0][0][0].content;
    expect(systemPrompt).toMatch(/nothing to detect/);
  });

  it('greets in the caller\'s KNOWN language rather than defaulting to English', async () => {
    mockChatCompletion.mockResolvedValueOnce(
      JSON.stringify({ spokenReply: 'Ẹ káàbọ̀', languageCode: 'yo', done: false, fields: {}, needsManualReview: false })
    );

    const result = await getSabiLineReply([], null, 'yo', 0);
    expect(result.success).toBe(true);

    const prompt = mockChatCompletion.mock.calls[0][0][0].content;
    expect(prompt).toMatch(/entirely in Yoruba/);
    expect(prompt).toMatch(/not one word of English/);
    // The old behaviour told the model it did not know the language and to
    // greet in English. That must be gone.
    expect(prompt).not.toMatch(/you don't know their language yet/);
  });

  it('names the known language in the greeting for every supported language', async () => {
    const cases: Array<[LanguageCode, string]> = [
      ['en', 'English'],
      ['pcm', 'Nigerian Pidgin'],
      ['ig', 'Igbo'],
      ['ha', 'Hausa'],
      ['ful', 'Fulfulde'],
    ];
    for (const [code, name] of cases) {
      mockChatCompletion.mockResolvedValueOnce(
        JSON.stringify({ spokenReply: 'x', languageCode: code, done: false, fields: {}, needsManualReview: false })
      );
      const result = await getSabiLineReply([], null, code, 0);
      expect(result.success, code).toBe(true);
      const prompt = mockChatCompletion.mock.calls[mockChatCompletion.mock.calls.length - 1][0][0].content;
      expect(prompt, code).toMatch(new RegExp(`in ${name}\\b`));
    }
  });

  it('does not demand "no English" when English IS the known language', async () => {
    mockChatCompletion.mockResolvedValueOnce(
      JSON.stringify({ spokenReply: 'Hello', languageCode: 'en', done: false, fields: {}, needsManualReview: false })
    );

    await getSabiLineReply([], null, 'en', 0);
    const prompt = mockChatCompletion.mock.calls[0][0][0].content;
    expect(prompt).toMatch(/Write "spokenReply" in English/);
    expect(prompt).not.toMatch(/not one word of English/);
  });

  it('degrades gracefully with needsManualReview when the model returns unparseable JSON', async () => {
    mockChatCompletion.mockResolvedValueOnce('not json at all');

    const result = await getSabiLineReply([], 'hi', 'en', 0);
    expect(result.success).toBe(false);
    expect(result.needsManualReview).toBe(true);
  });
});

describe('clinical symptom fidelity', () => {
  it('instructs the model to preserve every symptom the patient named', async () => {
    mockChatCompletion.mockResolvedValueOnce(
      JSON.stringify({ spokenReply: 'Okay.', done: false, fields: {}, needsManualReview: false })
    );

    await getSabiLineReply([], 'Mo ni iba ati orififo', 'yo', 0);
    const instruction = mockChatCompletion.mock.calls[0][0][0].content;

    expect(instruction).toContain(SYMPTOM_PRESERVATION);
    expect(instruction).toMatch(/preserve EVERY distinct symptom/);
    expect(instruction).toMatch(/never substitute a different symptom/i);
    expect(instruction).toMatch(/never merge two different symptoms/i);
  });

  it('names the exact regression that turned a headache into a cough', async () => {
    mockChatCompletion.mockResolvedValueOnce(
      JSON.stringify({ spokenReply: 'Okay.', done: false, fields: {}, needsManualReview: false })
    );

    await getSabiLineReply([], 'Mo ni iba ati orififo', 'yo', 0);
    const instruction = mockChatCompletion.mock.calls[0][0][0].content;

    // "orififo" reached the record as "cough". The prompt must say plainly
    // that it means headache.
    expect(instruction).toMatch(/orififo/);
    expect(instruction).toMatch(/HEADACHE/);
    expect(instruction).toMatch(/recording either of them as "cough"/);
  });

  it('gives the model a real translating glossary rather than word-shape guessing', async () => {
    mockChatCompletion.mockResolvedValueOnce(
      JSON.stringify({ spokenReply: 'Okay.', done: false, fields: {}, needsManualReview: false })
    );

    await getSabiLineReply([], 'Ina jin zazzabi', 'ha', 0);
    const instruction = mockChatCompletion.mock.calls[0][0][0].content;

    expect(instruction).toContain(SYMPTOM_GLOSSARY);
    expect(instruction).toMatch(/zazzabi = fever/);
    expect(instruction).toMatch(/isi ọwụwa/);
    expect(instruction).toMatch(/ciwon kai = headache/);
    // Fulfulde is deliberately left uncovered rather than guessed at.
    expect(instruction).toMatch(/Fulfulde is not covered above/);
  });

  it('keeps the original word when a term cannot be translated confidently', async () => {
    mockChatCompletion.mockResolvedValueOnce(
      JSON.stringify({ spokenReply: 'Okay.', done: false, fields: {}, needsManualReview: false })
    );

    await getSabiLineReply([], 'Mo ni iba', 'yo', 0);
    const instruction = mockChatCompletion.mock.calls[0][0][0].content;
    expect(instruction).toMatch(/untranslated word a clinician can look up/);
  });

  it('still carries the full symptom rule on the opening greeting turn', async () => {
    // The rule must not be conditional on there being a patient turn yet —
    // it has to be in every system instruction the conversation sees.
    mockChatCompletion.mockResolvedValueOnce(
      JSON.stringify({ spokenReply: 'Hello.', done: false, fields: {}, needsManualReview: false })
    );

    await getSabiLineReply([], null, 'en', 0);
    const instruction = mockChatCompletion.mock.calls[0][0][0].content;
    expect(instruction).toContain(SYMPTOM_PRESERVATION);
  });

  it('does not let the symptom rule leak the word the drift test forbids', async () => {
    mockChatCompletion.mockResolvedValue(
      JSON.stringify({ spokenReply: 'Okay.', done: false, fields: {}, needsManualReview: false })
    );
    await getSabiLineReply([], 'hi', 'en', 1);
    const shortCallInstruction = mockChatCompletion.mock.calls[0][0][0].content;
    expect(shortCallInstruction).not.toMatch(/drift/);
  });
});

describe('language confidence reporting', () => {
  it('returns the confidence the model reported for this turn', async () => {
    mockChatCompletion.mockResolvedValueOnce(
      JSON.stringify({
        spokenReply: 'Bawo ni',
        languageCode: 'yo',
        confidence: 0.88,
        done: false,
        fields: {},
        needsManualReview: false,
      })
    );

    const result = await getSabiLineReply([], 'Mo ni iba ati orififo', 'yo', 0);
    expect(result.confidence).toBe(0.88);
  });

  it('leaves confidence undefined when the model omits it', async () => {
    mockChatCompletion.mockResolvedValueOnce(
      JSON.stringify({ spokenReply: 'Okay.', languageCode: 'en', done: false, fields: {}, needsManualReview: false })
    );

    const result = await getSabiLineReply([], 'hi', 'en', 0);
    expect(result.confidence).toBeUndefined();
  });

  it('asks for confidence in the documented JSON contract', async () => {
    mockChatCompletion.mockResolvedValueOnce(
      JSON.stringify({ spokenReply: 'Okay.', done: false, fields: {}, needsManualReview: false })
    );

    await getSabiLineReply([], 'hi', 'en', 0);
    const instruction = mockChatCompletion.mock.calls[0][0][0].content;
    expect(instruction).toMatch(/"confidence": number/);
    expect(instruction).toMatch(/below 0\.5 when the text is short/);
  });
});

// Sanity check that the timeout error type re-exported for callers still
// works as expected — a thin guard against a future refactor silently
// breaking the isTimeoutError() check converse.ts relies on.
describe('isTimeoutError', () => {
  it('does not flag an ordinary error as a timeout', () => {
    expect(isTimeoutError(new Error('boom'))).toBe(false);
  });
});
