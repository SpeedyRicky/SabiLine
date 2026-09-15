import { getGeminiClient, isQuotaExceededError } from '../tts/geminiClient';
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

export interface ConverseResult {
  success: boolean;
  spokenReply?: string;
  done?: boolean;
  fields?: IntakeFields;
  needsManualReview?: boolean;
  error?: string;
  quotaExceeded?: boolean;
}

// Gemini has no innate sense of elapsed time — each call sees only what's in
// this turn's request — so the real minute count is computed client-side
// (from when the call started) and handed in here, rather than guessed.
function buildSystemInstruction(language: LanguageCode, elapsedMinutes: number): string {
  const langName = LANGUAGE_NAMES[language] || language;
  const driftNote =
    elapsedMinutes >= 2
      ? ` This call has been going for about ${elapsedMinutes} minute${elapsedMinutes === 1 ? '' : 's'} so far. If the conversation has drifted away from health or clinic topics and stayed off-topic for somewhere in the range of 2 to 7 minutes of that drift, gently mention — once, not every message — that you're the SabiLine health line and are best able to help with health-related concerns, then offer to get back to their visit. Don't cut off brief small talk; only redirect once it's clearly gone on a while.`
      : '';

  return [
    'You are SabiLine, a warm, human-sounding intake receptionist at an African health clinic.',
    'Speak naturally like a real person: vary your wording, react to what the patient actually said, keep each reply short (1-2 sentences, occasionally 3) since it will be read aloud, and never repeat a question you already have an answer to.',
    `Respond in ${langName}, matching any code-switching the patient uses, without ever mentioning that you're doing this.`,
    "Through natural back-and-forth, not a rigid checklist and not necessarily in this order, find out: the patient's name, their age or date of birth, their payment or insurance type, their reason for visiting, how long their symptoms have lasted, and any known allergies. Ask about one thing at a time. If they don't know or decline to answer something, don't press repeatedly — move on and leave it blank.",
    "It's fine for the patient to chat about other things along the way — follow them naturally and don't refuse to engage." + driftNote,
    'Once you have gathered what you reasonably can, let them know their visit is logged and a staff member will follow up shortly, then say goodbye — set "done" to true only on that final message.',
    'Always reply with ONLY this JSON: {"spokenReply": string, "done": boolean, "fields": {"name": string|null, "ageOrDob": string|null, "paymentType": string|null, "reasonForVisit": string|null, "symptomDuration": string|null, "allergies": string|null}, "needsManualReview": boolean}.',
    '"fields" is your best current understanding so far, updated every turn — use null (never a guess) for anything the patient has not actually stated. Set "needsManualReview" to true only once "done" is true and important fields are still missing or unclear.',
  ].join(' ');
}

/**
 * One turn of the live intake conversation. Sends the whole conversation so
 * far (Gemini keeps no memory between calls) plus the patient's newest
 * utterance, and gets back a natural spoken reply alongside the model's
 * best-so-far structured understanding — never a fixed script, never a
 * fabricated field the patient didn't actually state.
 */
export async function getSabiLineReply(
  history: IntakeConversationTurn[],
  userText: string,
  language: LanguageCode,
  elapsedMinutes: number
): Promise<ConverseResult> {
  const ai = getGeminiClient();
  if (!ai) {
    return { success: false, error: 'GEMINI_API_KEY is required for the conversational intake.' };
  }

  try {
    const contents = history
      .map((turn) => ({ role: turn.role, parts: [{ text: turn.text }] }))
      .concat([{ role: 'user' as const, parts: [{ text: userText }] }]);

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents,
      config: {
        systemInstruction: buildSystemInstruction(language, elapsedMinutes),
        responseMimeType: 'application/json',
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    const spokenReply = String(parsed.spokenReply || '').trim();
    if (!spokenReply) {
      return { success: false, error: 'Gemini returned an empty reply.' };
    }

    return {
      success: true,
      spokenReply,
      done: Boolean(parsed.done),
      fields: parsed.fields,
      needsManualReview: Boolean(parsed.needsManualReview),
    };
  } catch (err) {
    return {
      success: false,
      quotaExceeded: isQuotaExceededError(err),
      error: err instanceof Error ? err.message : 'Conversation turn failed.',
    };
  }
}
