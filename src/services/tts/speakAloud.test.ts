import { describe, it, expect } from 'vitest';
import { matchesLangTag, findBestVoiceLangTag, ttsRouteFor } from './speakAloud';

// The configured AI origin may be a provider with no text-to-speech models at
// all (see OPENAI_BASE_URL). Routing English and Pidgin to OpenAI first meant
// every such reply returned HTTP 500 and silently dropped to the device
// voice, so Sahara — verified to return real audio — leads for both.
describe('ttsRouteFor', () => {
  it('routes English to Sahara\'s Nigerian English voice, not to OpenAI', () => {
    const route = ttsRouteFor('en');
    expect(route?.provider).toBe('sahara');
    expect(route?.voiceId).toMatch(/sahara-en-/);
  });

  it('routes Nigerian Pidgin to Sahara as well, since Pidgin is English-based', () => {
    const route = ttsRouteFor('pcm');
    expect(route?.provider).toBe('sahara');
    expect(route?.voiceId).toMatch(/sahara-en-/);
  });

  it('gives English and Pidgin the same voice, so a mid-call switch does not change speaker', () => {
    expect(ttsRouteFor('pcm')?.voiceId).toBe(ttsRouteFor('en')?.voiceId);
  });

  it('keeps the native African-language voices on Sahara', () => {
    for (const language of ['ha', 'ig', 'yo'] as const) {
      const route = ttsRouteFor(language);
      expect(route?.provider, language).toBe('sahara');
      expect(route?.voiceId, language).toMatch(new RegExp(`sahara-${language}-`));
    }
  });

  it('never routes a language to OpenAI as the primary provider', () => {
    for (const language of ['en', 'pcm', 'ha', 'ig', 'yo'] as const) {
      expect(ttsRouteFor(language)?.provider, language).toBe('sahara');
    }
  });

  it('returns undefined for Fulfulde rather than substituting an English voice', () => {
    expect(ttsRouteFor('ful')).toBeUndefined();
  });
});

// These test the pure BCP-47 matching logic only — no DOM/SpeechSynthesis
// globals involved, so they run fine under vitest's default 'node'
// environment (this project has no jsdom dependency, and adding one just
// for this would be a new dependency for a single test file).
describe('matchesLangTag', () => {
  it('matches a region-specific voice tag against a region-specific candidate', () => {
    expect(matchesLangTag('yo-NG', 'yo-NG')).toBe(true);
  });

  it('matches a region-specific voice tag against a bare-language candidate', () => {
    expect(matchesLangTag('en-GB', 'en')).toBe(true);
  });

  it('does not match a different primary language', () => {
    expect(matchesLangTag('fr-FR', 'yo')).toBe(false);
  });

  it('does not match a different region when the candidate specifies one', () => {
    expect(matchesLangTag('en-GB', 'en-NG')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(matchesLangTag('YO-ng', 'yo-NG')).toBe(true);
  });
});

describe('findBestVoiceLangTag', () => {
  it('prefers the Nigerian-region tag for Yoruba when both it and a bare tag are available', () => {
    const result = findBestVoiceLangTag(['en-US', 'yo', 'yo-NG'], 'yo');
    expect(result).toBe('yo-NG');
  });

  it('falls back to a bare-language tag when no region-specific one is installed', () => {
    const result = findBestVoiceLangTag(['en-US', 'ig'], 'ig');
    expect(result).toBe('ig');
  });

  it('returns null (never a wrong-language guess) when nothing matches', () => {
    const result = findBestVoiceLangTag(['en-US', 'fr-FR'], 'ha');
    expect(result).toBeNull();
  });

  it('maps Nigerian Pidgin to an English voice tag, since Pidgin has no BCP-47 subtag of its own', () => {
    const result = findBestVoiceLangTag(['en-NG', 'fr-FR'], 'pcm');
    expect(result).toBe('en-NG');
  });

  it('returns null for Fulfulde when no ff/fr voice is installed, rather than defaulting to English', () => {
    const result = findBestVoiceLangTag(['en-US', 'en-GB'], 'ful');
    expect(result).toBeNull();
  });

  it('accepts a French voice as a last-resort regional match for Fulfulde', () => {
    const result = findBestVoiceLangTag(['en-US', 'fr-FR'], 'ful');
    expect(result).toBe('fr-FR');
  });
});
