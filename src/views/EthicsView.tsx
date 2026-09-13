import React from 'react';
import { ShieldCheck, Lock, Eye, AlertOctagon, Heart, CheckCircle2 } from 'lucide-react';

export const EthicsView: React.FC = () => {
  return (
    <div className="space-y-6 py-2 max-w-4xl mx-auto text-slate-800">
      <div>
        <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700 text-[11px] font-medium mb-1">
          <ShieldCheck className="w-3.5 h-3.5 text-slate-600" />
          <span>Ethics & Privacy</span>
        </div>
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">
          Ethics, Privacy & Data Standards
        </h2>
        <p className="text-xs text-slate-600">
          Responsible evaluation standards, data privacy, and clinical communication guidelines.
        </p>
      </div>

      {/* Mandatory Clinical Disclaimer */}
      <section className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 space-y-1.5">
        <div className="flex items-center gap-1.5 font-bold text-xs text-amber-900">
          <AlertOctagon className="w-4 h-4 shrink-0 text-amber-700" />
          <span>Clinical Disclaimer</span>
        </div>
        <p className="text-xs leading-relaxed text-amber-800">
          AfriVoice Studio is designed for speech intelligence, translation assessment, and educational research. It does <strong>not</strong> provide automated medical diagnoses or substitute for consultation with licensed healthcare professionals.
        </p>
      </section>

      {/* 4 Pillars of Ethical Governance */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* 1. Informed Consent */}
        <div className="p-4 rounded-lg bg-white border border-slate-200 space-y-1.5 shadow-xs">
          <div className="flex items-center gap-1.5 text-slate-900 text-xs font-semibold">
            <Heart className="w-3.5 h-3.5 text-slate-600" />
            <span>1. Consented Community Data</span>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Speech samples and evaluation benchmarks adhere to informed consent protocols with local language speakers and clinical contributors.
          </p>
        </div>

        {/* 2. De-Identification & Privacy */}
        <div className="p-4 rounded-lg bg-white border border-slate-200 space-y-1.5 shadow-xs">
          <div className="flex items-center gap-1.5 text-slate-900 text-xs font-semibold">
            <Lock className="w-3.5 h-3.5 text-slate-600" />
            <span>2. Privacy & PII Protection</span>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Personal identifying details, patient names, and institutional identifiers are scrubbed from all reference samples to protect confidentiality.
          </p>
        </div>

        {/* 3. Algorithmic Transparency */}
        <div className="p-4 rounded-lg bg-white border border-slate-200 space-y-1.5 shadow-xs">
          <div className="flex items-center gap-1.5 text-slate-900 text-xs font-semibold">
            <Eye className="w-3.5 h-3.5 text-slate-600" />
            <span>3. Objective Metric Reporting</span>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Metrics are calculated using standard Levenshtein edit distance algorithms without score inflation or artificial weighting.
          </p>
        </div>

        {/* 4. Linguistic Equity */}
        <div className="p-4 rounded-lg bg-white border border-slate-200 space-y-1.5 shadow-xs">
          <div className="flex items-center gap-1.5 text-slate-900 text-xs font-semibold">
            <ShieldCheck className="w-3.5 h-3.5 text-slate-600" />
            <span>4. Linguistic Non-Discrimination</span>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            High performance on English benchmarks does not substitute for native evaluation in Hausa, Yoruba, and Igbo. Each language is evaluated individually.
          </p>
        </div>
      </div>

      {/* Data Sovereignty Statement */}
      <section className="p-4 bg-white border border-slate-200 rounded-lg shadow-xs space-y-2">
        <h3 className="text-sm font-bold text-slate-900">Open Research & Local Capacity</h3>
        <p className="text-xs text-slate-600 leading-relaxed">
          The development of speech technologies should empower local healthcare workers and researchers with open tools to evaluate, refine, and deploy accurate voice AI solutions.
        </p>
      </section>
    </div>
  );
};
