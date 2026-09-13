import React from 'react';
import {
  Volume2,
  Activity,
  ShieldCheck,
  ArrowRight,
  Languages,
  CheckCircle2,
  ArrowRightLeft,
  FileText,
} from 'lucide-react';
import { LANGUAGES } from '../types';
import { NavTab } from '../components/Navbar';

interface HomeViewProps {
  onNavigate: (tab: NavTab) => void;
  providerStatus: {
    saharaConfigured: boolean;
    geminiConfigured: boolean;
  };
}

export const HomeView: React.FC<HomeViewProps> = ({ onNavigate }) => {
  return (
    <div className="space-y-10 py-4">
      {/* Intro Panel - Basic, Clean, Practical */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 shadow-xs">
        <div className="max-w-3xl space-y-4">
          <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700 text-xs font-medium">
            <span>African Multilingual Speech Platform</span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
            Speech synthesis and evaluation for African languages
          </h1>

          <p className="text-sm text-slate-600 leading-relaxed">
            Create spoken audio announcements and evaluate speech models across Hausa, Igbo, Yoruba, Nigerian English, and global languages. Built to help healthcare workers, public communicators, and researchers share clear voice information and benchmark recognition accuracy.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              id="hero-create-voice-btn"
              onClick={() => onNavigate('generator')}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium transition-colors"
            >
              <Volume2 className="w-4 h-4" />
              <span>Open Voice Generator</span>
              <ArrowRight className="w-3.5 h-3.5 ml-0.5" />
            </button>

            <button
              id="hero-explore-benchmark-btn"
              onClick={() => onNavigate('benchmark')}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 text-xs font-medium transition-colors"
            >
              <Activity className="w-4 h-4 text-slate-500" />
              <span>View Speech Benchmark</span>
            </button>

            <button
              id="hero-codeswitch-btn"
              onClick={() => onNavigate('codeswitch')}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 text-xs font-medium transition-colors"
            >
              <ArrowRightLeft className="w-4 h-4 text-slate-500" />
              <span>Analyze Code-Switching</span>
            </button>
          </div>

          <div className="pt-2 flex flex-wrap items-center gap-4 text-xs text-slate-500">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>Real audio waveform synthesis</span>
            </div>
            <span>·</span>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>Verifiable Word Error Rate (WER) metrics</span>
            </div>
          </div>
        </div>
      </section>

      {/* Languages Supported */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">
            Primary Supported Languages
          </h2>
          <p className="text-xs text-slate-600 mt-0.5">
            Hausa, Igbo, and Yoruba are supported with authentic tonal diacritics and phoneme mappings alongside global languages.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {LANGUAGES.map((lang) => (
            <div
              key={lang.code}
              className="p-4 rounded-lg bg-white border border-slate-200 shadow-xs hover:border-slate-300 transition-colors"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xl">{lang.flag}</span>
                {lang.african ? (
                  <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
                    African Core
                  </span>
                ) : (
                  <span className="text-[10px] uppercase font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                    Global
                  </span>
                )}
              </div>

              <h3 className="text-sm font-bold text-slate-900">{lang.name}</h3>
              <p className="text-xs text-emerald-700 font-medium mb-1.5">{lang.nativeName}</p>
              <p className="text-xs text-slate-600 leading-relaxed line-clamp-2">
                {lang.description}
              </p>

              <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                <span>{lang.region.split('(')[0].trim()}</span>
                <button
                  onClick={() => onNavigate('generator')}
                  className="text-emerald-700 hover:text-emerald-800 font-medium"
                >
                  Synthesize →
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Core Functions */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">
            Platform Capabilities
          </h2>
          <p className="text-xs text-slate-600 mt-0.5">
            Functional tools designed for practical communication and model evaluation.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Card 1 */}
          <div className="p-5 rounded-lg bg-white border border-slate-200 shadow-xs space-y-2.5">
            <div className="w-8 h-8 rounded bg-emerald-50 text-emerald-700 flex items-center justify-center border border-emerald-200">
              <Volume2 className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-bold text-slate-900">Voice Synthesis & Audio Export</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Generate spoken audio in Hausa, Igbo, Yoruba, and 5 global languages using Intron Sahara, Gemini 3.1 Flash TTS, or browser speech synthesis with WAV download.
            </p>
            <ul className="text-xs text-slate-600 space-y-1 pt-1 border-t border-slate-100">
              <li className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <span>Multi-language single prompt broadcasting</span>
              </li>
              <li className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <span>African tonal accent preservation</span>
              </li>
            </ul>
          </div>

          {/* Card 2 */}
          <div className="p-5 rounded-lg bg-white border border-slate-200 shadow-xs space-y-2.5">
            <div className="w-8 h-8 rounded bg-amber-50 text-amber-800 flex items-center justify-center border border-amber-200">
              <ArrowRightLeft className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-bold text-slate-900">Code-Switching Detection</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Detect intra-utterance transitions where African speakers naturally blend English with Hausa, Yoruba, or Igbo. Visualizes switch boundaries clearly.
            </p>
            <ul className="text-xs text-slate-600 space-y-1 pt-1 border-t border-slate-100">
              <li className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-amber-700" />
                <span>Token-level boundary inference timeline</span>
              </li>
              <li className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-amber-700" />
                <span>Speech boundary error tracking</span>
              </li>
            </ul>
          </div>

          {/* Card 3 */}
          <div className="p-5 rounded-lg bg-white border border-slate-200 shadow-xs space-y-2.5">
            <div className="w-8 h-8 rounded bg-blue-50 text-blue-800 flex items-center justify-center border border-blue-200">
              <Activity className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-bold text-slate-900">Speech-to-Text Benchmarking</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Compare speech recognition across models on clinical samples. Computes Word Error Rate (WER) and Character Error Rate (CER) with full normalization and exportable reports.
            </p>
            <ul className="text-xs text-slate-600 space-y-1 pt-1 border-t border-slate-100">
              <li className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-blue-700" />
                <span>Levenshtein edit distance calculations</span>
              </li>
              <li className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-blue-700" />
                <span>Exportable markdown/JSON reports</span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* Public Health Context Box */}
      <section className="bg-slate-100 border border-slate-200 rounded-xl p-6 text-slate-800 flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="space-y-2 max-w-2xl">
          <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
            Public Health Communication
          </span>
          <h3 className="text-base font-bold text-slate-900">
            Clear voice instructions for antenatal care, malaria triage, and prescriptions
          </h3>
          <p className="text-xs text-slate-600 leading-relaxed">
            By providing spoken instructions in Hausa, Yoruba, and Igbo, community health programs can ensure critical health guidelines reach patients regardless of literacy or language barriers.
          </p>
          <div className="flex items-center gap-1.5 text-xs text-slate-500 pt-1">
            <ShieldCheck className="w-3.5 h-3.5 text-slate-500" />
            <span>Educational and public health communication tool; not a clinical diagnostic device.</span>
          </div>
        </div>

        <button
          onClick={() => onNavigate('impact')}
          className="px-4 py-2 rounded-lg bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 text-xs font-medium whitespace-nowrap transition-colors"
        >
          Read Healthcare Impact Summary →
        </button>
      </section>
    </div>
  );
};
