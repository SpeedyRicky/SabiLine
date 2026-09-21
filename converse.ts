import {
  isOpenAIConfigured,
  openaiChatCompletion,
  isQuotaExceededError,
  isTimeoutError,
  withTimeout,
  OPENAI_CHAT_TIMEOUT_MS,
} from '../tts/openaiClient';
import { LANGUAGE_DISAMBIGUATION, CONFIDENCE_GUIDANCE, parseConfidence, SUPPORTED_LANGUAGE_CODES } from '../asr/detectLanguage';
import type { LanguageCode } from '../../types';
import type { IntakeFields, IntakeConversationTurn } from './types';

const LANGUAGE_NAMES: Partial<Record<LanguageCode, string>> = {
  en: 'English',
  pcm: 'Nigerian Pidgin',
  yo: 'Yoruba',
  ig: 'Igbo',
  ha: 'Hausa',
  ful: 'Fulfulde',
};

// Sample clinic departments and near-future slots — the same lightweight,
// clearly-labeled-as-sample scheduling data the demo used, now driving the
// real conversation. The model picks from these on the same turn it finishes
// the intake, rather than a separate (and separately billed) call.
const DEPARTMENTS = [
  'Malaria & Fever Care',
  'Maternal Health',
  'Child & Vaccination Clinic',
  'Cardiology',
  'Pharmacy Refill',
  'General Triage',
];

interface SlotOption {
  label: string;
  iso: string;
}

/**
 * The rule that keeps the clinical record faithful to what the patient
 * actually said.
 *
 * Motivated by a real failure: a Yoruba caller said "Mo ni iba ati orififo"
 * — fever AND headache — and the record came back as reasonForVisit
 * "Fever and cough". A translated field that invents a symptom the patient
 * never mentioned is not a cosmetic translation slip; it is wrong clinical
 * information in front of a clinician. Two symptoms became one, and the one
 * that survived was the wrong one.
 *
 * The "keep the original word" escape hatch matters as much as the rest:
 * an untranslated word a clinician can look up is strictly safer than a
 * confident substitution, because it is visibly unresolved rather than
 * quietly wrong.
 */
export const SYMPTOM_PRESERVATION =
  'SYMPTOM FIDELITY (critical): "reasonForVisit" and "allergies" must preserve EVERY distinct symptom or allergy the patient has named anywhere in this conversation, translated into plain English. If they named two, the field contains both, joined with "and" or a comma — never just one. Never drop a symptom, never merge two different symptoms into one, and above all never substitute a different symptom for the one they actually named. Yoruba "orififo" (orí fífọ́) and Yoruba "ori mi n dun mi" both mean HEADACHE — recording either of them as "cough" is a clinical error, not a rounding error. If you are not confident what an unfamiliar word means, keep it verbatim alongside your best English translation, for example "orififo (headache)" or "unclear term: <word>" — an untranslated word a clinician can look up is far safer than a confident wrong one. When the patient names a new symptom on a later turn, ADD it to the existing list rather than replacing what is already recorded.';

/**
 * Common Nigerian clinic terms, offered explicitly so a cheap model has
 * something concrete to translate against instead of pattern-matching on
 * word shape. Framed as an aid, not an authority: the instruction to weigh
 * what the patient actually said takes precedence, and Fulfulde is left
 * uncovered rather than guessed at.
 */
export const SYMPTOM_GLOSSARY =
  'Common Nigerian clinic terms, as a translating aid only — not a complete dictionary, and never a reason to override what the patient actually said: ' +
  'Yoruba: iba = fever/malaria; orififo (orí fífọ́) = headache; ikọ́ = cough; inú ríro = stomach ache; èébì = vomiting; àárẹ̀ = weakness; òórùn = pain; ọgbẹ́ = sore/wound; ìgbẹ́ gbuuru = diarrhoea. ' +
  'Igbo: ahụ ọkụ = fever; isi ọwụwa / isi na-egbu m = headache; ụkwara = cough; afọ mgbu = stomach pain; ọgbụgbọ = vomiting; ike ọgwụgwụ = weakness; mgbu = pain; ọnyá = wound; afọ ọsịsa = diarrhoea. ' +
  'Hausa: zazzabi = fever; ciwon kai = headache; tari = cough; ciwon ciki = stomach pain; amai = vomiting; gajiya = fatigue; ciwo = pain; rauni = wound; gudawa = diarrhoea. ' +
  'Nigerian Pidgin: body dey hot / fever = fever; head dey pain = headache; cough = cough; belle dey pain = stomach pain; vomit / throw up = vomiting; body dey weak = weakness; sore / wound = wound; running belle = diarrhoea. ' +
  'Fulfulde is not covered above — translate it carefully and keep the original word if unsure.';

