import type { LanguageCode } from '../../types';

// The structured record a front-desk clerk needs from a spoken patient
// intake. Every field is nullable — a field the patient never mentioned (or
// that the model genuinely couldn't extract) is left null, never guessed or
// zero-filled, matching this app's anti-fabrication design throughout.
export interface IntakeFields {
  name: string | null;
  ageOrDob: string | null;
  paymentType: string | null;
  reasonForVisit: string | null;
  symptomDuration: string | null;
  allergies: string | null;
}

export const INTAKE_FIELD_LABELS: Record<keyof IntakeFields, string> = {
  name: 'Name',
  ageOrDob: 'Age / Date of birth',
  paymentType: 'Payment / insurance type',
  reasonForVisit: 'Reason for visit',
  symptomDuration: 'Symptom duration',
  allergies: 'Known allergies',
};

export interface IntakeExtractionResponse {
  success: boolean;
  fields?: IntakeFields;
  confidencePerField?: Record<keyof IntakeFields, number>;
  overallConfidence?: number;
  missingOrUnclearFields?: (keyof IntakeFields)[];
  followUpQuestion?: string | null;
  error?: string;
}

// Below this, the flow asks one spoken follow-up question before proceeding.
export const INTAKE_CONFIDENCE_THRESHOLD = 0.7;

export interface IntakeTranscriptAttempt {
  success: boolean;
  transcript?: string;
  error?: string;
  notConfigured?: boolean;
  latencyMs: number;
}

export interface IntakeTranscribeResponse {
  success: boolean;
  primaryProviderId: string | null;
  primaryTranscript: string | null;
  attempts: Record<string, IntakeTranscriptAttempt>;
  gainNormalizationApplied?: boolean;
  // Present when the request asked for language: 'auto' — the language
  // Gemini identified the patient as speaking, null if detection failed.
  detectedLanguage?: LanguageCode | null;
  error?: string;
}

export interface IntakeRecord {
  id: string;
  referenceNumber: string;
  createdAt: string;
  language: LanguageCode;
  transcriptTurns: string[];
  fields: IntakeFields;
  overallConfidence: number;
  followUpUsed: boolean;
  needsManualReview: boolean;
  primaryAsrProviderId: string | null;
  status: 'queued_for_review';
}
