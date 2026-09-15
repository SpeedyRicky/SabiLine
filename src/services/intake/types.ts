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

// One turn of the ongoing conversation with the patient, in the shape
// Gemini's multi-turn chat expects (role 'model' for SabiLine's own replies,
// mirroring the Gemini API's own turn-role naming).
export interface IntakeConversationTurn {
  role: 'user' | 'model';
  text: string;
}

// Response from /api/intake/converse — one real audio turn in, a live
// conversational reply out. Every field below reflects something that
// actually happened this turn: a real transcript, a real Gemini reply, and
// (once "done") the model's best current understanding of the intake
// record, honestly incomplete wherever the patient never said something.
export interface IntakeConverseResponse {
  success: boolean;
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
  conversation: IntakeConversationTurn[];
  fields: IntakeFields;
  department: string | null;
  appointmentSlot: string | null;
  appointmentSlotIso: string | null;
  needsManualReview: boolean;
  primaryAsrProviderId: string | null;
  status: 'queued_for_review';
}
