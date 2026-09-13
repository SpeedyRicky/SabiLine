import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, RotateCcw, Download, Volume2, VolumeX } from 'lucide-react';

interface AudioWaveformPlayerProps {
  audioBase64?: string;
  audioUrl?: string;
  mimeType?: string;
  title?: string;
  language?: string;
  provider?: string;
  durationSec?: number;
  onDownload?: () => void;
  autoPlay?: boolean;
}

export const AudioWaveformPlayer: React.FC<AudioWaveformPlayerProps> = ({
  audioBase64,
  audioUrl,
  mimeType = 'audio/wav',
  title = 'Synthesized Healthcare Speech',
  language,
  provider,
  durationSec = 5,
  autoPlay = false,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(durationSec);
  const [volume, setVolume] = useState(1.0);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [resolvedSrc, setResolvedSrc] = useState<string>('');

  // Pre-generate a deterministic pseudo-random waveform bar height pattern
  const waveformBars = useRef<number[]>(
    Array.from({ length: 48 }, (_, i) => {
      const v = Math.sin(i * 0.35) * 0.35 + Math.cos(i * 0.8) * 0.25 + 0.4;
      return Math.max(0.15, Math.min(1.0, v));
    })
  ).current;

  useEffect(() => {
    let objectUrl: string | null = null;
    if (audioBase64) {
      const byteChars = atob(audioBase64);
      const byteNumbers = new Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) {
        byteNumbers[i] = byteChars.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: mimeType });
      objectUrl = URL.createObjectURL(blob);
      setResolvedSrc(objectUrl);
    } else if (audioUrl) {
      setResolvedSrc(audioUrl);
    }

    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [audioBase64, audioUrl, mimeType]);

  useEffect(() => {
    if (resolvedSrc && autoPlay && audioRef.current) {
      audioRef.current.play().catch(() => {
        // Browser autoplay restrictions may prevent playback
      });
    }
  }, [resolvedSrc, autoPlay]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
      if (audioRef.current.duration && !isNaN(audioRef.current.duration)) {
        setTotalDuration(audioRef.current.duration);
      }
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const target = Number(e.target.value);
    setCurrentTime(target);
    if (audioRef.current) {
      audioRef.current.currentTime = target;
    }
  };

  const handleRestart = () => {
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVol = Number(e.target.value);
    setVolume(newVol);
    setIsMuted(newVol === 0);
    if (audioRef.current) {
      audioRef.current.volume = newVol;
    }
  };

  const toggleMute = () => {
    if (audioRef.current) {
      const nextMute = !isMuted;
      setIsMuted(nextMute);
      audioRef.current.muted = nextMute;
    }
  };

  const cyclePlaybackRate = () => {
    const rates = [0.85, 1.0, 1.25, 1.5];
    const nextIdx = (rates.indexOf(playbackRate) + 1) % rates.length;
    const nextRate = rates[nextIdx];
    setPlaybackRate(nextRate);
    if (audioRef.current) {
      audioRef.current.playbackRate = nextRate;
    }
  };

  const downloadAudio = () => {
    if (!resolvedSrc) return;
    const link = document.createElement('a');
    link.href = resolvedSrc;
    const safeTitle = (title || 'afrivoice-speech').toLowerCase().replace(/[^a-z0-9]/g, '-');
    link.download = `${safeTitle}-${Date.now()}.wav`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const formatTime = (secs: number) => {
    if (isNaN(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const progressPercent = totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0;

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-xs text-slate-800">
      {/* Hidden Native Audio Element */}
      {resolvedSrc && (
        <audio
          ref={audioRef}
          src={resolvedSrc}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => {
            setIsPlaying(false);
            setCurrentTime(0);
          }}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={() => {
            if (audioRef.current?.duration) {
              setTotalDuration(audioRef.current.duration);
            }
          }}
        />
      )}

      {/* Header Info */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold text-slate-900 truncate">{title}</h4>
          <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
            {language && <span className="uppercase font-semibold text-emerald-700">{language}</span>}
            {provider && <span className="text-slate-300">·</span>}
            {provider && <span className="capitalize">{provider}</span>}
            <span className="text-slate-300">·</span>
            <span>24 kHz WAV</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={cyclePlaybackRate}
            className="text-xs font-medium px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
            title="Adjust playback speed"
          >
            {playbackRate}x
          </button>

          <button
            id="download-audio-btn"
            onClick={downloadAudio}
            disabled={!resolvedSrc}
            className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 transition-colors disabled:opacity-50"
            title="Download audio file"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download</span>
          </button>
        </div>
      </div>

      {/* Waveform Visualizer */}
      <div
        className="relative h-12 bg-slate-50 rounded p-2 flex items-center justify-between gap-1 overflow-hidden cursor-pointer group mb-3 border border-slate-200"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const clickX = e.clientX - rect.left;
          const ratio = clickX / rect.width;
          const newTime = ratio * totalDuration;
          setCurrentTime(newTime);
          if (audioRef.current) {
            audioRef.current.currentTime = newTime;
          }
        }}
      >
        {waveformBars.map((heightFactor, idx) => {
          const barPercent = (idx / waveformBars.length) * 100;
          const isPassed = barPercent <= progressPercent;
          return (
            <div
              key={idx}
              className="flex-1 rounded-sm transition-all duration-75"
              style={{
                height: `${Math.max(14, heightFactor * 100)}%`,
                backgroundColor: isPassed ? '#1e293b' : '#cbd5e1',
              }}
            />
          );
        })}

        {/* Playhead line indicator */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-slate-900 pointer-events-none transition-all duration-75"
          style={{ left: `${progressPercent}%` }}
        />
      </div>

      {/* Progress Slider & Timestamps */}
      <div className="space-y-1 mb-3">
        <input
          type="range"
          min={0}
          max={totalDuration || 1}
          step={0.01}
          value={currentTime}
          onChange={handleSeek}
          className="w-full h-1.5 bg-slate-200 rounded appearance-none cursor-pointer accent-slate-800"
          aria-label="Seek audio"
        />
        <div className="flex justify-between text-xs text-slate-500 font-mono">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(totalDuration)}</span>
        </div>
      </div>

      {/* Controls Bar */}
      <div className="flex items-center justify-between pt-1 border-t border-slate-100">
        <div className="flex items-center gap-3">
          <button
            id="play-pause-btn"
            onClick={togglePlay}
            disabled={!resolvedSrc}
            className="w-9 h-9 rounded-full bg-slate-900 hover:bg-slate-800 text-white flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-xs"
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current translate-x-0.5" />}
          </button>

          <button
            onClick={handleRestart}
            disabled={!resolvedSrc}
            className="p-1.5 text-slate-500 hover:text-slate-800 rounded transition-colors"
            title="Replay from start"
            aria-label="Replay"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>

        {/* Volume Control */}
        <div className="flex items-center gap-2">
          <button
            onClick={toggleMute}
            className="text-slate-500 hover:text-slate-800 p-1 rounded transition-colors"
            title={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted || volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={isMuted ? 0 : volume}
            onChange={handleVolumeChange}
            className="w-16 h-1 bg-slate-200 rounded appearance-none cursor-pointer accent-slate-700"
            aria-label="Audio volume"
          />
        </div>
      </div>
    </div>
  );
};
