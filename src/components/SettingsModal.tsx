import React, { useState, useEffect } from 'react';
import { HologramConfig, PersonalityArchetype } from '../types/hologram';
import { voiceService } from '../services/voiceService';
import {
  offlineModelService,
  OfflineModelDiagnostics,
  RECOMMENDED_OFFLINE_MODEL,
} from '../services/offlineModelService';
import {
  X,
  Smartphone,
  Sparkles,
  Volume2,
  VolumeX,
  Eye,
  Cpu,
  BrainCircuit,
  ShieldAlert,
  Wifi,
  WifiOff,
  Download,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  AlertCircle,
} from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: HologramConfig;
  onChangeConfig: (newConfig: Partial<HologramConfig>) => void;
  onClearHistory?: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  config,
  onChangeConfig,
  onClearHistory,
}) => {
  const [offlineDiag, setOfflineDiag] = useState<OfflineModelDiagnostics>(
    offlineModelService.getDiagnostics()
  );
  const [showDownloadConfirm, setShowDownloadConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    const unsub = offlineModelService.subscribe((diag) => {
      setOfflineDiag(diag);
    });
    return unsub;
  }, []);

  if (!isOpen) return null;

  const handleToggleOfflineMode = () => {
    const nextState = !offlineDiag.offlineModeEnabled;
    offlineModelService.setOfflineModeEnabled(nextState);
  };

  const handleProceedDownload = async () => {
    setShowDownloadConfirm(false);
    await offlineModelService.startModelDownload();
  };

  const handleProceedDelete = async () => {
    setShowDeleteConfirm(false);
    await offlineModelService.deleteModelFiles();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in">
      <div className="w-full max-w-lg bg-[#0a0b12] border border-white/20 rounded-2xl p-6 text-neutral-200 shadow-2xl relative max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-neutral-400 hover:text-white rounded-full hover:bg-neutral-800/60 transition"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center space-x-3 mb-6 pb-4 border-b border-white/10">
          <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/30 flex items-center justify-center text-white shadow-md">
            <Cpu className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white tracking-wide flex items-center space-x-2">
              <span>SHADOW AI CORE CONFIG</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/15 text-white border border-white/30">
                PRO v2.5
              </span>
            </h2>
            <p className="text-xs text-slate-300 font-mono">
              Hardware: Galaxy F55 5G • White Energy Core Architecture
            </p>
          </div>
        </div>

        <div className="space-y-6">
          {/* Section: Gemini Cognitive Engine */}
          <div className="space-y-3">
            <div className="flex items-center space-x-2 text-xs font-mono font-bold text-slate-200 tracking-wider">
              <BrainCircuit className="w-4 h-4 text-white" />
              <span>COGNITIVE ENGINE DUAL-MODE</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => onChangeConfig({ intelligenceMode: 'standard' })}
                className={`p-3 rounded-xl border text-left transition-all ${
                  config.intelligenceMode === 'standard'
                    ? 'border-white bg-white/15 ring-1 ring-white shadow-lg shadow-white/10'
                    : 'border-neutral-800 bg-neutral-900/60 hover:border-neutral-700'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-white">Standard Flash</span>
                  <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-white/20 text-white">
                    LOW LATENCY
                  </span>
                </div>
                <p className="text-[11px] text-neutral-400">
                  Powered by <span className="font-mono text-slate-200">gemini-3.8-flash</span>. Fast, conversational, fluid responses.
                </p>
              </button>

              <button
                type="button"
                onClick={() => onChangeConfig({ intelligenceMode: 'serious' })}
                className={`p-3 rounded-xl border text-left transition-all ${
                  config.intelligenceMode === 'serious'
                    ? 'border-white bg-white/15 ring-1 ring-white shadow-lg shadow-white/10'
                    : 'border-neutral-800 bg-neutral-900/60 hover:border-neutral-700'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-white flex items-center space-x-1">
                    <ShieldAlert className="w-3.5 h-3.5 text-white" />
                    <span>Serious Mode</span>
                  </span>
                  <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-white/20 text-white">
                    DEEP PRO
                  </span>
                </div>
                <p className="text-[11px] text-neutral-400">
                  Powered by <span className="font-mono text-white">gemini-4-argon</span>. Rigorous reasoning, tactical analysis, intensified energy flare.
                </p>
              </button>
            </div>
          </div>

          {/* Section: Optional Offline Mode & On-Device AI */}
          <div className="p-4 rounded-xl border border-neutral-800 bg-neutral-900/40 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className={`p-1.5 rounded-lg border ${offlineDiag.offlineModeEnabled ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400' : 'bg-neutral-800 border-neutral-700 text-neutral-400'}`}>
                  {offlineDiag.offlineModeEnabled ? <WifiOff className="w-4 h-4" /> : <Wifi className="w-4 h-4" />}
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <p className="text-sm font-medium text-neutral-200">Optional Offline Mode</p>
                    <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-white/10 text-slate-300 border border-white/15">
                      {offlineDiag.offlineModeEnabled ? 'ACTIVE' : 'ONLINE DEFAULT'}
                    </span>
                  </div>
                  <p className="text-xs text-neutral-400">
                    Run local on-device AI inference without an internet connection
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleToggleOfflineMode}
                className={`w-12 h-6 rounded-full transition-colors relative ${
                  offlineDiag.offlineModeEnabled ? 'bg-white' : 'bg-neutral-700'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full transition-transform ${
                    offlineDiag.offlineModeEnabled ? 'bg-black transform translate-x-6' : 'bg-white'
                  }`}
                />
              </button>
            </div>

            {/* Capabilities Summary */}
            <div className="grid grid-cols-2 gap-2 text-[11px] font-mono bg-black/40 p-2.5 rounded-xl border border-white/5">
              <div className="space-y-1">
                <span className="text-emerald-400 font-bold flex items-center space-x-1">
                  <Wifi className="w-3 h-3 inline" /> <span>Online Mode</span>
                </span>
                <p className="text-[10px] text-neutral-400">Gemini 3.8 Flash, Serious Mode, Studio Charon TTS, Cloud Sync.</p>
              </div>
              <div className="space-y-1 border-l border-white/10 pl-2">
                <span className="text-cyan-400 font-bold flex items-center space-x-1">
                  <WifiOff className="w-3 h-3 inline" /> <span>Offline Mode</span>
                </span>
                <p className="text-[10px] text-neutral-400">On-Device SmolLM2 (368MB), local voice, local history & memories.</p>
              </div>
            </div>

            {/* Local Model Card */}
            <div className="border border-neutral-800 rounded-xl p-3 bg-neutral-950/60 space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-bold text-white font-mono">{RECOMMENDED_OFFLINE_MODEL.name}</span>
                    <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-neutral-800 text-neutral-300">
                      {RECOMMENDED_OFFLINE_MODEL.format}
                    </span>
                  </div>
                  <p className="text-[10px] text-neutral-400 mt-0.5">
                    Download: <span className="text-slate-200 font-mono">368 MB</span> • Storage: <span className="text-slate-200 font-mono">~460 MB</span> • License: <span className="text-emerald-300 font-mono">Apache 2.0</span>
                  </p>
                </div>
                <div>
                  {offlineDiag.installationStatus === 'READY' ? (
                    <span className="inline-flex items-center space-x-1 text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                      <span>Ready</span>
                    </span>
                  ) : offlineDiag.installationStatus === 'DOWNLOADING' ? (
                    <span className="inline-flex items-center space-x-1 text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 animate-pulse">
                      <Loader2 className="w-3 h-3 animate-spin text-cyan-400" />
                      <span>Downloading</span>
                    </span>
                  ) : offlineDiag.installationStatus === 'VERIFYING' ? (
                    <span className="inline-flex items-center space-x-1 text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/30">
                      <Loader2 className="w-3 h-3 animate-spin text-amber-400" />
                      <span>Verifying</span>
                    </span>
                  ) : offlineDiag.installationStatus === 'DELETING' ? (
                    <span className="inline-flex items-center space-x-1 text-[10px] font-mono px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-300 border border-rose-500/30 animate-pulse">
                      <Loader2 className="w-3 h-3 animate-spin text-rose-400" />
                      <span>Deleting</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center space-x-1 text-[10px] font-mono px-2 py-0.5 rounded-full bg-neutral-800 text-neutral-400 border border-neutral-700">
                      <span>Not Installed</span>
                    </span>
                  )}
                </div>
              </div>

              {/* Progress bar during download */}
              {offlineDiag.installationStatus === 'DOWNLOADING' && offlineDiag.downloadProgress && (
                <div className="space-y-1.5 pt-1">
                  <div className="flex justify-between text-[10px] font-mono text-neutral-400">
                    <span>{offlineDiag.downloadProgress.phase === 'verifying' ? 'Verifying model checksum...' : `Downloading... ${offlineDiag.downloadProgress.percentage}%`}</span>
                    <span>{Math.round(offlineDiag.downloadProgress.loadedBytes / (1024 * 1024))} / {Math.round(offlineDiag.downloadProgress.totalBytes / (1024 * 1024))} MB ({offlineDiag.downloadProgress.speedKbps} KB/s)</span>
                  </div>
                  <div className="w-full bg-neutral-800 h-2 rounded-full overflow-hidden">
                    <div
                      className="bg-cyan-400 h-full rounded-full transition-all duration-200"
                      style={{ width: `${offlineDiag.downloadProgress.percentage}%` }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => offlineModelService.cancelDownload()}
                    className="text-[11px] font-mono text-rose-400 hover:text-rose-300 transition"
                  >
                    Cancel Download
                  </button>
                </div>
              )}

              {/* Error detail */}
              {offlineDiag.lastError && (
                <div className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-[11px] text-rose-300 flex items-start space-x-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                  <span>{offlineDiag.lastError}</span>
                </div>
              )}

              {/* Action buttons */}
              <div className="pt-1 flex items-center space-x-2">
                {offlineDiag.installationStatus === 'NOT_INSTALLED' && (
                  <button
                    type="button"
                    onClick={() => setShowDownloadConfirm(true)}
                    className="w-full py-2 px-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-mono text-xs font-bold transition flex items-center justify-center space-x-2 shadow-md shadow-cyan-900/30"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download On-Device Model (368 MB)</span>
                  </button>
                )}

                {offlineDiag.installationStatus === 'ERROR' && (
                  <button
                    type="button"
                    onClick={() => setShowDownloadConfirm(true)}
                    className="w-full py-2 px-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-mono text-xs font-bold transition flex items-center justify-center space-x-2"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Retry Download</span>
                  </button>
                )}

                {offlineDiag.installationStatus === 'READY' && (
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(true)}
                    className="py-1.5 px-3 rounded-xl border border-rose-500/30 hover:border-rose-500/60 bg-rose-500/10 text-rose-300 hover:text-rose-200 font-mono text-xs transition flex items-center space-x-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete Model Files (Free ~460 MB)</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Section: Personality Archetype */}
          <div className="space-y-2">
            <label className="text-xs font-mono font-bold text-neutral-300 block">
              SHADOW PERSONALITY ARCHETYPE
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'sci-fi-companion', label: 'Sci-Fi Companion', desc: 'Calm, sharp, articulate' },
                { id: 'tactical', label: 'Tactical Strategic', desc: 'Rigorous action items' },
                { id: 'concise', label: 'Concise Telemetry', desc: '1-2 sharp sentences' },
              ].map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onChangeConfig({ personalityArchetype: p.id as PersonalityArchetype })}
                  className={`p-2.5 rounded-xl border text-left transition ${
                    config.personalityArchetype === p.id
                      ? 'border-white bg-white/15 text-white shadow-sm'
                      : 'border-neutral-800 bg-neutral-900/50 text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  <p className="text-xs font-bold leading-tight">{p.label}</p>
                  <p className="text-[10px] text-neutral-400 mt-0.5">{p.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Section: Voice & Speech Synthesis */}
          <div className="p-4 rounded-xl border border-neutral-800 bg-neutral-900/40 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Volume2 className="w-4 h-4 text-white" />
                <div>
                  <p className="text-sm font-medium text-neutral-200">Vocal Synthesizer (TTS)</p>
                  <p className="text-xs text-neutral-400">Read Shadow responses aloud with voice</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onChangeConfig({ speechOutputEnabled: !config.speechOutputEnabled })}
                className={`w-12 h-6 rounded-full transition-colors relative ${
                  config.speechOutputEnabled ? 'bg-white' : 'bg-neutral-700'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full transition-transform ${
                    config.speechOutputEnabled ? 'bg-black transform translate-x-6' : 'bg-white'
                  }`}
                />
              </button>
            </div>

            {config.speechOutputEnabled && (
              <div className="pt-3 space-y-3 border-t border-neutral-800/80">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-mono font-bold text-neutral-300">
                      NEURAL VOICE MODEL (24kHz STUDIO)
                    </label>
                    <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/30">
                      Gemini Neural TTS (Online) / WebSpeech (Offline)
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { id: 'Charon', name: 'Charon', desc: 'Deep, calm cinematic male (SHADOW AI)', badge: 'Recommended' },
                      { id: 'Fenrir', name: 'Fenrir', desc: 'Deep authoritative tactical male', badge: 'Tactical' },
                      { id: 'Zephyr', name: 'Zephyr', desc: 'Composed, clear, natural pacing', badge: 'Composed' },
                      { id: 'Puck', name: 'Puck', desc: 'Agile conversational delivery', badge: 'Conversational' },
                    ].map((v) => (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => {
                          onChangeConfig({ ttsVoice: v.id as any });
                          voiceService.setVoice(v.id);
                        }}
                        className={`p-2.5 rounded-xl border text-left transition ${
                          (config.ttsVoice || 'Charon') === v.id
                            ? 'border-white bg-white/15 text-white ring-1 ring-white/40 shadow-sm'
                            : 'border-neutral-800 bg-neutral-900/50 text-neutral-400 hover:text-neutral-200'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-xs font-bold text-white">{v.name}</span>
                          <span className={`text-[9px] font-mono px-1 rounded ${v.id === 'Charon' ? 'bg-amber-400/20 text-amber-300 border border-amber-400/30' : 'bg-white/10 text-slate-300'}`}>
                            {v.badge}
                          </span>
                        </div>
                        <p className="text-[10px] text-neutral-400 leading-tight">{v.desc}</p>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-1">
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-neutral-400">Conversational Pacing</span>
                      <span className="text-white font-mono">{config.speechRate.toFixed(2)}x</span>
                    </div>
                    <input
                      type="range"
                      min="0.9"
                      max="1.15"
                      step="0.05"
                      value={config.speechRate}
                      onChange={(e) => onChangeConfig({ speechRate: parseFloat(e.target.value) })}
                      className="w-full accent-white bg-neutral-800 rounded-lg cursor-pointer h-1.5"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-neutral-400">Acoustic Pitch</span>
                      <span className="text-white font-mono">{config.speechPitch.toFixed(2)}x</span>
                    </div>
                    <input
                      type="range"
                      min="0.9"
                      max="1.1"
                      step="0.05"
                      value={config.speechPitch}
                      onChange={(e) => onChangeConfig({ speechPitch: parseFloat(e.target.value) })}
                      className="w-full accent-white bg-neutral-800 rounded-lg cursor-pointer h-1.5"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Section: Hardware Display & Performance (Samsung Galaxy F55) */}
          <div className="space-y-4">
            <div className="flex items-center space-x-2 text-xs font-mono font-bold text-neutral-300 tracking-wider">
              <Smartphone className="w-4 h-4 text-white" />
              <span>GALAXY F55 HARDWARE &amp; 3D ENGINE</span>
            </div>

            {/* Refresh rate */}
            <div className="flex items-center justify-between pb-3 border-b border-neutral-800/80">
              <div>
                <p className="text-sm font-medium text-neutral-200">120Hz Super AMOLED Target</p>
                <p className="text-xs text-neutral-400">High-efficiency 120 FPS rendering on Galaxy F55</p>
              </div>
              <button
                type="button"
                onClick={() => onChangeConfig({ fpsTarget: config.fpsTarget === 120 ? 60 : 120 })}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition ${
                  config.fpsTarget === 120
                    ? 'bg-white text-black shadow-lg shadow-white/20'
                    : 'bg-neutral-800 text-neutral-300'
                }`}
              >
                {config.fpsTarget} FPS
              </button>
            </div>

            {/* Wireframe Mode */}
            <div className="flex items-center justify-between pb-3 border-b border-neutral-800/80">
              <div className="flex items-center space-x-2">
                <Eye className="w-4 h-4 text-white" />
                <div>
                  <p className="text-sm font-medium text-neutral-200">Polygonal Wireframe Mode</p>
                  <p className="text-xs text-neutral-400">Inspect energy network tessellation vertices</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onChangeConfig({ wireframe: !config.wireframe })}
                className={`w-12 h-6 rounded-full transition-colors relative ${
                  config.wireframe ? 'bg-white' : 'bg-neutral-700'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full transition-transform ${
                    config.wireframe ? 'bg-black transform translate-x-6' : 'bg-white'
                  }`}
                />
              </button>
            </div>

            {/* Audio Resonator */}
            <div className="flex items-center justify-between pb-3 border-b border-neutral-800/80">
              <div className="flex items-center space-x-2">
                {config.soundEnabled ? (
                  <Volume2 className="w-4 h-4 text-white" />
                ) : (
                  <VolumeX className="w-4 h-4 text-neutral-500" />
                )}
                <div>
                  <p className="text-sm font-medium text-neutral-200">Hologram Audio Resonator</p>
                  <p className="text-xs text-neutral-400">Procedural Web Audio tactile feedback</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onChangeConfig({ soundEnabled: !config.soundEnabled })}
                className={`w-12 h-6 rounded-full transition-colors relative ${
                  config.soundEnabled ? 'bg-white' : 'bg-neutral-700'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full transition-transform ${
                    config.soundEnabled ? 'bg-black transform translate-x-6' : 'bg-white'
                  }`}
                />
              </button>
            </div>

            {/* Bloom intensity */}
            <div>
              <div className="flex justify-between text-xs mb-1.5">
                <span className="flex items-center space-x-1 text-neutral-300">
                  <Sparkles className="w-3.5 h-3.5 text-white" />
                  <span>White Energy Core Bloom Glow</span>
                </span>
                <span className="text-white font-mono">{config.bloomIntensity.toFixed(1)}x</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="2.0"
                step="0.1"
                value={config.bloomIntensity}
                onChange={(e) => onChangeConfig({ bloomIntensity: parseFloat(e.target.value) })}
                className="w-full accent-white bg-neutral-800 rounded-lg cursor-pointer h-1.5"
              />
            </div>

            {/* Rotation speed */}
            <div>
              <div className="flex justify-between text-xs mb-1.5">
                <span className="text-neutral-300">Touch Drag Rotation Sensitivity</span>
                <span className="text-white font-mono">{config.rotationSpeedMultiplier.toFixed(1)}x</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="2.0"
                step="0.1"
                value={config.rotationSpeedMultiplier}
                onChange={(e) => onChangeConfig({ rotationSpeedMultiplier: parseFloat(e.target.value) })}
                className="w-full accent-white bg-neutral-800 rounded-lg cursor-pointer h-1.5"
              />
            </div>
          </div>

          {/* Session Clear */}
          {onClearHistory && (
            <div className="pt-2">
              <button
                type="button"
                onClick={onClearHistory}
                className="w-full py-2 rounded-xl border border-neutral-800 hover:border-neutral-600 bg-neutral-900/40 text-neutral-400 hover:text-white text-xs font-mono transition"
              >
                Clear Conversation Memory &amp; Cognitive Cache
              </button>
            </div>
          )}
        </div>

        <button
          onClick={onClose}
          className="mt-6 w-full py-2.5 bg-white text-black font-semibold text-sm rounded-xl hover:bg-slate-200 transition shadow-lg shadow-white/10"
        >
          Confirm &amp; Apply
        </button>

        {/* Modal: Confirm Model Download */}
        {showDownloadConfirm && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/90 backdrop-blur-md">
            <div className="w-full max-w-sm bg-[#0c0d16] border border-cyan-500/40 rounded-2xl p-5 shadow-2xl space-y-4">
              <div className="flex items-center space-x-2.5 text-cyan-400">
                <Download className="w-5 h-5" />
                <h3 className="text-sm font-bold tracking-wide font-mono">CONFIRM MODEL DOWNLOAD</h3>
              </div>
              <p className="text-xs text-neutral-300 leading-relaxed">
                You are about to download the <strong className="text-white">{RECOMMENDED_OFFLINE_MODEL.name}</strong> on-device AI model.
              </p>
              <div className="bg-black/50 p-2.5 rounded-xl border border-white/10 text-[11px] font-mono space-y-1">
                <div className="flex justify-between">
                  <span className="text-neutral-400">Download Size:</span>
                  <span className="text-white font-bold">~368 MB</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-400">Storage Required:</span>
                  <span className="text-white">~460 MB</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-400">License:</span>
                  <span className="text-emerald-300">Apache 2.0</span>
                </div>
              </div>
              <p className="text-[11px] text-neutral-400">
                Online Mode will continue working normally if you cancel or decline. Model files can be removed at any time.
              </p>
              <div className="flex items-center space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowDownloadConfirm(false)}
                  className="flex-1 py-2 rounded-xl border border-neutral-700 hover:border-neutral-500 bg-neutral-900 text-neutral-300 text-xs font-mono"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleProceedDownload}
                  className="flex-1 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-mono text-xs font-bold transition shadow-md shadow-cyan-900/40"
                >
                  Download (368 MB)
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal: Confirm Model Deletion */}
        {showDeleteConfirm && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/90 backdrop-blur-md">
            <div className="w-full max-w-sm bg-[#0c0d16] border border-rose-500/40 rounded-2xl p-5 shadow-2xl space-y-4">
              <div className="flex items-center space-x-2.5 text-rose-400">
                <AlertCircle className="w-5 h-5" />
                <h3 className="text-sm font-bold tracking-wide font-mono">DELETE LOCAL MODEL FILES?</h3>
              </div>
              <p className="text-xs text-neutral-300 leading-relaxed">
                This will delete the local AI model files and free approximately <strong className="text-white">460 MB</strong> of device storage.
              </p>
              <p className="text-[11px] text-amber-300 bg-amber-500/10 p-2 rounded-lg border border-amber-500/20">
                Your conversations, memories, and settings will NOT be deleted. You will need to download the model again to use offline AI in the future.
              </p>
              <div className="flex items-center space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1 py-2 rounded-xl border border-neutral-700 hover:border-neutral-500 bg-neutral-900 text-neutral-300 text-xs font-mono"
                >
                  Keep Model
                </button>
                <button
                  type="button"
                  onClick={handleProceedDelete}
                  className="flex-1 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-mono text-xs font-bold transition shadow-md shadow-rose-900/40"
                >
                  Delete Files
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