// Each slot carries both a human-readable label (what the model proposes and
// speaks aloud) and a real ISO timestamp — the label alone (e.g. "Mon Jan 5,
// 10:30am") has no year and can't be parsed reliably, but the automated
// Twilio reminder calls (2 days / 2 hours before the appointment) need an
// exact, unambiguous instant to schedule against.
function nextSlots(): SlotOption[] {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return [1, 2, 3].map((offsetDays) => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    const hour = offsetDays % 2 === 0 ? 10 : 14;
    const minute = offsetDays % 2 === 0 ? 30 : 15;
    d.setHours(hour, minute, 0, 0);
    const label = `${days[d.getDay()]} ${months[d.getMonth()]} ${d.getDate()}, ${offsetDays % 2 === 0 ? '10:30am' : '2:15pm'}`;
    return { label, iso: d.toISOString() };
  });
}

function findSlotIso(slotLabel: string | null | undefined, slots: SlotOption[]): string | null {
  if (!slotLabel) return null;
  const match = slots.find((s) => s.label === slotLabel);
  return match ? match.iso : null;
}

export interface ConverseResult {
  success: boolean;
  spokenReply?: string;
  /** The language this turn's spokenReply was actually written in — the
   *  model's own fresh determination for this turn, anchored on (but not
   *  locked to) whatever language was passed in. Callers should treat this
   *  as the new "current language" going into the next turn. */
  languageCode?: LanguageCode;
  done?: boolean;
  fields?: IntakeFields;
  department?: string | null;
  appointmentSlot?: string | null;
  appointmentSlotIso?: string | null;
  needsManualReview?: boolean;
  /** The model's own 0..1 certainty in `languageCode` for this turn alone.
   *  Undefined when it did not report one. */
  confidence?: number;
  error?: string;
  quotaExceeded?: boolean;
  notConfigured?: boolean;
  timedOut?: boolean;
}

