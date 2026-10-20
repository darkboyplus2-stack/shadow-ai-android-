import React from 'react';
import { HologramConfig, PersonalityArchetype } from '../types/hologram';
import { voiceService } from '../services/voiceService';
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
  if (!isOpen) return null;

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
                      Gemini Neural TTS
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
      </div>
    </div>
  );
};
