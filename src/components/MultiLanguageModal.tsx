import React, { useState } from 'react';
import { X, Globe2, Play, Pause, Download, RefreshCw, AlertCircle, CheckCircle2, ArrowRight } from 'lucide-react';
import { LANGUAGES, LanguageCode, MultiLanguageResultItem, ProviderId } from '../types';
import { AVAILABLE_VOICES, PROVIDER_CAPABILITIES } from '../services/tts/voices';
import { AudioWaveformPlayer } from './AudioWaveformPlayer';

interface MultiLanguageModalProps {
  initialText: string;
  sourceLang: LanguageCode;
  onClose: () => void;
  onSaveResult: (item: any) => void;
}

export const MultiLanguageModal: React.FC<MultiLanguageModalProps> = ({
  initialText,
  sourceLang,
  onClose,
  onSaveResult,
}) => {
  const [inputText, setInputText] = useState(initialText);
  const [selectedLangs, setSelectedLangs] = useState<LanguageCode[]>(['ha', 'yo', 'ig', 'en', 'fr']);
  const [translateFirst, setTranslateFirst] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [results, setResults] = useState<MultiLanguageResultItem[]>([]);
  const [activeStepMessage, setActiveStepMessage] = useState<string>('');

  const toggleLang = (code: LanguageCode) => {
    if (selectedLangs.includes(code)) {
      if (selectedLangs.length > 1) {
        setSelectedLangs(selectedLangs.filter((l) => l !== code));
      }
    } else {
      setSelectedLangs([...selectedLangs, code]);
    }
  };

  const executeMultiGeneration = async () => {
    if (!inputText.trim()) return;
    setIsProcessing(true);

    // Initialize blank status for each language
    const initialItems: MultiLanguageResultItem[] = selectedLangs.map((langCode) => {
      // Find optimal voice for this language
      const voice =
        AVAILABLE_VOICES.find((v) => v.language === langCode && v.provider === 'sahara') ||
        AVAILABLE_VOICES.find((v) => v.language === langCode) ||
        AVAILABLE_VOICES[0];

      return {
        language: langCode,
        translatedText: langCode === sourceLang ? inputText : '',
        status: 'pending',
        provider: voice.provider,
        voiceName: voice.name,
      };
    });

    setResults(initialItems);

    for (let i = 0; i < initialItems.length; i++) {
      const item = initialItems[i];
      const langInfo = LANGUAGES.find((l) => l.code === item.language);
      setActiveStepMessage(`Processing ${langInfo?.name || item.language}...`);

      try {
        let textToSynthesize = inputText;

        // Step 1: Translation (if selected and target != source)
        if (translateFirst && item.language !== sourceLang) {
          setResults((prev) =>
            prev.map((r, idx) => (idx === i ? { ...r, status: 'translating' } : r))
          );

          const transRes = await fetch('/api/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: inputText,
              sourceLang,
              targetLang: item.language,
            }),
          });

          const transData = await transRes.json();
          if (transData.success && transData.translatedText) {
            textToSynthesize = transData.translatedText;
            setResults((prev) =>
              prev.map((r, idx) =>
                idx === i ? { ...r, translatedText: textToSynthesize } : r
              )
            );
          } else {
            throw new Error(transData.error || 'Translation failed.');
          }
        } else {
          setResults((prev) =>
            prev.map((r, idx) =>
              idx === i ? { ...r, translatedText: textToSynthesize } : r
            )
          );
        }

        // Step 2: Speech Synthesis
        setResults((prev) =>
          prev.map((r, idx) => (idx === i ? { ...r, status: 'synthesizing' } : r))
        );

        // Find voice and provider
        let providerToUse: ProviderId = 'gemini';
        let voiceId = 'gemini-kore';

        if (['ha', 'yo', 'ig'].includes(item.language)) {
          // If Sahara is configured, use it, else Gemini or browser
          if (PROVIDER_CAPABILITIES.sahara.isConfigured) {
            providerToUse = 'sahara';
            const sVoice = AVAILABLE_VOICES.find(
              (v) => v.language === item.language && v.provider === 'sahara'
            );
            if (sVoice) voiceId = sVoice.id;
          }
        }

        const ttsRes = await fetch('/api/tts/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: textToSynthesize,
            language: item.language,
            voiceId,
            provider: providerToUse,
          }),
        });

        const ttsData = await ttsRes.json();

        if (ttsData.success) {
          const audioResult = {
            id: `ML-${Date.now()}-${item.language}`,
            audioBase64: ttsData.audioBase64,
            mimeType: ttsData.mimeType || 'audio/wav',
            durationSec: ttsData.durationSec || 5,
            text: textToSynthesize,
            language: item.language,
            voiceId,
            provider: providerToUse,
            timestamp: new Date().toISOString(),
          };

          setResults((prev) =>
            prev.map((r, idx) =>
              idx === i
                ? {
                    ...r,
                    status: 'success',
                    audioResult,
                  }
                : r
            )
          );

          onSaveResult(audioResult);
        } else {
          setResults((prev) =>
            prev.map((r, idx) =>
              idx === i
                ? {
                    ...r,
                    status: 'error',
                    error: ttsData.error || 'TTS generation failed.',
                  }
                : r
            )
          );
        }
      } catch (err: any) {
        setResults((prev) =>
          prev.map((r, idx) =>
            idx === i
              ? {
                  ...r,
                  status: 'error',
                  error: err.message || 'Operation failed',
                }
              : r
          )
        );
      }
    }

    setIsProcessing(false);
    setActiveStepMessage('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
      <div className="bg-white border border-slate-200 rounded-lg max-w-4xl w-full p-5 shadow-lg text-slate-800 max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Globe2 className="w-5 h-5 text-slate-700" />
            <h3 className="text-base font-bold text-slate-900">Multi-Language Speech Generator</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Configuration Body */}
        <div className="flex-1 overflow-y-auto py-4 space-y-4">
          {/* Source Input */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Source Text:
            </label>
            <textarea
              rows={3}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              className="w-full bg-white border border-slate-300 rounded-lg p-3 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-slate-500 transition-colors"
              placeholder="Enter message to broadcast across multiple African communities..."
            />
          </div>

          {/* Translation vs Direct TTS switch */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
            <div>
              <span className="text-xs font-semibold text-slate-800">Processing Mode:</span>
              <p className="text-[11px] text-slate-500">
                {translateFirst
                  ? 'Translate text into each language before generating speech'
                  : 'Synthesize raw text directly in selected language accents'}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setTranslateFirst(true)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  translateFirst
                    ? 'bg-slate-900 text-white'
                    : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
                }`}
              >
                Translate First
              </button>
              <button
                type="button"
                onClick={() => setTranslateFirst(false)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  !translateFirst
                    ? 'bg-slate-900 text-white'
                    : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
                }`}
              >
                Direct Speech
              </button>
            </div>
          </div>

          {/* Language Selection Pills */}
          <div>
            <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
              <span className="font-semibold text-slate-700">Target Languages:</span>
              <span>{selectedLangs.length} selected</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {LANGUAGES.map((lang) => {
                const isSelected = selectedLangs.includes(lang.code);
                return (
                  <button
                    key={lang.code}
                    type="button"
                    onClick={() => toggleLang(lang.code)}
                    className={`flex items-center justify-between p-2 rounded-lg border text-left transition-colors ${
                      isSelected
                        ? 'bg-emerald-50 border-emerald-600 text-emerald-950 font-semibold'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <div className="truncate">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm">{lang.flag}</span>
                        <span className="text-xs font-medium">{lang.name.split(' ')[0]}</span>
                      </div>
                      <span className="text-[10px] text-slate-500 block truncate">
                        {lang.nativeName}
                      </span>
                    </div>
                    {lang.african && (
                      <span className="text-[9px] uppercase px-1 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                        AFR
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Execution Button */}
          <div className="pt-2">
            <button
              id="execute-multi-gen-btn"
              onClick={executeMultiGeneration}
              disabled={isProcessing || !inputText.trim() || selectedLangs.length === 0}
              className="w-full py-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white font-medium text-xs sm:text-sm transition-colors flex items-center justify-center gap-2"
            >
              {isProcessing ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>{activeStepMessage || 'Generating speech across languages...'}</span>
                </>
              ) : (
                <>
                  <Globe2 className="w-4 h-4" />
                  <span>Generate Audio for {selectedLangs.length} Languages</span>
                </>
              )}
            </button>
          </div>

          {/* Results List */}
          {results.length > 0 && (
            <div className="space-y-3 pt-3 border-t border-slate-100">
              <h4 className="text-xs font-semibold text-slate-700">
                Generated Audio Outputs ({results.length}):
              </h4>

              <div className="space-y-3">
                {results.map((item) => {
                  const lang = LANGUAGES.find((l) => l.code === item.language);
                  return (
                    <div
                      key={item.language}
                      className="bg-slate-50 p-3.5 rounded-lg border border-slate-200 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-base">{lang?.flag}</span>
                          <span className="text-xs font-bold text-slate-900">{lang?.name}</span>
                          <span className="text-xs text-slate-500">({lang?.nativeName})</span>
                        </div>

                        <div>
                          {item.status === 'pending' && (
                            <span className="text-xs text-slate-400">Queued</span>
                          )}
                          {item.status === 'translating' && (
                            <span className="text-xs text-amber-700 animate-pulse flex items-center gap-1">
                              <RefreshCw className="w-3 h-3 animate-spin" /> Translating...
                            </span>
                          )}
                          {item.status === 'synthesizing' && (
                            <span className="text-xs text-emerald-700 animate-pulse flex items-center gap-1">
                              <RefreshCw className="w-3 h-3 animate-spin" /> Synthesizing...
                            </span>
                          )}
                          {item.status === 'success' && (
                            <span className="text-xs text-emerald-700 font-semibold flex items-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Ready
                            </span>
                          )}
                          {item.status === 'error' && (
                            <span className="text-xs text-rose-600 flex items-center gap-1">
                              <AlertCircle className="w-3.5 h-3.5" /> Error
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Display translated text explicitly before audio player as mandated */}
                      {item.translatedText && (
                        <div className="bg-white p-2 rounded text-xs text-slate-700 border border-slate-200">
                          <span className="text-[10px] text-slate-500 uppercase font-semibold block mb-0.5">
                            {translateFirst ? 'Translated Text:' : 'Input Script:'}
                          </span>
                          "{item.translatedText}"
                        </div>
                      )}

                      {/* Error state */}
                      {item.error && (
                        <div className="bg-rose-50 border border-rose-200 p-2.5 rounded text-xs text-rose-800">
                          {item.error}
                        </div>
                      )}

                      {/* Audio Player if generated */}
                      {item.audioResult && (
                        <AudioWaveformPlayer
                          audioBase64={item.audioResult.audioBase64}
                          audioUrl={item.audioResult.audioUrl}
                          title={`${lang?.name} Speech`}
                          language={item.language}
                          provider={item.provider}
                          durationSec={item.audioResult.durationSec}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="pt-3 border-t border-slate-100 flex justify-end">
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
