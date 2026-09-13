import React from 'react';
import { AlertTriangle, CheckCircle2, ShieldAlert, Cpu } from 'lucide-react';
import { ProviderCapability } from '../types';

interface ProviderStatusBannerProps {
  providers: Record<string, ProviderCapability>;
}

export const ProviderStatusBanner: React.FC<ProviderStatusBannerProps> = ({ providers }) => {
  const sahara = providers.sahara;
  const gemini = providers.gemini;

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-3 sm:p-4 text-slate-800 shadow-xs">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Cpu className="w-4 h-4 text-slate-600 flex-shrink-0" />
          <div>
            <h4 className="text-xs font-bold text-slate-900">Speech Engine Status</h4>
            <p className="text-[11px] text-slate-500">
              Provider credentials and speech capabilities configured for this workspace.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* Sahara Provider Status */}
          <div
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded border ${
              sahara?.isConfigured
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-amber-50 border-amber-200 text-amber-900'
            }`}
          >
            {sahara?.isConfigured ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
            ) : (
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
            )}
            <span>
              <strong>Sahara:</strong> {sahara?.isConfigured ? 'Connected' : 'Local Fallback'}
            </span>
          </div>

          {/* Gemini Voice Status */}
          <div
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded border ${
              gemini?.isConfigured
                ? 'bg-blue-50 border-blue-200 text-blue-800'
                : 'bg-amber-50 border-amber-200 text-amber-900'
            }`}
          >
            {gemini?.isConfigured ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-blue-700" />
            ) : (
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
            )}
            <span>
              <strong>Gemini 3.1:</strong> {gemini?.isConfigured ? 'Ready' : 'Local Mode'}
            </span>
          </div>

          {/* Device Native Web Speech */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded border bg-slate-50 border-slate-200 text-slate-700">
            <CheckCircle2 className="w-3.5 h-3.5 text-slate-500" />
            <span>
              <strong>Device Voice:</strong> Available
            </span>
          </div>
        </div>
      </div>

      {!sahara?.isConfigured && (
        <div className="mt-2.5 pt-2 border-t border-slate-100 text-[11px] text-slate-600 flex items-start gap-1.5">
          <ShieldAlert className="w-3.5 h-3.5 text-amber-600 flex-shrink-0 mt-0.5" />
          <span>
            <strong>Sahara Integration:</strong> To synthesize using Intron Sahara's native African models, provide <code className="text-slate-800 bg-slate-100 px-1 py-0.5 rounded border border-slate-200">SAHARA_API_KEY</code>. Gemini voice and browser speech synthesis remain ready to generate audio.
          </span>
        </div>
      )}
    </div>
  );
};
