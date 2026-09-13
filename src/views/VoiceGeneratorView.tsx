import React, { useState, useEffect } from 'react';
import {
  Volume2,
  Globe2,
  Sliders,
  Sparkles,
  RefreshCw,
  Trash2,
  ArrowRightLeft,
  AlertCircle,
  BookmarkCheck,
  CheckCircle2,
  Languages,
} from 'lucide-react';
import { LANGUAGES, LanguageCode, ProviderId, TTSResult, SavedResultItem } from '../types';
import { AVAILABLE_VOICES, PROVIDER_CAPABILITIES } from '../services/tts/voices';
import { PresetSelector, HealthcarePreset } from '../components/PresetSelector';
import { AudioWaveformPlayer } from '../components/AudioWaveformPlayer';
import { ProviderStatusBanner } from '../components/ProviderStatusBanner';
import { MultiLanguageModal } from '../components/MultiLanguageModal';
import { CompareAudioModal } from '../components/CompareAudioModal';

interface VoiceGeneratorViewProps {
  onSaveToLibrary: (result: SavedResultItem) => void;
  savedResults: SavedResultItem[];
  providers: Record<string, any>;
  onRefreshProviders: () => void;
}

export const VoiceGeneratorView: React.FC<VoiceGeneratorViewProps> = ({
  onSaveToLibrary,
  savedResults,
  providers,
  onRefreshProviders,
}) => {
  // Main form state
  const [text, setText] = useState<string>(
    'Kina bukatar shan maganin iron da folic acid a kowace rana don karfafa jinin ki da lafiyar jaririn da ke cikin ki.'
  );
  const [selectedLang, setSelectedLang] = useState<LanguageCode>('ha');
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>('gemini');
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>('gemini-kore');
  const [speed, setSpeed] = useState<number>(1.0);
  const [pitch, setPitch] = useState<number>(1.0);
  const [emotion, setEmotion] = useState<'neutral' | 'empathic' | 'authoritative' | 'urgent'>('empathic');

  // Generation state
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [lastResult, setLastResult] = useState<TTSResult | null>(null);
  const [previousResult, setPreviousResult] = useState<TTSResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);

  // Modals state
  const [showMultiLangModal, setShowMultiLangModal] = useState<boolean>(false);
  const [showCompareModal, setShowCompareModal] = useState<boolean>(false);

  // Filter voices that support the selected language and provider
  const availableVoicesForSelection = AVAILABLE_VOICES.filter((v) => {
    return v.language === selectedLang;
  });

  // Ensure current voice matches language
  useEffect(() => {
    const matchingVoice = AVAILABLE_VOICES.find(
      (v) => v.language === selectedLang && v.provider === selectedProvider
    ) || AVAILABLE_VOICES.find((v) => v.language === selectedLang) || AVAILABLE_VOICES[0];

    if (matchingVoice) {
      setSelectedVoiceId(matchingVoice.id);
      setSelectedProvider(matchingVoice.provider);
    }
  }, [selectedLang]);

  // Provider capability check for current selection
  const currentProviderCap = PROVIDER_CAPABILITIES[selectedProvider];
  const isLanguageSupportedByProvider = currentProviderCap?.supportedLanguages.includes(selectedLang);

  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  const charCount = text.length;

  const handlePresetSelect = (preset: HealthcarePreset) => {
    setText(preset.text);
    setSelectedLang(preset.language);
    setErrorMessage(null);
  };

  const handleGenerate = async () => {
    if (!text.trim()) {
      setErrorMessage('Please enter some text to synthesize.');
      return;
    }

    setErrorMessage(null);
    setIsGenerating(true);
    setSaveSuccess(false);

    try {
      // Check if browser native synthesis is selected
      if (selectedProvider === 'browser') {
        if (!('speechSynthesis' in window)) {
          throw new Error('Web Speech API is not supported by your browser.');
        }

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = speed;
        utterance.pitch = pitch;

        // Find matching OS voice
        const synth = window.speechSynthesis;
        const voices = synth.getVoices();
        const matchingOsVoice = voices.find((v) => v.lang.startsWith(selectedLang));
        if (matchingOsVoice) utterance.voice = matchingOsVoice;

        synth.speak(utterance);

        const dummyResult: TTSResult = {
          id: `TTS-${Date.now()}`,
          text,
          language: selectedLang,
          voiceId: selectedVoiceId,
          provider: 'browser',
          mimeType: 'audio/wav',
          durationSec: Math.max(2, Math.round(wordCount * 0.4)),
          timestamp: new Date().toISOString(),
          note: 'Synthesized via local Device Web Speech',
        };

        if (lastResult) setPreviousResult(lastResult);
        setLastResult(dummyResult);
        setIsGenerating(false);
        return;
      }

      // Call server-side API route
      const response = await fetch('/api/tts/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          language: selectedLang,
          voiceId: selectedVoiceId,
          provider: selectedProvider,
          speed,
          pitch,
          emotion,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Speech generation failed.');
      }

      const newResult: TTSResult = {
        id: `TTS-${Date.now()}`,
        audioBase64: data.audioBase64,
        mimeType: data.mimeType || 'audio/wav',
        durationSec: data.durationSec || 4,
        text,
        language: selectedLang,
        voiceId: selectedVoiceId,
        provider: selectedProvider,
        timestamp: new Date().toISOString(),
      };

      if (lastResult) setPreviousResult(lastResult);
      setLastResult(newResult);
    } catch (err: any) {
      console.error('Generation failure:', err);
      setErrorMessage(err.message || 'An unexpected error occurred during synthesis.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveToLibrary = () => {
    if (!lastResult) return;
    const voiceObj = AVAILABLE_VOICES.find((v) => v.id === lastResult.voiceId);
    onSaveToLibrary({
      id: lastResult.id,
      text: lastResult.text,
      language: lastResult.language,
      voiceName: voiceObj?.name || lastResult.voiceId,
      provider: lastResult.provider,
      audioBase64: lastResult.audioBase64,
      audioUrl: lastResult.audioUrl,
      durationSec: lastResult.durationSec,
      createdAt: lastResult.timestamp,
    });
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  const handleClear = () => {
    setText('');
    setErrorMessage(null);
  };

  return (
    <div className="space-y-6 py-2 max-w-6xl mx-auto">
      {/* Provider Status Transparency Banner */}
      <ProviderStatusBanner providers={providers} />

      {/* Header & Multilingual Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Volume2 className="w-5 h-5 text-emerald-700" />
            <span>Voice Generator</span>
          </h2>
          <p className="text-xs text-slate-600 mt-0.5">
            Create spoken announcements and audio instructions across African and global languages.
          </p>
        </div>

        <button
          id="open-multi-lang-gen-btn"
          onClick={() => setShowMultiLangModal(true)}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 font-medium text-xs shadow-2xs transition-colors self-start sm:self-auto"
        >
          <Globe2 className="w-3.5 h-3.5 text-slate-500" />
          <span>Generate in Multiple Languages</span>
        </button>
      </div>

      {/* Preset Clinical Templates */}
      <PresetSelector onSelect={handlePresetSelect} />

      {/* Main Workspace Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Text & Language Configuration (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          {/* Text Editor Box */}
          <div className="bg-white border border-slate-200 rounded-lg p-4 sm:p-5 shadow-xs text-slate-800 space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <label htmlFor="voice-text-input" className="font-semibold text-slate-800">
                Text to Speak:
              </label>
              <div className="flex items-center gap-2 font-mono text-slate-500">
                <span>{wordCount} words</span>
                <span>·</span>
                <span>{charCount} chars</span>
              </div>
            </div>

            <textarea
              id="voice-text-input"
              rows={6}
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="w-full bg-white border border-slate-300 rounded-lg p-3 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500 transition-colors leading-relaxed"
              placeholder="Enter or paste text for maternal guidance, triage notification, or community health notice..."
            />

            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-slate-500">
                Supports African tonal accents (e.g. Igbo sub-dots ọ, ụ, ị and Yoruba tone marks á, à).
              </span>
              <button
                type="button"
                onClick={handleClear}
                className="text-xs text-slate-500 hover:text-rose-600 flex items-center gap-1 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear text</span>
              </button>
            </div>
          </div>

          {/* Language Selector */}
          <div className="bg-white border border-slate-200 rounded-lg p-4 sm:p-5 shadow-xs text-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                <Languages className="w-4 h-4 text-emerald-700" />
                <span>Select Target Language:</span>
              </label>
              <span className="text-[11px] text-slate-500">Hausa, Igbo, Yoruba & Global</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {LANGUAGES.map((lang) => {
                const isSelected = selectedLang === lang.code;
                return (
                  <button
                    key={lang.code}
                    id={`select-lang-${lang.code}`}
                    type="button"
                    onClick={() => setSelectedLang(lang.code)}
                    className={`p-2.5 rounded-lg border text-left transition-colors relative ${
                      isSelected
                        ? 'bg-emerald-50 border-emerald-600 text-emerald-950 font-semibold ring-1 ring-emerald-600'
                        : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-base">{lang.flag}</span>
                      {lang.african && (
                        <span className="text-[9px] uppercase font-semibold px-1 rounded bg-slate-100 text-slate-700 border border-slate-200">
                          AFR
                        </span>
                      )}
                    </div>
                    <div className="mt-1 font-semibold text-xs text-slate-900 truncate">{lang.name.split(' ')[0]}</div>
                    <div className="text-[10px] text-slate-500 truncate">{lang.nativeName}</div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Column: Voice & Settings (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          {/* Voice & Provider Selection */}
          <div className="bg-white border border-slate-200 rounded-lg p-4 sm:p-5 shadow-xs text-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <label htmlFor="voice-select-dropdown" className="text-xs font-semibold text-slate-800">
                Voice & Accent:
              </label>
              <span className="text-[11px] text-slate-500">
                {availableVoicesForSelection.length} voices available
              </span>
            </div>

            {/* Provider Capability Alert if unsupported */}
            {!isLanguageSupportedByProvider && (
              <div className="bg-amber-50 border border-amber-200 p-3 rounded-lg text-xs text-amber-900 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-amber-700 flex-shrink-0 mt-0.5" />
                <div>
                  <strong className="capitalize">{selectedProvider}</strong> does not officially support{' '}
                  <strong>{LANGUAGES.find((l) => l.code === selectedLang)?.name}</strong>.
                  <div className="mt-0.5 text-amber-800">
                    You can switch to Intron Sahara or standard device speech for this language.
                  </div>
                </div>
              </div>
            )}

            {/* Voice Dropdown */}
            <div>
              <select
                id="voice-select-dropdown"
                value={selectedVoiceId}
                onChange={(e) => {
                  const vId = e.target.value;
                  setSelectedVoiceId(vId);
                  const voiceObj = AVAILABLE_VOICES.find((v) => v.id === vId);
                  if (voiceObj) setSelectedProvider(voiceObj.provider);
                }}
                className="w-full bg-white border border-slate-300 rounded-lg p-2.5 text-sm text-slate-900 focus:outline-none focus:border-slate-500"
              >
                {AVAILABLE_VOICES.filter((v) => v.language === selectedLang || v.provider === 'gemini').map(
                  (voice) => (
                    <option key={voice.id} value={voice.id}>
                      {voice.name} · [{voice.provider.toUpperCase()}] ({voice.accent})
                    </option>
                  )
                )}
              </select>

              {/* Selected Voice Details */}
              {(() => {
                const activeVoice = AVAILABLE_VOICES.find((v) => v.id === selectedVoiceId);
                if (!activeVoice) return null;
                return (
                  <div className="mt-2.5 p-2.5 rounded bg-slate-50 border border-slate-200 text-xs text-slate-600 space-y-1">
                    <div className="flex items-center justify-between text-[11px] text-slate-500">
                      <span>Provider: <strong className="text-slate-800 uppercase">{activeVoice.provider}</strong></span>
                      <span>Gender: <strong className="capitalize text-slate-800">{activeVoice.gender}</strong></span>
                    </div>
                    {activeVoice.recommendedFor && (
                      <p className="text-[11px] text-slate-500">
                        Recommendation: {activeVoice.recommendedFor}
                      </p>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Voice Controls: Speed, Pitch & Emotion */}
            <div className="space-y-3 pt-3 border-t border-slate-100">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                <Sliders className="w-3.5 h-3.5 text-slate-500" />
                <span>Speech Rate & Tone:</span>
              </div>

              {/* Speed Slider */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-slate-600">
                  <span>Speaking Rate:</span>
                  <span className="font-mono font-medium text-slate-900">{speed}x</span>
                </div>
                <input
                  type="range"
                  min={0.7}
                  max={1.5}
                  step={0.05}
                  value={speed}
                  onChange={(e) => setSpeed(Number(e.target.value))}
                  className="w-full h-1.5 bg-slate-200 rounded appearance-none cursor-pointer accent-emerald-700"
                  aria-label="Speaking rate"
                />
              </div>

              {/* Emotion / Healthcare Style Selector */}
              <div className="space-y-1">
                <label className="block text-xs text-slate-600">Tone / Emotion:</label>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      { id: 'empathic', label: 'Empathetic Counseling' },
                      { id: 'authoritative', label: 'Public Health Notice' },
                      { id: 'urgent', label: 'Urgent Clinical' },
                      { id: 'neutral', label: 'Standard Information' },
                    ] as const
                  ).map((em) => (
                    <button
                      key={em.id}
                      type="button"
                      onClick={() => setEmotion(em.id)}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                        emotion === em.id
                          ? 'bg-slate-100 border-slate-400 text-slate-900 font-semibold'
                          : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {em.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Error Message */}
            {errorMessage && (
              <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
                <div>
                  <strong>Error:</strong> {errorMessage}
                </div>
              </div>
            )}

            {/* Primary Generate Button */}
            <button
              id="generate-voice-btn"
              type="button"
              onClick={handleGenerate}
              disabled={isGenerating || !text.trim()}
              className="w-full py-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white font-medium text-xs sm:text-sm transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed shadow-2xs"
            >
              {isGenerating ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Synthesizing Audio...</span>
                </>
              ) : (
                <>
                  <Volume2 className="w-4 h-4" />
                  <span>Generate Speech Audio</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Generated Audio Player Result Section */}
      {lastResult && (
        <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-xs text-slate-800 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
            <div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                <h3 className="text-sm font-bold text-slate-900">Generated Audio Output</h3>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Language: {LANGUAGES.find((l) => l.code === lastResult.language)?.name} · Provider:{' '}
                <span className="capitalize font-semibold text-slate-800">{lastResult.provider}</span>
              </p>
            </div>

            <div className="flex items-center gap-2">
              {previousResult && (
                <button
                  onClick={() => setShowCompareModal(true)}
                  className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 transition-colors"
                >
                  <ArrowRightLeft className="w-3.5 h-3.5 text-slate-500" />
                  <span>Compare Audio</span>
                </button>
              )}

              <button
                id="save-to-library-btn"
                onClick={handleSaveToLibrary}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white transition-colors"
              >
                <BookmarkCheck className="w-3.5 h-3.5" />
                <span>{saveSuccess ? 'Saved to Library' : 'Save to Library'}</span>
              </button>
            </div>
          </div>

          {/* Player */}
          <AudioWaveformPlayer
            audioBase64={lastResult.audioBase64}
            audioUrl={lastResult.audioUrl}
            mimeType={lastResult.mimeType}
            title={`${LANGUAGES.find((l) => l.code === lastResult.language)?.name} Speech`}
            language={lastResult.language}
            provider={lastResult.provider}
            durationSec={lastResult.durationSec}
            autoPlay={true}
          />
        </div>
      )}

      {/* Multi-Language Generation Modal */}
      {showMultiLangModal && (
        <MultiLanguageModal
          initialText={text}
          sourceLang={selectedLang}
          onClose={() => setShowMultiLangModal(false)}
          onSaveResult={onSaveToLibrary}
        />
      )}

      {/* Compare Audio Modal */}
      {showCompareModal && lastResult && previousResult && (
        <CompareAudioModal
          itemA={{
            id: previousResult.id,
            text: previousResult.text,
            language: previousResult.language,
            voiceName: previousResult.voiceId,
            provider: previousResult.provider,
            audioBase64: previousResult.audioBase64,
            audioUrl: previousResult.audioUrl,
            durationSec: previousResult.durationSec,
            createdAt: previousResult.timestamp,
          }}
          itemB={{
            id: lastResult.id,
            text: lastResult.text,
            language: lastResult.language,
            voiceName: lastResult.voiceId,
            provider: lastResult.provider,
            audioBase64: lastResult.audioBase64,
            audioUrl: lastResult.audioUrl,
            durationSec: lastResult.durationSec,
            createdAt: lastResult.timestamp,
          }}
          onClose={() => setShowCompareModal(false)}
        />
      )}
    </div>
  );
};
