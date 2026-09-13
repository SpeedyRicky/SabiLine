import React from 'react';
import { LanguageCode } from '../types';
import { Stethoscope, AlertCircle, Baby, HeartPulse, Pill, ArrowRightLeft } from 'lucide-react';

export interface HealthcarePreset {
  id: string;
  category: 'maternal' | 'malaria' | 'triage' | 'cardiology' | 'pharmacy' | 'codeswitch';
  title: string;
  language: LanguageCode;
  text: string;
  description: string;
}

export const HEALTHCARE_PRESETS: HealthcarePreset[] = [
  {
    id: 'ha-antenatal',
    category: 'maternal',
    title: 'Hausa: Antenatal Guidance',
    language: 'ha',
    text: 'Kina bukatar shan maganin iron da folic acid a kowace rana don karfafa jinin ki da lafiyar jaririn da ke cikin ki. Ziyarci asibiti idan kin ga wata alama ta daban.',
    description: 'Community maternal health education for pregnant mothers in Northern Nigeria.',
  },
  {
    id: 'yo-hypertension',
    category: 'cardiology',
    title: 'Yoruba: Blood Pressure Care',
    language: 'yo',
    text: 'Ẹ dín iyọ̀ kù nínú oúnjẹ yín, kí ẹ sì máa mu òògùn ẹ̀jẹ̀ ríru yín lẹ́ẹ̀kan lójúmọ́ láìsí ìdádúró. Ṣíṣe eré ìdárayá kékeré yóò ran ọkàn yín lọ́wọ́.',
    description: 'Cardiology outpatient instruction in Southwestern Nigeria.',
  },
  {
    id: 'ig-pediatric',
    category: 'maternal',
    title: 'Igbo: Neonatal Fever Signs',
    language: 'ig',
    text: 'Ọ bụrụ na ahụ ọkụ abịa ma ọ bụ nwa amụrụ ọhụrụ enwee anya edo edo, kpọtara ya ngwa ngwa n\'ụlọ ọgwụ kacha nso. Ejila mmiri oyi saa nwa nwere ahụ ọkụ.',
    description: 'Neonatal care warning broadcast for families in Southeastern Nigeria.',
  },
  {
    id: 'cs-ha-triage',
    category: 'codeswitch',
    title: 'Code-Switched: English + Hausa',
    language: 'en',
    text: 'The patient took two tablets of paracetamol yau da safe, but zazzabi still refused to come down. We need to run a rapid malaria test right now.',
    description: 'Real-world bilingual clinical handover in a peri-urban clinic.',
  },
  {
    id: 'cs-yo-emergency',
    category: 'codeswitch',
    title: 'Code-Switched: English + Yoruba',
    language: 'en',
    text: 'Please nurse, check the blood pressure now now, ara n gbọ̀n and she has severe throbbing headache since yesterday night.',
    description: 'Emergency department triage communication.',
  },
  {
    id: 'en-discharge',
    category: 'pharmacy',
    title: 'Nigerian English: Prescription',
    language: 'en',
    text: 'Take one oral capsule every eight hours after meals with clean drinking water. Complete the full seven days even if you start feeling better before then.',
    description: 'Clear pharmaceutical counseling to prevent drug-resistant strains.',
  },
  {
    id: 'fr-vaccination',
    category: 'triage',
    title: 'French: Infant Vaccination',
    language: 'fr',
    text: 'Le vaccin protège votre nourrisson contre le tétanos et la poliomyélite. Présentez le carnet de santé au centre médical pour la dose de rappel.',
    description: 'Francophone West African immunization public outreach.',
  },
  {
    id: 'es-diabetes',
    category: 'pharmacy',
    title: 'Spanish: Glucose Monitoring',
    language: 'es',
    text: 'Mida su nivel de glucosa en sangre cada mañana antes del desayuno y mantenga la insulina en un lugar fresco y protegido de la luz directa.',
    description: 'Endocrinology patient education in Spanish.',
  },
];

interface PresetSelectorProps {
  onSelect: (preset: HealthcarePreset) => void;
}

export const PresetSelector: React.FC<PresetSelectorProps> = ({ onSelect }) => {
  const getCategoryIcon = (category: HealthcarePreset['category']) => {
    switch (category) {
      case 'maternal':
        return <Baby className="w-3.5 h-3.5 text-rose-600" />;
      case 'cardiology':
        return <HeartPulse className="w-3.5 h-3.5 text-red-600" />;
      case 'malaria':
        return <AlertCircle className="w-3.5 h-3.5 text-amber-600" />;
      case 'pharmacy':
        return <Pill className="w-3.5 h-3.5 text-blue-600" />;
      case 'codeswitch':
        return <ArrowRightLeft className="w-3.5 h-3.5 text-emerald-700" />;
      default:
        return <Stethoscope className="w-3.5 h-3.5 text-slate-600" />;
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span className="font-semibold text-slate-700">Healthcare Communication Templates:</span>
        <span className="text-[11px]">Click to load text</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        {HEALTHCARE_PRESETS.map((preset) => (
          <button
            key={preset.id}
            id={`preset-btn-${preset.id}`}
            type="button"
            onClick={() => onSelect(preset)}
            className="text-left p-2.5 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 hover:border-slate-300 transition-colors shadow-2xs group"
          >
            <div className="flex items-center gap-1.5 mb-1">
              {getCategoryIcon(preset.category)}
              <span className="text-xs font-semibold text-slate-800 group-hover:text-slate-950 transition-colors truncate">
                {preset.title}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 line-clamp-2 leading-tight">
              {preset.description}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
};
