import React from 'react';
import { X, ArrowRightLeft } from 'lucide-react';
import { SavedResultItem } from '../types';
import { AudioWaveformPlayer } from './AudioWaveformPlayer';

interface CompareAudioModalProps {
  itemA: SavedResultItem;
  itemB: SavedResultItem;
  onClose: () => void;
}

export const CompareAudioModal: React.FC<CompareAudioModalProps> = ({
  itemA,
  itemB,
  onClose,
}) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
      <div className="bg-white border border-slate-200 rounded-lg max-w-4xl w-full p-5 shadow-lg text-slate-800 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <ArrowRightLeft className="w-5 h-5 text-slate-700" />
            <h3 className="text-base font-bold text-slate-900">Side-by-Side Audio Comparison</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          {/* Version A */}
          <div className="space-y-3 bg-slate-50 p-4 rounded-lg border border-slate-200">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase text-slate-700">
                Version A
              </span>
              <span className="text-xs text-slate-500 capitalize">
                {itemA.provider} · {itemA.voiceName}
              </span>
            </div>

            <p className="text-xs text-slate-700 bg-white p-2.5 rounded border border-slate-200">
              "{itemA.text}"
            </p>

            <AudioWaveformPlayer
              audioBase64={itemA.audioBase64}
              audioUrl={itemA.audioUrl}
              title={`Version A (${itemA.language.toUpperCase()})`}
              language={itemA.language}
              provider={itemA.provider}
              durationSec={itemA.durationSec}
            />
          </div>

          {/* Version B */}
          <div className="space-y-3 bg-slate-50 p-4 rounded-lg border border-slate-200">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase text-slate-700">
                Version B
              </span>
              <span className="text-xs text-slate-500 capitalize">
                {itemB.provider} · {itemB.voiceName}
              </span>
            </div>

            <p className="text-xs text-slate-700 bg-white p-2.5 rounded border border-slate-200">
              "{itemB.text}"
            </p>

            <AudioWaveformPlayer
              audioBase64={itemB.audioBase64}
              audioUrl={itemB.audioUrl}
              title={`Version B (${itemB.language.toUpperCase()})`}
              language={itemB.language}
              provider={itemB.provider}
              durationSec={itemB.durationSec}
            />
          </div>
        </div>

        <div className="mt-4 pt-3 border-t border-slate-100 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-800 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