// The model has no innate sense of elapsed time — each call sees only what's in
// this turn's request — so the real minute count is computed client-side
// (from when the call started) and handed in here, rather than guessed.
function buildSystemInstructionWithSlots(
  languageAnchor: LanguageCode,
  elapsedMinutes: number,
  isOpeningCall: boolean,
  slots: SlotOption[]
): string {
  const anchorName = LANGUAGE_NAMES[languageAnchor] || languageAnchor;
  const driftNote =
    elapsedMinutes >= 2
      ? ` This call has been going for about ${elapsedMinutes} minute${elapsedMinutes === 1 ? '' : 's'} so far. If the conversation has drifted away from health or clinic topics and stayed off-topic for somewhere in the range of 2 to 7 minutes of that drift, gently mention — once, not every message — that you're the SabiLine health line and are best able to help with health-related concerns, then offer to get back to their visit. Don't cut off brief small talk; only redirect once it's clearly gone on a while.`
      : '';
  const openingNote = isOpeningCall
    ? ` The call has just connected and the patient hasn't said anything yet — don't wait for them: open with a brief, warm greeting that introduces yourself as SabiLine and invites them to share why they're calling, written entirely in ${anchorName}.`
    : '';

  // The opening greeting is written in the language the caller is ALREADY
  // known to speak — never assumed to be English. When SabiLine has no idea
  // which language the caller speaks it does not greet at all: it listens
  // first and answers in whatever it actually hears (see the `listenFirst`
  // branch in server.ts). Hearing English as the very first thing said, to
  // someone who does not speak it, is the worst possible way to open a call.
  //
  // Every turn after that, this rule asks the model to determine the CURRENT
  // language fresh from what the patient just said, using the previous turn's
  // language as an anchor/hint rather than a fixed rule for the whole call —
  // a patient who switches languages mid-call (e.g. starts in English, then
  // continues in Yoruba) must be followed, not held to whatever language they
  // opened with. Folding this into the same call as the reply (rather than a
  // separate classification call every turn) is a deliberate latency
  // optimization — see FIX 4/5 in the language-switching rework.
  const languageDirective = isOpeningCall
    ? `Write "spokenReply" in ${anchorName} and set "languageCode" to "${languageAnchor}" — the caller's language is already known, so there is nothing to detect on this turn.${
        languageAnchor === 'en'
          ? ''
          : ` The greeting must be entirely in ${anchorName}: not one word of English anywhere in it.`
      }`
    : `LANGUAGE (most important rule): figure out which language the patient is CURRENTLY speaking, from this set: English (en), Nigerian Pidgin (pcm), Yoruba (yo), Igbo (ig), Hausa (ha), or Fulfulde (ful). ${LANGUAGE_DISAMBIGUATION} Your best guess going into this turn was ${anchorName} — treat that as a starting hint, not a certainty: a patient can and does switch languages mid-call. Stay with ${anchorName} unless this turn's words give clear evidence of a different language; a short reply like "okay", "yes", a bare number, or a name alone is NOT enough evidence to switch. Set "languageCode" to whichever language you conclude for THIS turn, then write every word of "spokenReply" in that same language. If the patient mixes languages, mirror that mixing, but keep "languageCode" and the base of "spokenReply" as the dominant one. Never mention, explain, or apologise for which language you are using, and never say the same thing twice in two languages. ${CONFIDENCE_GUIDANCE} Set "confidence" to your certainty in "languageCode" for THIS turn alone. This rule governs "spokenReply", "languageCode" and "confidence" only — every other JSON field stays in English, as set out below.`;

  return [
    'You are SabiLine, a warm, human-sounding intake receptionist at an African health clinic.',
    'Speak naturally like a real person: vary your wording, react to what the patient actually said, keep each reply short (1-2 sentences, occasionally 3) since it will be read aloud, and never repeat a question you already have an answer to.' + openingNote,
    languageDirective,
    "Through natural back-and-forth, not a rigid checklist and not necessarily in this order, find out: the patient's name, their age or date of birth, a phone number to reach them on (explain it's so the clinic can call to remind them of their appointment), their payment or insurance type, their reason for visiting, how long their symptoms have lasted, and any known allergies. Ask about one thing at a time. If they don't know or decline to answer something, don't press repeatedly — move on and leave it blank.",
    "It's fine for the patient to chat about other things along the way — follow them naturally and don't refuse to engage." + driftNote,
    `Once you have gathered what you reasonably can, pick the single best-fitting department for their reason for visit from this list: ${DEPARTMENTS.join(', ')} — then propose exactly one appointment time from these options: ${slots.map((s) => s.label).join(', ')} (say it to the patient in their current language, but the "appointmentSlot" JSON field must be copied verbatim from that English list). If they want a different time, offer another option from that same list. Once they confirm a time, let them know their visit is logged and a staff member will follow up shortly, then say goodbye — set "done" to true only on that final message.`,
    'Always reply with ONLY this JSON: {"spokenReply": string, "languageCode": "en"|"pcm"|"yo"|"ig"|"ha"|"ful", "confidence": number, "done": boolean, "fields": {"name": string|null, "ageOrDob": string|null, "phoneNumber": string|null, "paymentType": string|null, "reasonForVisit": string|null, "symptomDuration": string|null, "allergies": string|null}, "department": string|null, "appointmentSlot": string|null, "needsManualReview": boolean}.',
    'CRITICAL: "spokenReply" is the only field spoken/shown to the patient and, together with "languageCode", is the only part of the response allowed to reflect the patient\'s language. Every other field in the JSON — "fields" (name, ageOrDob, phoneNumber, paymentType, reasonForVisit, symptomDuration, allergies), "department", and "appointmentSlot" — MUST always be written in English regardless of what language the patient spoke, because clinic staff who read the record only read English. Translate the patient\'s answers into plain English for these fields (e.g. a Yoruba reason for visit like "Mo ni iba" must be recorded as "Fever"); never leave them in the original language.',
    SYMPTOM_PRESERVATION,
    SYMPTOM_GLOSSARY,
    '"fields" is your best current understanding so far, updated every turn — use null (never a guess) for anything the patient has not actually stated. "department" and "appointmentSlot" stay null until a time is actually confirmed, and "appointmentSlot" must exactly match one of the English options given above. Set "needsManualReview" to true only once "done" is true and important fields are still missing or unclear.',
  ].join(' ');
}

