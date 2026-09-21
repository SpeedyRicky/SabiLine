import {
  isOpenAIConfigured,
  openaiChatCompletion,
  openaiTranscribeAudio,
  isQuotaExceededError,
  isTimeoutError,
  withTimeout,
  OPENAI_CHAT_TIMEOUT_MS,
  OPENAI_TRANSCRIBE_TIMEOUT_MS,
} from '../tts/openaiClient';
import type { LanguageCode } from '../../types';

export interface DetectLanguageResult {
  success: boolean;
  languageCode?: LanguageCode;
  transcript?: string;
  error?: string;
  quotaExceeded?: boolean;
  notConfigured?: boolean;
  timedOut?: boolean;
  latencyMs: number;
}

export const SUPPORTED_LANGUAGE_CODES: LanguageCode[] = ['en', 'pcm', 'yo', 'ig', 'ha', 'ful'];
const LANGUAGE_CHOICES_DESC =
  'English (en), Nigerian Pidgin (pcm), Yoruba (yo), Igbo (ig), Hausa (ha), or Fulfulde (ful)';

const LANGUAGE_NAMES: Partial<Record<LanguageCode, string>> = {
  en: 'English',
  pcm: 'Nigerian Pidgin',
  yo: 'Yoruba',
  ig: 'Igbo',
  ha: 'Hausa',
  ful: 'Fulfulde',
};

// Nigerian Pidgin draws most of its vocabulary from English, so a classifier
// told only "Nigerian Pidgin (pcm)" reliably returns "en" for it. That single
// misread is costly here: a Pidgin speaker who is misread as English would
// be answered in English for the rest of the call. Naming the grammatical
// markers explicitly is what separates the two.
export const PIDGIN_DISAMBIGUATION =
  'Important: Nigerian Pidgin is a distinct language and must be labelled "pcm", never "en". It borrows English words but has its own grammar. Treat it as pcm if you hear markers such as: "dey", "don", "go" as a future marker, "wetin", "abeg", "na" as a copula, "no be", "sabi", "comot", "pikin", "belle", "wahala", "small small", "make I", "e be like say". Judge by these structures, not by how many individual words look English. Only use "en" for standard or Nigerian-accented English that lacks this grammar.';

// Distinctive grammatical markers and high-frequency clinic vocabulary for
// every supported language, in the same spirit as the Pidgin block above.
//
// The case that motivated this: "Ina jinin jiki, kai na ciwo" is three
// Hausa words carrying almost no signal beyond their function words, and a
// classifier told only the language *names* has nothing to weigh them
// against — it answered "yo" for a Hausa speaker. Naming the markers is
// what turns a short utterance from a coin flip into real evidence.
//
// Deliberately not exhaustive and not a translator: these are the words
// that discriminate between these five languages, which is a different job
// from producing good English. Terms shared across languages (or shared
// with English) are omitted rather than listed everywhere, since a word
// present in every list proves nothing.
export const LANGUAGE_MARKERS: Partial<Record<LanguageCode, string>> = {
  en:
    'standard English grammar — "I have", "I am", "since yesterday", "please", "thank you" — with none of the non-English markers below.',
  pcm:
    'Pidgin grammar rather than English vocabulary (see the Pidgin note above): "dey", "don", "wetin", "abeg", "na", "no be", "sabi", "make I", "e be like say", "body dey hot", "belle dey pain".',
  yo: '"mo ni" / "mo n" (I have), "orí" and "orififo" (head / headache — headache, NOT cough), "ìba" (fever), "ikọ́" (cough), "inú" (stomach), "ọmọ" (child), "jọ̀wọ́" (please), "ṣé", "kí ni", "báwo", "o ṣe", "àárẹ̀" (weakness), "òórùn" (pain), "ẹ̀jẹ̀" (blood). Subject pronouns "mo / ó / àwọn" and "ni" as a copula are strong Yoruba signals.',
  ig: '"m nwere" (I have), "isi" (head), "isi ọwụwa" / "isi na-egbu m" (headache), "ahụ ọkụ" (fever), "ụkwara" (cough), "afọ" (stomach), "mgbu" (pain), "ọgwụ" (medicine), "biko" (please), "kedu", "gịnị", "ọ dị", "kwa". The "na-" verb prefix and the "m / gị" pronouns are strong Igbo signals.',
  ha: '"ina jin" (I feel), "ciwo" / "ciwon" (pain), "kai" (head), "jiki" (body), "zazzabi" (fever), "tari" (cough), "ciki" (stomach), "magani" (medicine), "don Allah" (please), "nawa", "yaya", "kuma" (and), "ba ni". The "-n" genitive (ciwon kai) and "na" before a verb are strong Hausa signals.',
  ful: '"mi" (I), "na" as a first-person marker, "hoore" (head), "wane" / "no" (who / it is), "jam" (hello, peace), "nyaako", "eey", "na nawa" / "na nawni" (it hurts me), "doktooro" (doctor). Noun-class prefixes on many nouns are characteristic.',
};

