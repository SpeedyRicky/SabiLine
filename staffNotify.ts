// Server-only. Sends the person-in-charge (clinic staff) an English-language
// summary of a completed patient intake, regardless of what language the
// intake conversation itself was conducted in — the patient hears and speaks
// their own language throughout, but the record staff read is always English.
//
// Delivery is a generic incoming webhook (Slack, Microsoft Teams, Discord,
// or any automation tool like Make/Zapier all accept this same
// `{ text: string }` / `content` shape) rather than assuming a specific
// vendor — set STAFF_NOTIFY_WEBHOOK_URL to wherever staff actually want
// visit alerts to land. Follows the same honest "not configured" pattern as
// every other optional provider in this app: nothing is faked as sent.
import type { IntakeFields } from '../intake/types';
import type { LanguageCode } from '../../types';

export interface StaffNotifyResult {
  success: boolean;
  notConfigured?: boolean;
  error?: string;
}

export function isStaffNotifyConfigured(): boolean {
  return Boolean(process.env.STAFF_NOTIFY_WEBHOOK_URL?.trim());
}

const LANGUAGE_NAMES: Partial<Record<LanguageCode, string>> = {
  en: 'English',
  pcm: 'Nigerian Pidgin',
  yo: 'Yoruba',
  ig: 'Igbo',
  ha: 'Hausa',
  ful: 'Fulfulde',
};

export function buildEnglishVisitSummary(params: {
  referenceNumber: string;
  language: LanguageCode;
  /** Distinct languages used across the call, in order, if the patient
   *  switched at any point — e.g. ['en', 'yo']. Omitted or a single entry
   *  means the language never changed. */
  languageHistory?: LanguageCode[];
  fields: IntakeFields;
  department: string | null;
  appointmentSlot: string | null;
  needsManualReview: boolean;
}): string {
  const { referenceNumber, language, languageHistory, fields, department, appointmentSlot, needsManualReview } = params;
  const langName = LANGUAGE_NAMES[language] || language;
  const lines = [
    `New SabiLine patient intake — ${referenceNumber}`,
    `Conversation language: ${langName} (recorded here in English)`,
    `Name: ${fields.name || 'not provided'}`,
    `Age / DOB: ${fields.ageOrDob || 'not provided'}`,
    `Phone number: ${fields.phoneNumber || 'not provided'}`,
    `Payment / insurance: ${fields.paymentType || 'not provided'}`,
    `Reason for visit: ${fields.reasonForVisit || 'not provided'}`,
    `Symptom duration: ${fields.symptomDuration || 'not provided'}`,
    `Allergies: ${fields.allergies || 'not provided'}`,
    `Department: ${department || 'not yet assigned'}`,
    `Proposed appointment: ${appointmentSlot || 'not yet scheduled'}`,
  ];
  if (languageHistory && languageHistory.length > 1) {
    lines.push(`Language changed during call: ${languageHistory.map((l) => LANGUAGE_NAMES[l] || l).join(' → ')}`);
  }
  if (needsManualReview) {
    lines.push('⚠️ Flagged for manual review — one or more fields are missing or unclear.');
  }
  return lines.join('\n');
}

/**
 * Posts the English visit summary to the configured staff webhook. Sends
 * both `text` (Slack/Teams-compatible) and `content` (Discord-compatible)
 * keys so the same payload works against the most common webhook receivers
 * without per-vendor configuration.
 */
export async function notifyStaffOfVisit(summary: string): Promise<StaffNotifyResult> {
  const url = process.env.STAFF_NOTIFY_WEBHOOK_URL?.trim();
  if (!url) {
    return { success: false, notConfigured: true, error: 'STAFF_NOTIFY_WEBHOOK_URL is not configured.' };
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: summary, content: summary }),
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Staff notification webhook returned status ${response.status}. ${errText}`.trim());
    }
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Sending the staff notification failed.',
    };
  }
}
