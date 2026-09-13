import React, { useState } from 'react';
import {
  Volume2,
  Activity,
  Library,
  BookOpen,
  HeartHandshake,
  ShieldCheck,
  Menu,
  X,
  Languages,
  ArrowRightLeft,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

export type NavTab = 'home' | 'generator' | 'results' | 'benchmark' | 'codeswitch' | 'methodology' | 'impact' | 'ethics';

interface NavbarProps {
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;
  resultCount: number;
  providerStatus: {
    saharaConfigured: boolean;
    geminiConfigured: boolean;
  };
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  resultCount,
  providerStatus,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navItems: Array<{ id: NavTab; label: string; icon: React.ReactNode; badge?: string }> = [
    { id: 'home', label: 'Home', icon: <Languages className="w-4 h-4" /> },
    { id: 'generator', label: 'Voice Generator', icon: <Volume2 className="w-4 h-4" /> },
    { id: 'results', label: 'My Results', icon: <Library className="w-4 h-4" />, badge: resultCount > 0 ? String(resultCount) : undefined },
    { id: 'benchmark', label: 'Benchmark', icon: <Activity className="w-4 h-4" /> },
    { id: 'codeswitch', label: 'Code-Switching', icon: <ArrowRightLeft className="w-4 h-4" /> },
    { id: 'methodology', label: 'Methodology', icon: <BookOpen className="w-4 h-4" /> },
    { id: 'impact', label: 'Impact', icon: <HeartHandshake className="w-4 h-4" /> },
    { id: 'ethics', label: 'Ethics', icon: <ShieldCheck className="w-4 h-4" /> },
  ];

  const handleSelect = (tab: NavTab) => {
    setActiveTab(tab);
    setMobileMenuOpen(false);
  };

  return (
    <header className="sticky top-0 z-40 bg-white border-b border-slate-200 text-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-15">
          {/* Brand Logo & Name */}
          <div
            id="brand-logo-btn"
            onClick={() => handleSelect('home')}
            className="flex items-center gap-2.5 cursor-pointer select-none"
          >
            <div className="w-8 h-8 rounded-lg bg-emerald-700 flex items-center justify-center text-white">
              <Volume2 className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-base tracking-tight text-slate-900">
                  AfriVoice Studio
                </span>
                <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                  African Speech
                </span>
              </div>
              <p className="text-[11px] text-slate-500 hidden sm:block">
                Hausa · Igbo · Yoruba · Multilingual Audio
              </p>
            </div>
          </div>

          {/* Desktop Navigation */}
          <nav className="hidden xl:flex items-center gap-1">
            {navItems.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  id={`nav-link-${item.id}`}
                  onClick={() => handleSelect(item.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    isActive
                      ? 'bg-slate-100 text-slate-900 border border-slate-200 font-semibold'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                  }`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                  {item.badge && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-emerald-700 text-white font-semibold">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Provider Status Indicators */}
          <div className="hidden md:flex items-center gap-2.5">
            <div
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border ${
                providerStatus.saharaConfigured
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-slate-50 border-slate-200 text-slate-600'
              }`}
            >
              {providerStatus.saharaConfigured ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 text-slate-400" />
              )}
              <span>Sahara {providerStatus.saharaConfigured ? 'Ready' : 'Mock/Local'}</span>
            </div>

            <div
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border ${
                providerStatus.geminiConfigured
                  ? 'bg-blue-50 border-blue-200 text-blue-800'
                  : 'bg-slate-50 border-slate-200 text-slate-600'
              }`}
            >
              {providerStatus.geminiConfigured ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-blue-700" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 text-slate-400" />
              )}
              <span>Gemini {providerStatus.geminiConfigured ? 'Ready' : 'Local'}</span>
            </div>

            <button
              id="cta-create-voice-nav"
              onClick={() => handleSelect('generator')}
              className="bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium px-3 py-1.5 rounded-md transition-colors"
            >
              Generate Voice
            </button>
          </div>

          {/* Mobile Hamburger Button */}
          <div className="flex xl:hidden items-center gap-2">
            <button
              id="mobile-menu-toggle"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-1.5 rounded-md text-slate-600 hover:text-slate-900 hover:bg-slate-100"
              aria-label="Toggle Navigation Menu"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="xl:hidden bg-white border-b border-slate-200 px-4 pt-2 pb-4 space-y-1">
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                id={`mobile-nav-${item.id}`}
                onClick={() => handleSelect(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-sm font-medium ${
                  isActive
                    ? 'bg-slate-100 text-slate-900 font-semibold'
                    : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  {item.icon}
                  <span>{item.label}</span>
                </div>
                {item.badge && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-700 text-white font-semibold">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}

          <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
            <span>Sahara: {providerStatus.saharaConfigured ? 'Ready' : 'Local'}</span>
            <span>Gemini: {providerStatus.geminiConfigured ? 'Ready' : 'Local'}</span>
          </div>
        </div>
      )}
    </header>
  );
};
