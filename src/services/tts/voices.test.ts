import { describe, it, expect } from 'vitest';
import { AVAILABLE_VOICES, PROVIDER_CAPABILITIES } from './voices';
import { LANGUAGES, type LanguageCode } from '../../types';

describe('language catalog', () => {
  const requiredLanguages: LanguageCode[] = ['en', 'fr', 'zh', 'hi', 'es', 'ig', 'ha', 'yo'];

  it('registers all 8 required languages', () => {
    const codes = LANGUAGES.map((l) => l.code);
    for (const code of requiredLanguages) {
      expect(codes).toContain(code);
    }
  });

  it('marks Hausa, Igbo, and Yoruba as first-class African languages', () => {
    const hausa = LANGUAGES.find((l) => l.code === 'ha');
    const igbo = LANGUAGES.find((l) => l.code === 'ig');
    const yoruba = LANGUAGES.find((l) => l.code === 'yo');
    expect(hausa?.african).toBe(true);
    expect(igbo?.african).toBe(true);
    expect(yoruba?.african).toBe(true);
  });
});

describe('provider capability & voice options', () => {
  it('Sahara explicitly declares support for Hausa, Igbo, and Yoruba', () => {
    expect(PROVIDER_CAPABILITIES.sahara.supportedLanguages).toEqual(
      expect.arrayContaining(['ha', 'yo', 'ig'])
    );
  });

  it('has at least one native voice for each of Hausa, Igbo, and Yoruba', () => {
    for (const code of ['ha', 'ig', 'yo'] as const) {
      const voices = AVAILABLE_VOICES.filter((v) => v.language === code);
      expect(voices.length).toBeGreaterThan(0);
    }
  });

  it('every voice references a provider that exists in PROVIDER_CAPABILITIES', () => {
    for (const voice of AVAILABLE_VOICES) {
      expect(PROVIDER_CAPABILITIES[voice.provider]).toBeDefined();
    }
  });

  it('never claims a provider supports a language it has no voice for at all, except openai (fallback dropdown option)', () => {
    for (const [providerId, cap] of Object.entries(PROVIDER_CAPABILITIES)) {
      if (providerId === 'openai') continue; // openai voices intentionally act as a universal fallback
      for (const lang of cap.supportedLanguages) {
        const hasVoice = AVAILABLE_VOICES.some((v) => v.provider === providerId && v.language === lang);
        expect(hasVoice, `${providerId} claims to support ${lang} but has no matching voice`).toBe(true);
      }
    }
  });
});
