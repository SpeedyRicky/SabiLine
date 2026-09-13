import React, { useState, useEffect } from 'react';
import { Navbar, NavTab } from './components/Navbar';
import { HomeView } from './views/HomeView';
import { VoiceGeneratorView } from './views/VoiceGeneratorView';
import { ResultsView } from './views/ResultsView';
import { BenchmarkView } from './views/BenchmarkView';
import { CodeSwitchView } from './views/CodeSwitchView';
import { MethodologyView } from './views/MethodologyView';
import { ImpactView } from './views/ImpactView';
import { EthicsView } from './views/EthicsView';
import { SavedResultItem, ProviderCapability } from './types';
import { Heart, Volume2, ShieldCheck } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('home');
  const [savedResults, setSavedResults] = useState<SavedResultItem[]>(() => {
    try {
      const stored = localStorage.getItem('afrivoice_saved_results');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const [providers, setProviders] = useState<Record<string, ProviderCapability>>({
    sahara: {
      provider: 'sahara',
      displayName: 'Intron Sahara',
      isConfigured: false,
      supportedLanguages: ['ha', 'yo', 'ig', 'en'],
      supportsStreaming: false,
      supportsEmotion: true,
      requiresApiKey: true,
    },
    gemini: {
      provider: 'gemini',
      displayName: 'Google Gemini 3.1 Flash Voice',
      isConfigured: true,
      supportedLanguages: ['en', 'fr', 'zh', 'hi', 'es', 'ha', 'yo', 'ig'],
      supportsStreaming: true,
      supportsEmotion: true,
      requiresApiKey: true,
    },
    browser: {
      provider: 'browser',
      displayName: 'Device Native Web Speech',
      isConfigured: true,
      supportedLanguages: ['en', 'fr', 'zh', 'hi', 'es', 'ha', 'yo', 'ig'],
      supportsStreaming: false,
      supportsEmotion: false,
      requiresApiKey: false,
    },
  });

  // Fetch live provider capability status from backend
  const fetchProviders = async () => {
    try {
      const res = await fetch('/api/providers');
      const data = await res.json();
      if (data.success && data.providers) {
        setProviders(data.providers);
      }
    } catch (err) {
      console.warn('Could not fetch server provider status; using client defaults', err);
    }
  };

  useEffect(() => {
    fetchProviders();
  }, []);

  // Sync saved results to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('afrivoice_saved_results', JSON.stringify(savedResults));
    } catch (e) {
      console.error('LocalStorage write error', e);
    }
  }, [savedResults]);

  const handleSaveToLibrary = (item: SavedResultItem) => {
    setSavedResults((prev) => [item, ...prev.filter((p) => p.id !== item.id)]);
  };

  const handleDeleteResult = (id: string) => {
    setSavedResults((prev) => prev.filter((item) => item.id !== id));
  };

  const handleClearAllResults = () => {
    if (window.confirm('Are you sure you want to clear your saved audio recordings?')) {
      setSavedResults([]);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col font-sans">
      {/* Top Navbar */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        resultCount={savedResults.length}
        providerStatus={{
          saharaConfigured: Boolean(providers.sahara?.isConfigured),
          geminiConfigured: Boolean(providers.gemini?.isConfigured),
        }}
      />

      {/* Main View Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {activeTab === 'home' && (
          <HomeView
            onNavigate={setActiveTab}
            providerStatus={{
              saharaConfigured: Boolean(providers.sahara?.isConfigured),
              geminiConfigured: Boolean(providers.gemini?.isConfigured),
            }}
          />
        )}

        {activeTab === 'generator' && (
          <VoiceGeneratorView
            onSaveToLibrary={handleSaveToLibrary}
            savedResults={savedResults}
            providers={providers}
            onRefreshProviders={fetchProviders}
          />
        )}

        {activeTab === 'results' && (
          <ResultsView
            results={savedResults}
            onDeleteResult={handleDeleteResult}
            onClearAll={handleClearAllResults}
            onNavigate={setActiveTab}
          />
        )}

        {activeTab === 'benchmark' && <BenchmarkView />}

        {activeTab === 'codeswitch' && <CodeSwitchView />}

        {activeTab === 'methodology' && <MethodologyView />}

        {activeTab === 'impact' && <ImpactView />}

        {activeTab === 'ethics' && <EthicsView />}
      </main>

      {/* Basic Clean Footer */}
      <footer className="bg-white border-t border-slate-200 py-8 mt-12 text-slate-600 text-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded bg-emerald-700 flex items-center justify-center text-white">
                <Volume2 className="w-4 h-4" />
              </div>
              <div>
                <span className="font-semibold text-slate-900 text-sm">AfriVoice Studio</span>
                <span className="text-slate-400 mx-2">|</span>
                <span className="text-slate-500 text-xs">
                  Multilingual Voice & Speech Evaluation Tool
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-slate-600">
              <button onClick={() => setActiveTab('home')} className="hover:text-slate-900 transition-colors">
                Home
              </button>
              <button onClick={() => setActiveTab('generator')} className="hover:text-slate-900 transition-colors">
                Voice Generator
              </button>
              <button onClick={() => setActiveTab('benchmark')} className="hover:text-slate-900 transition-colors">
                Benchmark
              </button>
              <button onClick={() => setActiveTab('codeswitch')} className="hover:text-slate-900 transition-colors">
                Code-Switching
              </button>
              <button onClick={() => setActiveTab('methodology')} className="hover:text-slate-900 transition-colors">
                Methodology
              </button>
              <button onClick={() => setActiveTab('impact')} className="hover:text-slate-900 transition-colors">
                Healthcare Impact
              </button>
              <button onClick={() => setActiveTab('ethics')} className="hover:text-slate-900 transition-colors">
                Ethics & Safety
              </button>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-slate-500">
            <div className="flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
              <span>
                Public health communication & empirical evaluation utility. De-identified clinical audio.
              </span>
            </div>
            <div>Hausa · Igbo · Yoruba · Nigerian English · French · Spanish · Chinese · Hindi</div>
          </div>
        </div>
      </footer>
    </div>
  );
}