/**
 * The full language-identification instruction: the original Pidgin
 * disambiguation plus a marker list for every other supported language.
 * Kept as one exported string so both the standalone classifier and the
 * merged reply completion instruct the model identically — a language that
 * one path can detect and the other cannot would be a silent inconsistency.
 */
export const LANGUAGE_DISAMBIGUATION = `${PIDGIN_DISAMBIGUATION} Weigh short utterances by these per-language markers: ${(
  Object.keys(LANGUAGE_MARKERS) as LanguageCode[]
)
  .map((code) => `${LANGUAGE_NAMES[code] ?? code}: ${LANGUAGE_MARKERS[code]}`)
  .join(' ')} Judge by grammar and function words, not by one word that also occurs in another language.`;

/**
 * How the model is asked to report its own certainty. Without this, a small
 * model answers a three-word utterance with the same flat confidence as a
 * full sentence, and there is nothing for the code-level switch guard below
 * to test against.
 */
export const CONFIDENCE_GUIDANCE =
  'Also report "confidence": a number from 0 to 1 for how sure you are of that language on this utterance alone. Use below 0.5 when the text is short, ambiguous, or mostly names and numbers shared across languages; use 0.85 or above only when the grammar is unmistakable.';

// A language already established for the call is only given up when the
// model is genuinely sure. Below this, the call keeps the language it has:
// a wrong switch is far worse than a delayed one, because the patient then
// hears the wrong language for every remaining turn.
export const LANGUAGE_SWITCH_CONFIDENCE_THRESHOLD = 0.6;

export interface LanguageSwitchDecision {
  language: LanguageCode;
  switched: boolean;
  reason: 'no-candidate' | 'same-language' | 'low-evidence' | 'low-confidence' | 'switched';
}

/**
 * Decides whether a freshly reported language actually replaces the call's
 * established one. Pure and side-effect free so the whole switching policy
 * is unit-testable without a model in the loop.
 *
 * Deliberately asymmetric: an ABSENT confidence does not block a switch
 * (a model that omits the field is a prompt-compliance problem, and blocking
 * there would disable mid-call switching entirely for such a model), while
 * an EXPLICIT low confidence does block it.
 */
export function resolveLanguageSwitch(
  anchor: LanguageCode,
  candidate: LanguageCode | undefined,
  confidence: number | undefined,
  isLowEvidence: boolean
): LanguageSwitchDecision {
  if (!candidate || !SUPPORTED_LANGUAGE_CODES.includes(candidate)) {
    return { language: anchor, switched: false, reason: 'no-candidate' };
  }
  if (candidate === anchor) {
    return { language: anchor, switched: false, reason: 'same-language' };
  }
  if (isLowEvidence) {
    return { language: anchor, switched: false, reason: 'low-evidence' };
  }
  if (typeof confidence === 'number' && confidence < LANGUAGE_SWITCH_CONFIDENCE_THRESHOLD) {
    return { language: anchor, switched: false, reason: 'low-confidence' };
  }
  return { language: candidate, switched: true, reason: 'switched' };
}

/** Normalises a model-reported confidence into a 0..1 number, accepting a
 *  numeric string ("0.9") as well as a real number. Anything unparseable is
 *  treated as absent rather than as zero — see resolveLanguageSwitch. */
export function parseConfidence(raw: unknown): number | undefined {
  const value = typeof raw === 'string' ? Number(raw) : raw;
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(1, Math.max(0, value));
}

// A short, best-effort vocabulary nudge for Whisper's `prompt` field — these
// are NOT verified translations, just enough in-language clinic-adjacent
// words to bias transcription away from mis-hearing symptom/medication terms
// as unrelated words. See FIX 10 in the language-switching rework.
const CLINIC_VOCAB_PROMPTS: Partial<Record<LanguageCode, string>> = {
  en: 'Clinic vocabulary: fever, malaria, headache, medication, appointment, allergy, pharmacy, symptoms.',
  yo: 'Ọ̀rọ̀ ilé-ìwòsàn: ibà, orí fífọ́, egbogi, ìpàdé, aleji.',
  ig: 'Okwu ụlọ ọgwụ: ahụ ọkụ, isi ọwụwa, ọgwụ, oge nkwenye, allergy.',
  ha: 'Kalmomin asibiti: zazzabi, ciwon kai, magani, alkawari, rashin lafiya.',
  pcm: 'Clinic wetin dem dey talk: fever, malaria, headache, medicine, appointment, allergy.',
};

