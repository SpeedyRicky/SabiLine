// Server-only. Records an English-language summary of every completed
// patient intake for the person in charge (clinic staff), regardless of what
// language the intake conversation itself was conducted in — the patient
// hears and speaks their own language throughout, but the record staff read
// is always English.
//
// No external service or environment variable is required: summaries are
// appended to a local JSON visit log (data/staff-visit-log.json), echoed to
// the server log, and exposed read-only at GET /api/intake/visits so staff
// can review them from any browser. On a read-only/serverless filesystem the
// file write is skipped silently and the server log still carries the record.
import fs from 'node:fs';
import path from 'node:path';
import type { IntakeFields } from '../intake/types';
import type { LanguageCode } from '../../types';

const DATA_DIR = path.join(process.cwd(), 'data');
const LOG_FILE = path.join(DATA_DIR, 'staff-visit-log.json');
const MAX_ENTRIES = 500;

export interface StaffVisitEntry {
  visitId: string;
  recordedAt: string;
  language: LanguageCode;
  fields: IntakeFields;
  department: string | null;
  appointmentSlot: string | null;
  appointmentSlotIso: string | null;
  needsManualReview: boolean;
  summary: string;
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
  fields: IntakeFields;
  department: string | null;
  appointmentSlot: string | null;
  needsManualReview: boolean;
}): string {
  const { referenceNumber, language, fields, department, appointmentSlot, needsManualReview } = params;
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
  if (needsManualReview) {
    lines.push('⚠️ Flagged for manual review — one or more fields are missing or unclear.');
  }
  return lines.join('\n');
}

function loadLog(): StaffVisitEntry[] {
  try {
    if (!fs.existsSync(LOG_FILE)) return [];
    const parsed = JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Records a completed intake for staff. Never throws — a failed disk write
 * (read-only filesystem) must never break the patient-facing response.
 */
export function recordVisitForStaff(entry: Omit<StaffVisitEntry, 'recordedAt'>): void {
  const full: StaffVisitEntry = { ...entry, recordedAt: new Date().toISOString() };
  console.log(`[SabiLine staff record]\n${full.summary}`);
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const log = loadLog().filter((e) => e.visitId !== full.visitId);
    log.unshift(full);
    fs.writeFileSync(LOG_FILE, JSON.stringify(log.slice(0, MAX_ENTRIES), null, 2));
  } catch {
    // Best-effort persistence only.
  }
}

/** Newest first. */
export function listStaffVisits(): StaffVisitEntry[] {
  return loadLog();
}
