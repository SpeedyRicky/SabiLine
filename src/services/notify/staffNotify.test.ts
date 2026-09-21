import { describe, it, expect } from 'vitest';
import { buildEnglishVisitSummary } from './staffNotify';
import type { IntakeFields } from '../intake/types';

const FIELDS: IntakeFields = {
  name: 'Amina',
  ageOrDob: '34',
  phoneNumber: '08012345678',
  paymentType: 'Cash',
  reasonForVisit: 'Fever',
  symptomDuration: '2 days',
  allergies: null,
};

describe('buildEnglishVisitSummary', () => {
  it('always writes the structured fields in English, regardless of conversation language', () => {
    const summary = buildEnglishVisitSummary({
      referenceNumber: 'INTAKE-1',
      language: 'yo',
      fields: FIELDS,
      department: 'Malaria & Fever Care',
      appointmentSlot: 'Mon Sep 15, 10:30am',
      needsManualReview: false,
    });

    expect(summary).toMatch(/Reason for visit: Fever/);
    expect(summary).toMatch(/Conversation language: Yoruba/);
  });

  it('omits the language-change line when the language never changed', () => {
    const summary = buildEnglishVisitSummary({
      referenceNumber: 'INTAKE-2',
      language: 'en',
      languageHistory: ['en'],
      fields: FIELDS,
      department: null,
      appointmentSlot: null,
      needsManualReview: false,
    });

    expect(summary).not.toMatch(/Language changed during call/);
  });

  it('reports a language switch mid-call as explicit metadata', () => {
    const summary = buildEnglishVisitSummary({
      referenceNumber: 'INTAKE-3',
      language: 'yo',
      languageHistory: ['en', 'yo'],
      fields: FIELDS,
      department: null,
      appointmentSlot: null,
      needsManualReview: false,
    });

    expect(summary).toMatch(/Language changed during call: English → Yoruba/);
  });
});