/**
 * Identifies which language a patient is speaking and transcribes it. Used
 * for the very first spoken turn of a call, when there is no prior-turn
 * language to anchor on yet — every turn after that transcribes with a
 * language hint instead (see transcribeWithLanguageHint below) and folds
 * classification into the same call as the conversational reply (see
 * src/services/intake/converse.ts), rather than paying for this dedicated
 * classification call every turn.
 *
 * The OpenAI-compatible Whisper transcription endpoint has no system prompt
 * to steer with — it cannot be told "Nigerian Pidgin has this grammar" the
 * way a chat completion prompt can, and its own language guess is a bare
 * model-trained label prone to reading Pidgin as English for the same
 * reason described above. So this is two calls: Whisper transcribes the
 * audio to text, then that text is run through the same chat-based
 * classifier as detectLanguageFromText() below — which does carry the full
 * Pidgin disambiguation — rather than trusting Whisper's own language field.
 */
export async function detectLanguageAndTranscribe(audioBase64: string, mimeType: string): Promise<DetectLanguageResult> {
  const start = Date.now();
  if (!isOpenAIConfigured()) {
    return { success: false, notConfigured: true, error: 'No OpenAI API key is configured.', latencyMs: Date.now() - start };
  }

  try {
    const { transcript } = await withTimeout(openaiTranscribeAudio(audioBase64, mimeType), OPENAI_TRANSCRIBE_TIMEOUT_MS);
    const cleanTranscript = transcript.trim();

    if (!cleanTranscript) {
      return { success: false, error: 'The model returned an empty transcription.', latencyMs: Date.now() - start };
    }

    const classification = await detectLanguageFromText(cleanTranscript);
    if (!classification.success) {
      // The transcript itself is still good even if classification failed —
      // fall back to English rather than throwing away a real transcription.
      return {
        success: true,
        languageCode: 'en',
        transcript: cleanTranscript,
        latencyMs: Date.now() - start,
      };
    }

    return {
      success: true,
      languageCode: classification.languageCode ?? 'en',
      transcript: cleanTranscript,
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return {
      success: false,
      quotaExceeded: isQuotaExceededError(err),
      timedOut: isTimeoutError(err),
      error: err instanceof Error ? err.message : 'Language detection failed.',
      latencyMs: Date.now() - start,
    };
  }
}

// Filler words that carry no language signal on their own — a patient saying
// any of these has not given evidence of switching language, whatever a
// classifier claims. Deliberately short and cross-language: several are
// shared between English and Pidgin, which is exactly why they prove nothing.
const NO_SIGNAL_UTTERANCES = new Set([
  'ok', 'okay', 'yes', 'no', 'yeah', 'yep', 'nope', 'sure', 'hmm', 'mm', 'mhm',
  'thanks', 'thank you', 'please', 'hello', 'hi', 'hey', 'abeg', 'oya', 'eh',
]);

/**
 * True when `text` is too thin to justify switching a call's established
 * language. The prompt already *asks* the model not to flip on a bare "okay",
 * but a prompt is a request, not a guarantee — a smaller or cheaper model
 * ignores it often enough that a spoken call would ping-pong between
 * languages mid-conversation. This is the code-level guard behind that
 * request, so a spurious flip is impossible rather than merely discouraged.
 *
 * Only applied when a language is ALREADY established: the first real turn of
 * a call has no anchor to protect, so even a one-word greeting must be allowed
 * to set the language.
 */
export function isLowEvidenceForLanguageSwitch(text: string): boolean {
  const cleaned = text
    .trim()
    .toLowerCase()
    .replace(/[.!?,;:'"()]/g, '')
    .replace(/\s+/g, ' ');

  if (!cleaned) return true;
  if (NO_SIGNAL_UTTERANCES.has(cleaned)) return true;
  // Bare numbers (an age, a phone number, a house number) say nothing about
  // which language someone is speaking.
  if (/^[\d\s+-]+$/.test(cleaned)) return true;
  // A single short token is not enough to reclassify a whole conversation.
  const words = cleaned.split(' ').filter(Boolean);
  if (words.length === 1 && cleaned.length <= 6) return true;
  return false;
}

/**
 * Transcribes a spoken turn once the language is already known from an
 * earlier turn in the same call — passes it to Whisper as a hint (plus a
 * short clinic-vocabulary prompt nudge) instead of running the separate
 * classification call every turn. The conversational reply completion (see
 * getSabiLineReply in converse.ts) re-confirms the language itself from the
 * resulting transcript on this same turn, using `languageHint` as an anchor
 * it can override if the patient actually switched languages — so this
 * function's `languageCode` in its result is the hint echoed back, not a
 * fresh classification.
 */
export async function transcribeWithLanguageHint(
  audioBase64: string,
  mimeType: string,
  languageHint: LanguageCode
): Promise<DetectLanguageResult> {
  const start = Date.now();
  if (!isOpenAIConfigured()) {
    return { success: false, notConfigured: true, error: 'No OpenAI API key is configured.', latencyMs: Date.now() - start };
  }

  try {
    const { transcript } = await withTimeout(
      openaiTranscribeAudio(audioBase64, mimeType, { languageHint, prompt: CLINIC_VOCAB_PROMPTS[languageHint] }),
      OPENAI_TRANSCRIBE_TIMEOUT_MS
    );
    const cleanTranscript = transcript.trim();
    if (!cleanTranscript) {
      return { success: false, error: 'The model returned an empty transcription.', latencyMs: Date.now() - start };
    }
    return { success: true, languageCode: languageHint, transcript: cleanTranscript, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      success: false,
      quotaExceeded: isQuotaExceededError(err),
      timedOut: isTimeoutError(err),
      error: err instanceof Error ? err.message : 'Transcription failed.',
      latencyMs: Date.now() - start,
    };
  }
}

export interface DetectLanguageFromTextResult {
  success: boolean;
  languageCode?: LanguageCode;
  /** The model's own 0..1 certainty for `languageCode` on this utterance
   *  alone. Undefined when the model did not report one — treated as "not
   *  stated" rather than "zero". */
  confidence?: number;
  error?: string;
  quotaExceeded?: boolean;
  notConfigured?: boolean;
  timedOut?: boolean;
  latencyMs: number;
}

/**
 * Text-only counterpart to detectLanguageAndTranscribe, for a patient who
 * types their reply instead of speaking. Re-run on every typed turn (not
 * just the first) so a mid-call language switch is caught here too —
 * `previousLanguage`, when given, anchors the classifier against flipping on
 * a short, ambiguous reply ("okay", a bare number, a name) that isn't real
 * evidence of a switch.
 */
export async function detectLanguageFromText(text: string, previousLanguage?: LanguageCode): Promise<DetectLanguageFromTextResult> {
  const start = Date.now();
  if (!isOpenAIConfigured()) {
    return { success: false, notConfigured: true, error: 'No OpenAI API key is configured.', latencyMs: Date.now() - start };
  }

  const anchorNote = previousLanguage
    ? ` The patient's previous message was in ${LANGUAGE_NAMES[previousLanguage] ?? previousLanguage} — treat that as a hint, not a certainty: only report a different language if this new text gives clear evidence of a switch (a bare "okay", "yes", a name, or a number alone is not enough evidence).`
    : '';

  try {
    const content = await withTimeout(
      openaiChatCompletion(
        [
          {
            role: 'user',
            content: `A patient typed this at a health clinic intake desk: "${text.replace(/"/g, "'")}". Identify which language they most likely intended, choosing the closest match from: ${LANGUAGE_CHOICES_DESC}. ${LANGUAGE_DISAMBIGUATION}${anchorNote} ${CONFIDENCE_GUIDANCE} Return ONLY this JSON shape: {"languageCode": "en"|"pcm"|"yo"|"ig"|"ha"|"ful", "confidence": 0.0}`,
          },
        ],
        { jsonResponse: true }
      ),
      OPENAI_CHAT_TIMEOUT_MS
    );

    const parsed = JSON.parse(content || '{}');
    const languageCode = SUPPORTED_LANGUAGE_CODES.includes(parsed.languageCode) ? (parsed.languageCode as LanguageCode) : 'en';
    const confidence = parseConfidence(parsed.confidence);

    return { success: true, languageCode, confidence, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      success: false,
      quotaExceeded: isQuotaExceededError(err),
      timedOut: isTimeoutError(err),
      error: err instanceof Error ? err.message : 'Language detection failed.',
      latencyMs: Date.now() - start,
    };
  }
}
