// Browser-only. Speaks text out loud, routed by language: Hausa, Igbo,
// Yoruba, English and Nigerian Pidgin all go to Sahara first — including
// English and Pidgin, which use Sahara's Nigerian English voice. That
// ordering is not cosmetic: the configured AI origin (see OPENAI_BASE_URL)
// can be a provider with no text-to-speech models at all, in which case
// OpenAI-first meant every English and Pidgin reply returned HTTP 500 and
// silently dropped to the device voice. Sahara is the one provider here that
// is verified to return real audio for these languages, so it leads and
// OpenAI becomes the fallback. Fulfulde has no genuinely supported voice on
// either provider — stated honestly rather than silently substituted with an
// English voice. Every path still falls back toward the device's own Web
// Speech synthesis (and ultimately to a plain "no voice available" outcome)
// so a spoken interaction never just dead-ends silently.
import { LANGUAGES, type LanguageCode } from '../../types';
import { AVAILABLE_VOICES } from './voices';

export interface SpeakOutcome {
  usedProvider: 'sahara' | 'openai' | 'browser' | 'none';
  fallbackReason?: string;
}

function languageDisplayName(code: LanguageCode): string {
  return LANGUAGES.find((l) => l.code === code)?.name ?? code;
}

// Which provider+voice speaks a given language, by design (see FIX 6):
// Sahara's native voices for the African languages it actually supports,
// OpenAI for English and Pidgin (English-based, and OpenAI's voices are
// English-tuned). Fulfulde is deliberately absent — neither configured
// provider has a real Fulfulde voice, so speakAloud() below says so rather
// than pretending an English or generic voice is a Fulfulde one.
/** Sahara's Nigerian English voice. Resolved from the catalogue rather than
 *  hardcoded so renaming a voice id is a one-place change, with a literal
 *  fallback so a catalogue reshuffle cannot silently drop the voice. */
const SAHARA_ENGLISH_VOICE_ID =
  AVAILABLE_VOICES.find((v) => v.provider === 'sahara' && v.language === 'en')?.id ?? 'sahara-en-female-1';

/** The OpenAI voice used when Sahara is unavailable. */
const OPENAI_FALLBACK_VOICE_ID = 'openai-alloy';

export interface TtsRoute {
  provider: 'sahara' | 'openai';
  voiceId: string;
}

const LANGUAGE_TTS_ROUTE: Partial<Record<LanguageCode, TtsRoute>> = {
  ha: { provider: 'sahara', voiceId: AVAILABLE_VOICES.find((v) => v.provider === 'sahara' && v.language === 'ha')?.id ?? 'sahara-ha-female-1' },
  ig: { provider: 'sahara', voiceId: AVAILABLE_VOICES.find((v) => v.provider === 'sahara' && v.language === 'ig')?.id ?? 'sahara-ig-female-1' },
  yo: { provider: 'sahara', voiceId: AVAILABLE_VOICES.find((v) => v.provider === 'sahara' && v.language === 'yo')?.id ?? 'sahara-yo-female-1' },
  // English and Pidgin share Sahara's Nigerian English voice; Pidgin is
  // English-based and its words are read with Nigerian phonetics, which is
  // how it is actually spoken. OpenAI is now the fallback, not the primary.
  en: { provider: 'sahara', voiceId: SAHARA_ENGLISH_VOICE_ID },
  pcm: { provider: 'sahara', voiceId: SAHARA_ENGLISH_VOICE_ID },
};

/** Which provider+voice speaks a given language. Exported as a pure lookup
 *  so the routing policy is unit-testable without a DOM, a network, or the
 *  Web Speech globals that speakAloud() itself needs. Returns undefined for
 *  a language no configured provider genuinely supports (currently Fulfulde). */
export function ttsRouteFor(language: LanguageCode): TtsRoute | undefined {
  return LANGUAGE_TTS_ROUTE[language];
}

// BCP-47 language tags to try, in order, when looking for an installed
// browser voice — most specific (Nigerian-region) first, then a bare
// language fallback. Nigerian Pidgin has no BCP-47 subtag of its own; it's
// English-based, so an English voice is the closest a browser can offer.
// Fulfulde's ISO 639-1 code is "ff"; browsers rarely ship a voice for it, so
// French is included as a last-resort regional fallback, not a substitute
// for real Fulfulde pronunciation.
const LANGUAGE_TO_BCP47: Record<LanguageCode, string[]> = {
  en: ['en-NG', 'en-US', 'en-GB', 'en'],
  pcm: ['en-NG', 'en-US', 'en'],
  yo: ['yo-NG', 'yo'],
  ig: ['ig-NG', 'ig'],
  ha: ['ha-NG', 'ha'],
  ful: ['ff-NG', 'ff', 'fr-FR', 'fr'],
  fr: ['fr-FR', 'fr'],
  es: ['es-ES', 'es'],
  zh: ['zh-CN', 'zh'],
  hi: ['hi-IN', 'hi'],
};

