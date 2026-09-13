import React, { useState } from 'react';
import {
  Library,
  Trash2,
  ArrowRightLeft,
  Filter,
  Volume2,
  Calendar,
  Languages as LanguagesIcon,
  CheckCircle2,
} from 'lucide-react';
import { SavedResultItem, LANGUAGES, ProviderId } from '../types';
import { AudioWaveformPlayer } from '../components/AudioWaveformPlayer';
import { CompareAudioModal } from '../components/CompareAudioModal';
import { NavTab } from '../components/Navbar';

interface ResultsViewProps {
  results: SavedResultItem[];
  onDeleteResult: (id: string) => void;
  onClearAll: () => void;
  onNavigate: (tab: NavTab) => void;
}

export const ResultsView: React.FC<ResultsViewProps> = ({
  results,
  onDeleteResult,
  onClearAll,
  onNavigate,
}) => {
  const [selectedLanguage, setSelectedLanguage] = useState<string>('all');
  const [selectedProvider, setSelectedProvider] = useState<string>('all');

  // Compare selection (select up to 2)
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [showCompareModal, setShowCompareModal] = useState<boolean>(false);

  const filteredResults = results.filter((item) => {
    const matchLang = selectedLanguage === 'all' || item.language === selectedLanguage;
    const matchProv = selectedProvider === 'all' || item.provider === selectedProvider;
    return matchLang && matchProv;
  });

  const toggleCompareSelect = (id: string) => {
    if (compareIds.includes(id)) {
      setCompareIds(compareIds.filter((item) => item !== id));
    } else {
      if (compareIds.length >= 2) {
        setCompareIds([compareIds[1], id]);
      } else {
        setCompareIds([...compareIds, id]);
      }
    }
  };

  const itemA = results.find((r) => r.id === compareIds[0]);
  const itemB = results.find((r) => r.id === compareIds[1]);

  return (
    <div className="space-y-5 py-2 max-w-5xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Library className="w-5 h-5 text-emerald-700" />
            <span>Audio Library</span>
          </h2>
          <p className="text-xs text-slate-600 mt-0.5">
            View, play, download, and compare your generated voice recordings.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {compareIds.length === 2 && (
            <button
              onClick={() => setShowCompareModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-medium text-xs shadow-xs transition-colors"
            >
              <ArrowRightLeft className="w-3.5 h-3.5" />
              <span>Compare Selected (2)</span>
            </button>
          )}

          {results.length > 0 && (
            <button
              onClick={onClearAll}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white hover:bg-rose-50 hover:text-rose-700 text-slate-600 border border-slate-300 text-xs font-medium transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear Library</span>
            </button>
          )}
        </div>
      </div>

      {/* Filters Bar */}
      {results.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 p-3 bg-white border border-slate-200 rounded-lg text-xs text-slate-700 shadow-xs">
          <div className="flex items-center gap-1.5 font-semibold text-slate-800">
            <Filter className="w-3.5 h-3.5 text-slate-500" />
            <span>Filter:</span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-slate-500">Language:</span>
            <select
              value={selectedLanguage}
              onChange={(e) => setSelectedLanguage(e.target.value)}
              className="bg-white border border-slate-300 rounded px-2 py-1 text-slate-800 focus:outline-none focus:border-slate-500"
            >
              <option value="all">All Languages</option>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-slate-500">Provider:</span>
            <select
              value={selectedProvider}
              onChange={(e) => setSelectedProvider(e.target.value)}
              className="bg-white border border-slate-300 rounded px-2 py-1 text-slate-800 focus:outline-none focus:border-slate-500"
            >
              <option value="all">All Providers</option>
              <option value="sahara">Sahara</option>
              <option value="gemini">Gemini</option>
              <option value="browser">Device Browser</option>
            </select>
          </div>

          <div className="ml-auto text-[11px] text-slate-500">
            Showing {filteredResults.length} of {results.length} recordings
          </div>
        </div>
      )}

      {/* Results List or Zero State */}
      {filteredResults.length === 0 ? (
        <div className="text-center py-12 px-4 bg-white border border-slate-200 rounded-lg space-y-3 shadow-xs">
          <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center mx-auto">
            <Volume2 className="w-5 h-5" />
          </div>
          <h3 className="text-base font-semibold text-slate-900">No Audio Recordings in Library</h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
            Synthesize speech in Hausa, Yoruba, Igbo, or other languages and click "Save to Library" to build your session collection.
          </p>
          <button
            onClick={() => onNavigate('generator')}
            className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-medium text-xs transition-colors"
          >
            Open Voice Generator
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredResults.map((item) => {
            const isSelectedForCompare = compareIds.includes(item.id);
            const lang = LANGUAGES.find((l) => l.code === item.language);

            return (
              <div
                key={item.id}
                className={`bg-white border rounded-lg p-4 shadow-xs transition-colors ${
                  isSelectedForCompare ? 'border-emerald-600 ring-1 ring-emerald-600' : 'border-slate-200'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-base">{lang?.flag}</span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-900">{lang?.name}</span>
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 capitalize">
                          {item.provider}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
                        <span className="capitalize">{item.voiceName}</span>
                        <span>·</span>
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleCompareSelect(item.id)}
                      className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded border transition-colors ${
                        isSelectedForCompare
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <ArrowRightLeft className="w-3.5 h-3.5" />
                      <span>{isSelectedForCompare ? 'Selected' : 'Compare'}</span>
                    </button>

                    <button
                      onClick={() => onDeleteResult(item.id)}
                      className="p-1.5 rounded text-slate-400 hover:text-rose-600 hover:bg-slate-100 transition-colors"
                      title="Delete recording"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Speech script */}
                <div className="p-2.5 bg-slate-50 rounded border border-slate-200 mb-3 text-xs text-slate-700 leading-relaxed">
                  "{item.text}"
                </div>

                {/* Audio Waveform Player */}
                <AudioWaveformPlayer
                  audioBase64={item.audioBase64}
                  audioUrl={item.audioUrl}
                  title={`${lang?.name} Recording`}
                  language={item.language}
                  provider={item.provider}
                  durationSec={item.durationSec}
                />
              </div>
            );
          })}
        </div>
      )}

      {/* Compare Modal */}
      {showCompareModal && itemA && itemB && (
        <CompareAudioModal itemA={itemA} itemB={itemB} onClose={() => setShowCompareModal(false)} />
      )}
    </div>
  );
};