/**
 * One turn of the live intake conversation. Sends the whole conversation so
 * far (the model keeps no memory between calls) plus the patient's newest
 * utterance, and gets back a natural spoken reply alongside the model's
 * best-so-far structured understanding — never a fixed script, never a
 * fabricated field the patient didn't actually state.
 *
 * `userText` is null for the very first call of a session, before the
 * patient has said anything — SabiLine opens with a greeting instead of
 * waiting to be spoken to first, same as a real receptionist answering a
 * call. The chat completion still needs at least one user message to
 * respond to, so that case sends a synthetic system-facing note instead of
 * a null/empty turn — never stored in the visible conversation history,
 * since the patient never actually said it.
 *
 * `languageAnchor` is the best guess for the patient's language going into
 * this turn (from the previous turn's own `languageCode`, or a dedicated
 * classifier's result on the very first turn) — not a fixed choice for the
 * whole call. The model re-evaluates it fresh every turn and returns its
 * conclusion as `languageCode` on the result; callers should feed that back
 * in as the anchor for the next turn.
 */
export async function getSabiLineReply(
  history: IntakeConversationTurn[],
  userText: string | null,
  languageAnchor: LanguageCode,
  elapsedMinutes: number
): Promise<ConverseResult> {
  if (!isOpenAIConfigured()) {
    return { success: false, notConfigured: true, error: 'OPEN_AI_KEY is required for the conversational intake.' };
  }

  const isOpeningCall = userText === null;
  const slotsForThisTurn = nextSlots();

  try {
    const newTurnText = isOpeningCall ? '[The call has just connected.]' : userText;
    const messages = [
      { role: 'system' as const, content: buildSystemInstructionWithSlots(languageAnchor, elapsedMinutes, isOpeningCall, slotsForThisTurn) },
      ...history.map((turn) => ({ role: turn.role === 'model' ? ('assistant' as const) : ('user' as const), content: turn.text })),
      { role: 'user' as const, content: newTurnText },
    ];

    const content = await withTimeout(
      openaiChatCompletion(messages, { jsonResponse: true }),
      OPENAI_CHAT_TIMEOUT_MS
    );

    let parsed: any;
    try {
      parsed = JSON.parse(content || '{}');
    } catch {
      return {
        success: false,
        needsManualReview: true,
        error: 'The model returned a response that could not be understood. Please try again.',
      };
    }

    const spokenReply = String(parsed.spokenReply || '').trim();
    if (!spokenReply) {
      return { success: false, error: 'The model returned an empty reply.' };
    }

    const languageCode = SUPPORTED_LANGUAGE_CODES.includes(parsed.languageCode) ? (parsed.languageCode as LanguageCode) : languageAnchor;
    const confidence = parseConfidence(parsed.confidence);

    return {
      success: true,
      spokenReply,
      languageCode,
      confidence,
      done: Boolean(parsed.done),
      fields: parsed.fields,
      department: parsed.department ?? null,
      appointmentSlot: parsed.appointmentSlot ?? null,
      appointmentSlotIso: findSlotIso(parsed.appointmentSlot, slotsForThisTurn),
      needsManualReview: Boolean(parsed.needsManualReview),
    };
  } catch (err) {
    return {
      success: false,
      quotaExceeded: isQuotaExceededError(err),
      timedOut: isTimeoutError(err),
      error: err instanceof Error ? err.message : 'Conversation turn failed.',
    };
  }
}