/** True when a real voice tag (e.g. "en-US") matches a candidate tag (e.g.
 *  "en-NG" or bare "en") — an exact language+region match, or a bare
 *  language-only candidate matching just the primary subtag. Exported pure
 *  so it's testable without any DOM/SpeechSynthesis globals. */
export function matchesLangTag(voiceTag: string, candidateTag: string): boolean {
  const voiceParts = voiceTag.toLowerCase().split('-');
  const candidateParts = candidateTag.toLowerCase().split('-');
  if (voiceParts[0] !== candidateParts[0]) return false;
  return candidateParts.length === 1 || voiceParts[1] === candidateParts[1];
}

/**
 * Picks the best available voice tag for `language` out of `availableTags`
 * (real voices' `.lang` values) — most-specific candidate first. Returns
 * null when nothing matches, rather than guessing. Pure and DOM-free so it
 * can be unit tested directly.
 */
export function findBestVoiceLangTag(availableTags: string[], language: LanguageCode): string | null {
  const candidates = LANGUAGE_TO_BCP47[language] ?? [language];
  for (const candidate of candidates) {
    const match = availableTags.find((tag) => matchesLangTag(tag, candidate));
    if (match) return match;
  }
  return null;
}

function playAudioBase64(audioBase64: string, mimeType: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const audio = new Audio(`data:${mimeType};base64,${audioBase64}`);
    audio.onended = () => resolve();
    audio.onerror = () => reject(new Error('Audio playback failed.'));
    audio.play().catch(reject);
  });
}

/** Speaks via the device's own Web Speech synthesis. Never throws — a
 *  missing API, or no matching installed voice, resolves `voiceFound: false`
 *  rather than silently speaking the wrong language or crashing the whole
 *  fallback chain. */
function speakWithBrowser(text: string, language: LanguageCode): Promise<{ voiceFound: boolean }> {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) {
      resolve({ voiceFound: false });
      return;
    }
    const synth = window.speechSynthesis;
    const voices = synth.getVoices();
    const bestTag = findBestVoiceLangTag(
      voices.map((v) => v.lang),
      language
    );
    const matching = bestTag ? voices.find((v) => v.lang === bestTag) : undefined;
    if (!matching) {
      resolve({ voiceFound: false });
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = matching;
    utterance.onend = () => resolve({ voiceFound: true });
    utterance.onerror = () => resolve({ voiceFound: true });
    synth.speak(utterance);
  });
}

async function fallbackToBrowser(text: string, language: LanguageCode, upstreamReason?: string): Promise<SpeakOutcome> {
  const { voiceFound } = await speakWithBrowser(text, language);
  if (!voiceFound) {
    return { usedProvider: 'none', fallbackReason: `No ${languageDisplayName(language)} voice is installed on this device.` };
  }
  return { usedProvider: 'browser', fallbackReason: upstreamReason };
}

async function requestGeneratedSpeech(text: string, language: LanguageCode, provider: 'sahara' | 'openai', voiceId: string) {
  const res = await fetch('/api/tts/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, language, voiceId, provider, emotion: 'empathic' }),
  });
  const data = await res.json();
  return { ok: res.ok && data.success && Boolean(data.audioBase64), data };
}

/** Speaks `text` aloud, resolving once playback has finished. Never throws. */
export async function speakAloud(text: string, language: LanguageCode): Promise<SpeakOutcome> {
  const route = ttsRouteFor(language);

  if (!route) {
    // No configured provider genuinely supports this language's speech
    // synthesis yet (currently just Fulfulde) — say so honestly and go
    // straight to whatever the browser can do, rather than pretending an
    // English voice is a match for it.
    return fallbackToBrowser(text, language, `No configured voice provider supports ${languageDisplayName(language)} yet.`);
  }

  try {
    const primary = await requestGeneratedSpeech(text, language, route.provider, route.voiceId);
    if (primary.ok) {
      await playAudioBase64(primary.data.audioBase64, primary.data.mimeType || 'audio/wav');
      return { usedProvider: route.provider };
    }

    // Sahara didn't come through (not configured, quota, etc.) — try
    // OpenAI's English-tuned voice before dropping all the way to the
    // browser, per the fallback order Sahara → OpenAI → browser.
    if (route.provider === 'sahara') {
      const openaiFallback = await requestGeneratedSpeech(text, language, 'openai', OPENAI_FALLBACK_VOICE_ID);
      if (openaiFallback.ok) {
        await playAudioBase64(openaiFallback.data.audioBase64, openaiFallback.data.mimeType || 'audio/wav');
        return {
          usedProvider: 'openai',
          fallbackReason: `Sahara voice unavailable (${primary.data.error || 'not configured'}) — used OpenAI's English-tuned voice instead.`,
        };
      }
    }

    return fallbackToBrowser(text, language, primary.data.error);
  } catch (err) {
    return fallbackToBrowser(text, language, err instanceof Error ? err.message : 'Network error contacting voice service.');
  }
}
