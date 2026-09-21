import type { LanguageCode } from '../../types';

// The structured record a front-desk clerk needs from a spoken patient
// intake. Every field is nullable — a field the patient never mentioned (or
// that the model genuinely couldn't extract) is left null, never guessed or
// zero-filled, matching this app's anti-fabrication design throughout.
export interface IntakeFields {
  name: string | null;
  ageOrDob: string | null;
  phoneNumber: string | null;
  paymentType: string | null;
  reasonForVisit: string | null;
  symptomDuration: string | null;
  allergies: string | null;
}

export const INTAKE_FIELD_LABELS: Record<keyof IntakeFields, string> = {
  name: 'Name',
  ageOrDob: 'Age / Date of birth',
  phoneNumber: 'Phone number',
  paymentType: 'Payment / insurance type',
  reasonForVisit: 'Reason for visit',
  symptomDuration: 'Symptom duration',
  allergies: 'Known allergies',
};

export interface IntakeTranscriptAttempt {
  success: boolean;
  transcript?: string;
  error?: string;
  notConfigured?: boolean;
  latencyMs: number;
}

// One turn of the ongoing conversation with the patient ('model' for
// SabiLine's own replies). converse.ts maps this to whichever role naming
// the configured chat API actually expects (OpenAI's chat completions API
// uses 'assistant', not 'model') at the call boundary — this type is this
// app's own internal representation, not any one provider's wire format.
export interface IntakeConversationTurn {
  role: 'user' | 'model';
  text: string;
}

// Response from /api/intake/converse — one real audio turn in, a live
// conversational reply out. Every field below reflects something that
// actually happened this turn: a real transcript, a real model reply, and
// (once "done") the model's best current understanding of the intake
// record, honestly incomplete wherever the patient never said something.
export interface IntakeConverseResponse {
  success: boolean;
  /** Server-generated id for this call, returned on the opening turn and
   *  echoed back by the client on every subsequent turn. */
  visitId?: string;
  detectedLanguage?: LanguageCode | null;
  transcript?: string | null;
  primaryProviderId?: string | null;
  attempts?: Record<string, IntakeTranscriptAttempt>;
  gainNormalizationApplied?: boolean;
  spokenReply?: string;
  done?: boolean;
  fields?: IntakeFields;
  department?: string | null;
  appointmentSlot?: string | null;
  appointmentSlotIso?: string | null;
  needsManualReview?: boolean;
  /** Set on the opening turn when SabiLine has no idea which language the
   *  caller speaks yet. It deliberately does NOT greet in English in that
   *  case — the client should start listening instead, and the first spoken
   *  sentence ends up in whatever language is actually heard. */
  listenFirst?: boolean;
  error?: string;
  quotaExceeded?: boolean;
  notConfigured?: boolean;
  timedOut?: boolean;
}

export interface IntakeRecord {
  id: string;
  referenceNumber: string;
  createdAt: string;
  language: LanguageCode;
  /** Distinct languages used across the call, in order, if the patient
   *  switched at any point — e.g. ['en', 'yo']. A single entry means the
   *  language never changed. */
  languageHistory: LanguageCode[];
  conversation: IntakeConversationTurn[];
  fields: IntakeFields;
  department: string | null;
  appointmentSlot: string | null;
  appointmentSlotIso: string | null;
  needsManualReview: boolean;
  primaryAsrProviderId: string | null;
  status: 'queued_for_review';
}
