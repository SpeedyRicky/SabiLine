import React from 'react';
import { HeartHandshake, Baby, AlertTriangle, Pill, Globe, CheckCircle2 } from 'lucide-react';

export const ImpactView: React.FC = () => {
  return (
    <div className="space-y-6 py-2 max-w-4xl mx-auto text-slate-800">
      <div>
        <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700 text-[11px] font-medium mb-1">
          <HeartHandshake className="w-3.5 h-3.5 text-slate-600" />
          <span>Healthcare Applications</span>
        </div>
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">
          Linguistic Inclusion in Healthcare Delivery
        </h2>
        <p className="text-xs text-slate-600">
          Enabling accessible communication for regional language speakers in clinical and public health settings.
        </p>
      </div>

      {/* The Core Challenge */}
      <section className="p-4 bg-white border border-slate-200 rounded-lg shadow-xs space-y-2">
        <h3 className="text-sm font-bold text-slate-900">Communication Gaps in Healthcare</h3>
        <p className="text-xs text-slate-600 leading-relaxed">
          Standard voice systems often underperform on non-standard accents or regional languages. In healthcare consultations, transcription errors or miscommunication can lead to medication errors or delayed emergency care.
        </p>
      </section>

      {/* Real-World Clinical Interventions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Maternal Health */}
        <div className="p-4 rounded-lg bg-white border border-slate-200 space-y-2 shadow-xs">
          <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center">
            <Baby className="w-4 h-4" />
          </div>
          <h4 className="text-xs font-bold text-slate-900">Maternal Health Guidance</h4>
          <p className="text-xs text-slate-600 leading-relaxed">
            Spoken guidance in Hausa, Yoruba, and Igbo delivers clear antenatal recommendations, nutrition advice, and warning sign awareness to expectant mothers.
          </p>
        </div>

        {/* Malaria & Pediatric Triage */}
        <div className="p-4 rounded-lg bg-white border border-slate-200 space-y-2 shadow-xs">
          <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center">
            <AlertTriangle className="w-4 h-4" />
          </div>
          <h4 className="text-xs font-bold text-slate-900">Pediatric Triage Assistance</h4>
          <p className="text-xs text-slate-600 leading-relaxed">
            Early identification of neonatal fever and breathing distress helps caregivers assess symptoms quickly and seek medical assistance when required.
          </p>
        </div>

        {/* Pharmacy & Medication Instructions */}
        <div className="p-4 rounded-lg bg-white border border-slate-200 space-y-2 shadow-xs">
          <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center">
            <Pill className="w-4 h-4" />
          </div>
          <h4 className="text-xs font-bold text-slate-900">Prescription Adherence</h4>
          <p className="text-xs text-slate-600 leading-relaxed">
            Misunderstanding dosage leads to incomplete antibiotic courses. Spoken instructions in a patient's preferred language improve compliance.
          </p>
        </div>
      </div>

      {/* Sustainable Linguistic Inclusion */}
      <section className="p-4 bg-white border border-slate-200 rounded-lg shadow-xs space-y-3">
        <div className="flex items-center gap-1.5 text-slate-700 text-xs font-semibold">
          <Globe className="w-3.5 h-3.5 text-slate-600" />
          <span>Linguistic Representation</span>
        </div>
        <h3 className="text-sm font-bold text-slate-900">Accessible Spoken Communication</h3>
        <p className="text-xs text-slate-600 leading-relaxed">
          Supporting regional phonetics, tonal contours, and code-switching ensures healthcare technology remains practical and trustworthy for community health workers and patients alike.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 text-xs text-slate-700">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
            <span>Coverage across Hausa, Igbo, and Yoruba speech</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
            <span>Preservation of tonal inflections and regional vocabulary</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
            <span>Audio playback for non-literate community members</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
            <span>Objective evaluation metrics for model assessment</span>
          </div>
        </div>
      </section>
    </div>
  );
};
