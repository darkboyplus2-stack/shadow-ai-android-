import React, { useState, useEffect, useRef } from 'react';
import {
  HologramState,
  HologramConfig,
  ChatMessage,
  IntelligenceMode,
} from '../types/hologram';
import { Hologram3D } from './Hologram3D';
import { SettingsModal } from './SettingsModal';
import { DiagnosticsModal } from './DiagnosticsModal';
import { MemoryDrawer } from './MemoryDrawer';
import { AuthModal } from './AuthModal';
import { SessionsDrawer } from './SessionsDrawer';
import { FormattedMessage } from './FormattedMessage';
import { TypingIndicator } from './TypingIndicator';
import { soundFx } from '../services/soundFx';
import { geminiService, GeminiServiceError, VisualAttachment } from '../services/geminiService';
import { voiceService, MicStatus, SpeechLanguage } from '../services/voiceService';
import { memoryService, MemoryDocument } from '../services/memoryService';
import { authService, UserProfile } from '../services/authService';
import { sessionService, ChatSession } from '../services/sessionService';
import {
  Mic,
  MicOff,
  Send,
  RotateCcw,
  Settings,
  Smartphone,
  Maximize2,
  FolderCode,
  Info,
  ShieldAlert,
  MessageSquare,
  ChevronDown,
  Zap,
  Bot,
  User,
  Clock,
  AlertCircle,
  X,
  Loader2,
  Check,
  Languages,
  ExternalLink,
  Activity,
  Brain,
  LogIn,
  Paperclip,
} from 'lucide-react';

interface ShadowInterfaceProps {
  onOpenAndroidHub: () => void;
}

const QUICK_PROMPTS = [
  'How does an orbital gyroscope work?',
  'Sab kaisa chal raha hai, Shadow?',
  'Explain quantum superposition simply',
  'Help me design a clean Android UI',
];

export const ShadowInterface: React.FC<ShadowInterfaceProps> = ({ onOpenAndroidHub }) => {
  const [state, setState] = useState<HologramState>('IDLE');
  const [chatInput, setChatInput] = useState('');
  const [lastFailedPrompt, setLastFailedPrompt] = useState<string | null>(null);
  const [resetCounter, setResetCounter] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [isPhoneFrame, setIsPhoneFrame] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [audioAmplitude, setAudioAmplitude] = useState<number>(0);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [micStatus, setMicStatus] = useState<MicStatus>('idle');
  const [speechLanguage, setSpeechLanguage] = useState<SpeechLanguage>('en-IN');
  const [interimTranscript, setInterimTranscript] = useState<string>('');
  const [, setIsVoiceSpeaking] = useState(false);
  const [showPermissionGuide, setShowPermissionGuide] = useState(false);
  const [showMemoryDrawer, setShowMemoryDrawer] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showSessionsDrawer, setShowSessionsDrawer] = useState(false);
  const [activeSession, setActiveSession] = useState<ChatSession | null>(null);
  const [attachedImage, setAttachedImage] = useState<VisualAttachment | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [memoryCount, setMemoryCount] = useState<number>(0);
  const [syncStatus, setSyncStatus] = useState<string>('guest');
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);

  // Chat message history with a natural, intelligent conversational greeting
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'init-1',
      sender: 'shadow',
      text: 'Hello! I am Shadow, your AI assistant. How can I help you today? Feel free to speak in English, Hindi, or Hinglish.',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      modelUsed: 'gemini-3.8-flash',
    },
  ]);

  // Hologram settings state
  const [config, setConfig] = useState<HologramConfig>({
    fpsTarget: 60,
    bloomIntensity: 1.2,
    wireframe: false,
    soundEnabled: true,
    rotationSpeedMultiplier: 1.0,
    particleCount: 160,
    intelligenceMode: 'standard',
    personalityArchetype: 'sci-fi-companion',
    speechOutputEnabled: true,
    speechRate: 1.0,
    speechPitch: 1.0,
    ttsVoice: 'Charon',
  });

  const chatScrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isSendingPromptRef = useRef(false);
  const [isAiResponding, setIsAiResponding] = useState<boolean>(false);

  // Auto-scroll chat to bottom when messages or typing state changes
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages, isDrawerOpen, isAiResponding]);

  // Subscribe to long-term memory updates and auth profile
  useEffect(() => {
    const unsubMem = memoryService.subscribe((list) => {
      setMemoryCount(list.length);
      setSyncStatus(memoryService.getSyncStatus());
    });

    const unsubAuth = authService.onAuthStateChanged((u) => {
      setUserProfile(u);
      setSyncStatus(memoryService.getSyncStatus());
    });

    const handleMemorySaved = (e: any) => {
      const saved = e.detail as MemoryDocument;
      if (saved && saved.content) {
        showToast(`Memory formed: "${saved.content.slice(0, 36)}${saved.content.length > 36 ? '…' : ''}"`);
      }
    };
    window.addEventListener('shadow:memory-saved', handleMemorySaved as EventListener);

    return () => {
      unsubMem();
      unsubAuth();
      window.removeEventListener('shadow:memory-saved', handleMemorySaved as EventListener);
    };
  }, []);

  // Synchronize conversation threads
  useEffect(() => {
    const unsubSessions = sessionService.subscribe((list, activeId) => {
      const active = list.find((s) => s.id === activeId) || list[0] || null;
      setActiveSession(active);
      if (active && active.messages.length > 0) {
        setMessages(active.messages);
      }
    });
    return () => unsubSessions();
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 8 * 1024 * 1024) {
      showToast('File size exceeds 8MB limit.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (loadEvt) => {
      const result = loadEvt.target?.result as string;
      if (result) {
        setAttachedImage({
          data: result,
          mimeType: file.type || 'image/jpeg',
          filename: file.name,
          previewUrl: result,
        });
        showToast(`Attached visual: ${file.name}`);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.indexOf('image') !== -1) {
        const file = item.getAsFile();
        if (file) {
          if (file.size > 8 * 1024 * 1024) {
            showToast('Pasted image exceeds 8MB limit.');
            return;
          }
          const reader = new FileReader();
          reader.onload = (loadEvt) => {
            const result = loadEvt.target?.result as string;
            if (result) {
              setAttachedImage({
                data: result,
                mimeType: file.type || 'image/png',
                filename: `Pasted_Visual_${new Date().toLocaleTimeString().replace(/:/g, '-')}.png`,
                previewUrl: result,
              });
              showToast('Pasted screenshot attached for analysis.');
            }
          };
          reader.readAsDataURL(file);
          e.preventDefault();
          break;
        }
      }
    }
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((current) => (current === msg ? null : current));
    }, 4000);
  };

  const handleStateChange = (newState: HologramState) => {
    setState(newState);
    soundFx.playStateShift(newState);
  };

  const handleResetView = () => {
    setResetCounter((prev) => prev + 1);
    soundFx.playClick(520);
    showToast('Energy core perspective reset to default orientation.');
  };

  // Toggle Serious Mode directly from header
  const handleToggleSeriousMode = () => {
    const newMode: IntelligenceMode = config.intelligenceMode === 'serious' ? 'standard' : 'serious';
    setConfig((prev) => ({ ...prev, intelligenceMode: newMode }));
    soundFx.playClick(newMode === 'serious' ? 880 : 540);
    showToast(
      newMode === 'serious'
        ? 'SERIOUS MODE ENGAGED • Gemini 4 Argon cognitive core active. Deep analytical reasoning.'
        : 'STANDARD MODE • Gemini 3.8 Flash agile conversational flow restored.'
    );
  };

  // Main chat submission handler connected to Gemini backend
  const handleSendMessage = async (textToSend?: string) => {
    voiceService.resumePlaybackContext();
    if (isSendingPromptRef.current) return;
    const promptText = (textToSend || chatInput).trim();
    if (!promptText && !attachedImage) return;
    const finalPrompt = promptText || (attachedImage ? 'Please inspect and analyze this attached image or document thoroughly.' : '');
    if (!finalPrompt) return;

    isSendingPromptRef.current = true;
    soundFx.playClick(720);
    setChatInput('');
    setInterimTranscript('');
    setMicStatus('processing');

    // Capture image attachment if any
    const visualAttachment = attachedImage;
    setAttachedImage(null);

    // Add user message to transcript
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text: finalPrompt,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      imagePreview: visualAttachment?.previewUrl,
    };

    setMessages((prev) => {
      const next = [...prev, userMsg];
      if (activeSession) {
        queueMicrotask(() => {
          sessionService.updateSessionMessages(activeSession.id, next);
        });
      }
      return next;
    });

    // Visual transition: WORKING if analyzing image, or THINKING/WORKING based on mode
    const isSerious = config.intelligenceMode === 'serious';
    setState(visualAttachment ? 'WORKING' : isSerious ? 'WORKING' : 'THINKING');
    setIsAiResponding(true);

    try {
      const response = await geminiService.sendMessage(
        promptText,
        config.intelligenceMode,
        config.personalityArchetype,
        visualAttachment
      );
      setIsAiResponding(false);

      // Successfully answered, clear last failed prompt
      setLastFailedPrompt(null);

      // Add Shadow response to transcript
      const shadowMsg: ChatMessage = {
        id: `shadow-${Date.now()}`,
        sender: 'shadow',
        text: response.reply,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        modelUsed: response.modelUsed,
        latencyMs: response.latencyMs,
        mode: response.mode,
      };

      setMessages((prev) => {
        const next = [...prev, shadowMsg];
        if (activeSession) {
          queueMicrotask(() => {
            sessionService.updateSessionMessages(activeSession.id, next);
          });
        }
        return next;
      });

      // Speak response if voice output is enabled
      if (config.speechOutputEnabled) {
        setState('SPEAKING');
        setIsVoiceSpeaking(true);

        voiceService.speak(response.reply, {
          rate: config.speechRate,
          pitch: config.speechPitch,
          voice: config.ttsVoice || 'Charon',
          onStart: () => {
            setState('SPEAKING');
            setIsVoiceSpeaking(true);
          },
          onAmplitude: (amp) => {
            setAudioAmplitude(amp);
          },
          onEnd: () => {
            setAudioAmplitude(0);
            setIsVoiceSpeaking(false);
            setState('IDLE');
            setMicStatus('idle');
          },
        });
      } else {
        // Visual pulsation fallback if voice is disabled
        setState('SPEAKING');
        setTimeout(() => {
          setState('IDLE');
          setMicStatus('idle');
        }, Math.min(Math.max(response.reply.length * 28, 1800), 5000));
      }
    } catch (err: any) {
      setIsAiResponding(false);
      console.error('[SHADOW AI Error Handler]:', err);

      const errorMessageText =
        err instanceof GeminiServiceError
          ? err.userMessage
          : err?.message && !err.message.includes('{')
          ? err.message
          : "The AI service is experiencing a temporary issue. Please tap Retry.";

      const errorCode = err instanceof GeminiServiceError ? err.code : 'CLIENT_ERROR';
      const errorDetail = err instanceof GeminiServiceError ? err.detail : undefined;

      setLastFailedPrompt(promptText);

      // Append clean, honest error message to transcript with retry support
      const errorMsg: ChatMessage = {
        id: `error-${Date.now()}`,
        sender: 'shadow',
        text: errorMessageText,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        isError: true,
        canRetry: true,
        failedPrompt: promptText,
        errorCode,
        errorDetail,
      };

      setMessages((prev) => {
        const next = [...prev, errorMsg];
        if (activeSession) {
          queueMicrotask(() => {
            sessionService.updateSessionMessages(activeSession.id, next);
          });
        }
        return next;
      });
      setState('ERROR');
      setMicStatus('idle');
      soundFx.playClick(320);
      showToast(errorMessageText);

      // Reset state back to IDLE after brief visual error feedback
      setTimeout(() => {
        setState((curr) => (curr === 'ERROR' ? 'IDLE' : curr));
      }, 2500);
    } finally {
      setIsAiResponding(false);
      isSendingPromptRef.current = false;
    }
  };

  // Microphone voice recognition & speech-to-text handler
  const handleMicClick = async () => {
    // If currently listening, tapping the mic finishes speaking and submits!
    if (micStatus === 'listening') {
      soundFx.playClick(840);
      voiceService.stopListening();
      return;
    }

    if (micStatus === 'requesting_permission') {
      voiceService.cancelListening();
      setMicStatus('idle');
      setState('IDLE');
      return;
    }

    if (micStatus === 'processing') {
      return; // Audio transcription or AI generation in flight
    }

    if (!voiceService.isVoiceInputAvailable()) {
      showToast('Voice input is not supported in this browser. Please type directly.');
      return;
    }

    soundFx.playClick(680);
    voiceService.resumePlaybackContext();
    setInterimTranscript('');
    voiceService.setLanguage(speechLanguage);

    const started = await voiceService.startListening(
      (transcript, isFinal) => {
        if (isFinal) {
          const prompt = transcript.trim();
          setInterimTranscript('');

          if (!prompt) {
            setMicStatus('error');
            setState('ERROR');
            soundFx.playClick(320);
            showToast('No speech was detected. Please try speaking again.');
            setTimeout(() => {
              setMicStatus('idle');
              setState('IDLE');
            }, 2500);
            return;
          }

          // Voice interaction flow: send recognized speech directly to existing AI chat function!
          // State transition: LISTENING -> THINKING -> SPEAKING -> IDLE handled by handleSendMessage
          setMicStatus('processing');
          handleSendMessage(prompt);
        } else {
          // Live interim preview while speaking
          setInterimTranscript(transcript);
        }
      },
      (errorMsg, code) => {
        setMicStatus('error');
        setState('ERROR');
        setInterimTranscript('');
        soundFx.playClick(320);

        if (code === 'PERMISSION_BLOCKED' || code === 'PERMISSION_DENIED') {
          setShowPermissionGuide(true);
        } else {
          showToast(errorMsg);
          // For service or network failures, record in chat drawer with retry support for mobile users
          if (code !== 'MIC_QUIET' && code !== 'NO_SPEECH') {
            const errChatMessage: ChatMessage = {
              id: `voice-err-${Date.now()}`,
              sender: 'shadow',
              text: errorMsg,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              isError: true,
              canRetry: true,
              failedPrompt: '',
              errorCode: code,
            };
            setMessages((prev) => [...prev, errChatMessage]);
          }
        }

        setTimeout(() => {
          setMicStatus((curr) => (curr === 'error' ? 'idle' : curr));
          setState((curr) => (curr === 'ERROR' ? 'IDLE' : curr));
        }, 3500);
      },
      (status) => {
        setMicStatus(status);
        if (status === 'listening' || status === 'requesting_permission') {
          setState('LISTENING');
        } else if (status === 'processing') {
          setState('THINKING');
        } else if (status === 'idle') {
          setState((curr) => (curr === 'LISTENING' ? 'IDLE' : curr));
        }
      },
      (amplitude) => {
        setAudioAmplitude(amplitude);
      }
    );

    if (!started) {
      setMicStatus('idle');
      setState('IDLE');
    }
  };

  const handleCancelVoice = () => {
    voiceService.cancelListening();
    setInterimTranscript('');
    setMicStatus('idle');
    setState('IDLE');
    soundFx.playClick(440);
  };

  const handleFinishVoice = () => {
    soundFx.playClick(840);
    voiceService.stopListening();
  };

  const handleToggleSpeechLanguage = () => {
    const nextLang: SpeechLanguage = speechLanguage === 'en-IN' ? 'hi-IN' : 'en-IN';
    setSpeechLanguage(nextLang);
    voiceService.setLanguage(nextLang);
    soundFx.playClick(600);
    showToast(
      nextLang === 'hi-IN'
        ? 'Speech recognition set to Hindi (hi-IN) • हिंदी में बोलें'
        : 'Speech recognition set to Indian English (en-IN)'
    );
  };

  const handleConfigChange = (newConfig: Partial<HologramConfig>) => {
    setConfig((prev) => {
      const updated = { ...prev, ...newConfig };
      if (newConfig.soundEnabled !== undefined) {
        soundFx.setEnabled(newConfig.soundEnabled);
      }
      return updated;
    });
  };

  const handleClearHistory = () => {
    geminiService.clearHistory();
    setLastFailedPrompt(null);
    setMessages([
      {
        id: `clear-${Date.now()}`,
        sender: 'shadow',
        text: 'Conversation history cleared. Ready for your inquiries.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        modelUsed: 'gemini-3.8-flash',
      },
    ]);
    setShowSettings(false);
    showToast('Conversation memory and context cleared.');
  };

  const stateColors: Record<HologramState, { badge: string; text: string; dot: string; label: string }> = {
    IDLE: {
      badge: 'border-white/20 bg-white/5 text-slate-200',
      text: 'text-white',
      dot: 'bg-white shadow-[0_0_8px_#ffffff]',
      label: 'IDLE',
    },
    LISTENING: {
      badge: 'border-white/40 bg-white/10 text-white',
      text: 'text-white',
      dot: 'bg-white shadow-[0_0_12px_#ffffff]',
      label: 'LISTENING',
    },
    THINKING: {
      badge: 'border-white/60 bg-white/15 text-white',
      text: 'text-white',
      dot: 'bg-white shadow-[0_0_14px_#ffffff]',
      label: 'THINKING',
    },
    SPEAKING: {
      badge: 'border-slate-300/50 bg-white/10 text-slate-100',
      text: 'text-slate-100',
      dot: 'bg-white shadow-[0_0_12px_#e2e8f0]',
      label: 'SPEAKING',
    },
    WORKING: {
      badge: 'border-slate-400/50 bg-white/10 text-slate-200',
      text: 'text-slate-200',
      dot: 'bg-slate-200 shadow-[0_0_10px_#cbd5e1]',
      label: 'WORKING',
    },
    ERROR: {
      badge: 'border-rose-500/50 bg-rose-500/10 text-rose-200',
      text: 'text-rose-400',
      dot: 'bg-rose-400 shadow-[0_0_12px_#f43f5e]',
      label: 'UNAVAILABLE',
    },
  };

  const currentState = stateColors[state];
  const isSeriousActive = config.intelligenceMode === 'serious';

  return (
    <div className="relative w-screen h-screen bg-[#020204] overflow-hidden flex flex-col items-center justify-center font-sans select-none text-slate-100">
      {/* Container simulating Galaxy F55 frame or full edge-to-edge */}
      <div
        className={`relative w-full h-full flex flex-col transition-all duration-500 overflow-hidden ${
          isPhoneFrame
            ? 'max-w-[420px] max-h-[880px] rounded-[44px] border-[6px] border-[#222430] shadow-[0_0_80px_rgba(255,255,255,0.08)] my-auto bg-black'
            : 'max-w-full max-h-full'
        }`}
      >
        {/* Phone Notch/Camera punchhole simulator when in Galaxy F55 frame */}
        {isPhoneFrame && (
          <div className="absolute top-2.5 left-1/2 -translate-x-1/2 z-40 w-4 h-4 rounded-full bg-[#101018] border border-neutral-700 shadow-inner flex items-center justify-center">
            <div className="w-1.5 h-1.5 rounded-full bg-[#040408]" />
          </div>
        )}

        {/* Top Floating Futuristic Header Bar */}
        <header className="z-20 px-4 py-3 flex items-center justify-between bg-gradient-to-b from-[#020204]/90 to-transparent shrink-0">
          {/* Logo & Model Branding */}
          <div className="flex items-center space-x-2.5">
            <div className="relative flex items-center justify-center w-8 h-8 rounded-xl bg-white/10 border border-white/20 shadow-[0_0_15px_rgba(255,255,255,0.15)]">
              <div className="w-3.5 h-3.5 rounded-full bg-white shadow-[0_0_10px_#ffffff]" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-mono text-sm font-extrabold tracking-widest text-white">
                  SHADOW
                </span>
                <span className="text-[10px] font-mono font-bold px-1.5 py-0.2 rounded-full border border-white/20 bg-white/10 text-slate-300">
                  AI
                </span>
              </div>
              <div className="flex items-center space-x-2 text-[9px] font-mono tracking-wider text-neutral-400">
                <span>{isSeriousActive ? 'SERIOUS PRO' : 'STANDARD FLASH'}</span>
                <span className="text-neutral-600">•</span>
                <span className="text-cyan-400 truncate max-w-[120px] sm:max-w-[180px]">{activeSession?.title || 'Initial Briefing'}</span>
              </div>
            </div>
          </div>

          {/* Quick Header Controls */}
          <div className="flex items-center space-x-1.5">
            {/* Conversation Threads Drawer Button */}
            <button
              onClick={() => setShowSessionsDrawer(true)}
              title="Open Conversation Threads & Archives"
              className="px-2.5 py-1 rounded-full text-[10px] font-mono font-bold flex items-center space-x-1.5 border border-cyan-500/35 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 transition-all duration-300 shadow-[0_0_12px_rgba(6,182,212,0.15)]"
            >
              <MessageSquare className="w-3 h-3 text-cyan-400" />
              <span className="hidden sm:inline">Threads</span>
            </button>

            {/* Long-Term Memory Core HUD Button */}
            <button
              onClick={() => setShowMemoryDrawer(true)}
              title={`Long-Term Memory Core (${memoryCount} memories saved)`}
              className="px-2.5 py-1 rounded-full text-[10px] font-mono font-bold flex items-center space-x-1.5 border border-amber-500/35 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 transition-all duration-300 shadow-[0_0_12px_rgba(245,158,11,0.15)]"
            >
              <Brain className="w-3 h-3 text-amber-400" />
              <span className="tabular-nums font-bold">{memoryCount}</span>
              {syncStatus === 'synced' && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_5px_#10b981]" title="Cloud Sync Active" />}
              {syncStatus === 'syncing' && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" title="Syncing..." />}
            </button>

            {/* Cloud Sync & Account Button */}
            <button
              onClick={() => setShowAuthModal(true)}
              title={userProfile ? `Signed in as ${userProfile.email || userProfile.displayName}` : 'Sign In with Google for Cross-Device Sync'}
              className="px-2.5 py-1 rounded-full text-[10px] font-mono font-medium flex items-center space-x-1.5 border border-white/15 bg-white/5 hover:bg-white/15 text-neutral-300 hover:text-white transition-all duration-300"
            >
              {userProfile ? (
                <>
                  <div className="w-3.5 h-3.5 rounded-full bg-emerald-500/30 border border-emerald-400 text-emerald-300 flex items-center justify-center text-[9px] font-bold">
                    {(userProfile.displayName || userProfile.email || 'U')[0].toUpperCase()}
                  </div>
                  <span className="hidden xl:inline max-w-[80px] truncate">{userProfile.displayName || userProfile.email?.split('@')[0]}</span>
                </>
              ) : (
                <>
                  <LogIn className="w-3 h-3 text-neutral-400" />
                  <span className="hidden sm:inline">Sign In</span>
                </>
              )}
            </button>

            {/* Serious Mode Toggle Button */}
            <button
              onClick={handleToggleSeriousMode}
              title={isSeriousActive ? 'Switch to Standard Mode' : 'Switch to Serious Mode (Gemini 4 Argon)'}
              className={`px-2.5 py-1 rounded-full text-[10px] font-mono font-bold flex items-center space-x-1.5 border transition-all duration-300 ${
                isSeriousActive
                  ? 'bg-white text-black border-white shadow-[0_0_15px_rgba(255,255,255,0.4)]'
                  : 'bg-white/5 text-neutral-300 border-white/15 hover:border-white/40 hover:text-white'
              }`}
            >
              <ShieldAlert className="w-3 h-3" />
              <span>{isSeriousActive ? 'SERIOUS' : 'STANDARD'}</span>
            </button>

            {/* Android Project Hub Button */}
            <button
              onClick={onOpenAndroidHub}
              title="Open Native Android Project Hub & Gradle Files"
              className="px-2.5 py-1 rounded-full text-[10px] font-mono font-semibold bg-white/10 hover:bg-white/20 border border-white/20 hover:border-white/50 text-white transition flex items-center space-x-1"
            >
              <FolderCode className="w-3 h-3 text-slate-300" />
              <span className="hidden sm:inline">Android</span>
            </button>

            {/* Toggle Galaxy F55 Frame */}
            <button
              onClick={() => setIsPhoneFrame(!isPhoneFrame)}
              title={isPhoneFrame ? 'Expand to Fullscreen' : 'Simulate Samsung Galaxy F55'}
              className="p-1.5 rounded-full bg-white/5 hover:bg-white/15 border border-white/15 text-neutral-300 hover:text-white transition"
            >
              {isPhoneFrame ? <Maximize2 className="w-3.5 h-3.5" /> : <Smartphone className="w-3.5 h-3.5" />}
            </button>

            {/* Live Diagnostics Modal Button */}
            <button
              onClick={() => setShowDiagnostics(true)}
              title="Open Live System & API Diagnostics"
              className="p-1.5 rounded-full bg-white/5 hover:bg-white/15 border border-white/15 text-neutral-300 hover:text-white transition flex items-center justify-center"
            >
              <Activity className="w-3.5 h-3.5 text-emerald-400" />
            </button>

            {/* Settings Modal */}
            <button
              onClick={() => setShowSettings(true)}
              title="Hologram & AI Personality Settings"
              className="p-1.5 rounded-full bg-white/5 hover:bg-white/15 border border-white/15 text-neutral-300 hover:text-white transition"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          </div>
        </header>

        {/* Center 3D Interactive Hologram Canvas */}
        <div className="relative flex-1 w-full h-full min-h-0 overflow-hidden">
          <Hologram3D
            state={state}
            config={config}
            resetTrigger={resetCounter}
            audioAmplitude={audioAmplitude}
          />

          {/* Hologram Floating HUD Telemetry Badge (Tap to view diagnostics) */}
          <div className="absolute top-2 inset-x-0 flex flex-col items-center pointer-events-none z-10 px-4">
            <button
              onClick={() => setShowDiagnostics(true)}
              title="Tap to open live diagnostics"
              className={`pointer-events-auto flex items-center space-x-2 px-3 py-1 rounded-full border backdrop-blur-md transition-all duration-300 hover:scale-105 active:scale-95 ${currentState.badge}`}
            >
              <div className={`w-2 h-2 rounded-full ${currentState.dot} animate-pulse`} />
              <span className="font-mono text-[10px] font-bold tracking-widest uppercase">
                {currentState.label}
              </span>
              <span className="text-white/30">•</span>
              <span className="font-mono text-[10px] text-neutral-300">
                {config.fpsTarget} FPS
              </span>
              <span className="text-white/30">•</span>
              <span className="font-mono text-[9px] text-emerald-300 bg-emerald-500/20 px-1 rounded flex items-center space-x-0.5">
                <Activity className="w-2.5 h-2.5" />
                <span>Diag</span>
              </span>
            </button>

            {/* State Switcher Pills for Manual Testing */}
            <div className="mt-2 pointer-events-auto flex items-center p-1 rounded-full bg-[#0c0d14]/85 backdrop-blur-md border border-white/15 shadow-xl max-w-[94vw] overflow-x-auto">
              {(['IDLE', 'LISTENING', 'THINKING', 'SPEAKING', 'WORKING', 'ERROR'] as HologramState[]).map((st) => {
                const isActive = state === st;
                return (
                  <button
                    key={st}
                    onClick={() => handleStateChange(st)}
                    className={`px-2.5 py-1 rounded-full text-[10px] font-mono font-bold tracking-wider transition-all duration-200 whitespace-nowrap ${
                      isActive
                        ? 'bg-white text-black shadow-md shadow-white/20'
                        : 'text-neutral-400 hover:text-white hover:bg-neutral-800/50'
                    }`}
                  >
                    {st === 'THINKING' ? 'THINK' : st}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Reset View Button */}
          <div className="absolute right-4 top-1/2 -translate-y-1/2 z-10">
            <button
              onClick={handleResetView}
              title="Reset View Orientation"
              className="w-10 h-10 rounded-full bg-[#0c0d14]/85 hover:bg-[#181a24] border border-white/20 text-white hover:text-slate-200 shadow-xl flex items-center justify-center transition hover:scale-105 active:scale-95 backdrop-blur-sm"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>

          {/* Interactive Floating Sci-Fi Transcript Drawer */}
          {isDrawerOpen && (
            <div className="absolute inset-x-3 bottom-2 top-16 z-30 flex flex-col bg-[#05060b]/95 backdrop-blur-xl border border-white/25 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-6">
              {/* Drawer Header */}
              <div className="px-4 py-2.5 border-b border-white/10 bg-[#0c0d16] flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
                  <span className="text-xs font-mono font-bold tracking-wider text-slate-200">
                    SHADOW CONVERSATION LOG &bull; {isSeriousActive ? 'SERIOUS PRO' : 'FLASH AGILE'}
                  </span>
                </div>
                <button
                  onClick={() => setIsDrawerOpen(false)}
                  className="p-1 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800"
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>

              {/* Drawer Messages Stream */}
              <div ref={chatScrollRef} className="flex-1 p-4 overflow-y-auto space-y-3 font-sans text-xs">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
                  >
                    <div className="flex items-center space-x-1.5 mb-1 text-[10px] text-neutral-400 font-mono">
                      {msg.sender === 'user' ? (
                        <>
                          <span>User</span>
                          <User className="w-3 h-3 text-neutral-300" />
                        </>
                      ) : (
                        <>
                          <Bot className="w-3 h-3 text-white" />
                          <span className="text-white font-semibold">Shadow</span>
                          {msg.modelUsed && !msg.isError && (
                            <span className="px-1.5 py-0.2 rounded bg-white/10 text-slate-300 border border-white/20 text-[9px]">
                              {msg.modelUsed}
                            </span>
                          )}
                          {msg.latencyMs && (
                            <span className="text-neutral-500 text-[9px] flex items-center space-x-0.5">
                              <Clock className="w-2.5 h-2.5" />
                              <span>{msg.latencyMs}ms</span>
                            </span>
                          )}
                        </>
                      )}
                    </div>
                    <div
                      className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 leading-relaxed ${
                        msg.isError
                          ? 'bg-rose-950/40 text-rose-100 rounded-tl-none border border-rose-500/40 shadow-sm'
                          : msg.sender === 'user'
                          ? 'bg-neutral-800 text-neutral-100 rounded-tr-none border border-neutral-700/60'
                          : msg.mode === 'serious'
                          ? 'bg-gradient-to-br from-[#161822] to-[#0f1018] text-white rounded-tl-none border border-white/40 shadow-md shadow-white/5'
                          : 'bg-[#10121c] text-slate-200 rounded-tl-none border border-white/15'
                      }`}
                    >
                      <div className="flex items-start space-x-2">
                        {msg.isError && <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />}
                        <div className="flex-1 whitespace-pre-wrap">
                          {msg.imagePreview && (
                            <div className="mb-2">
                              <img
                                src={msg.imagePreview}
                                alt="Visual upload"
                                className="max-h-48 max-w-full rounded-xl border border-white/20 object-contain bg-black/40 shadow-md"
                              />
                            </div>
                          )}
                          {msg.sender === 'shadow' ? (
                            <FormattedMessage content={msg.text} />
                          ) : (
                            <div>{msg.text}</div>
                          )}
                          {msg.errorCode && (
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                              <span className="px-1.5 py-0.5 rounded bg-rose-500/25 text-rose-300 font-mono text-[9px] border border-rose-500/30">
                                Code: {msg.errorCode}
                              </span>
                              {msg.errorDetail && (
                                <span className="px-1.5 py-0.5 rounded bg-black/40 text-neutral-300 font-mono text-[9px] border border-white/10 max-w-[260px] truncate" title={msg.errorDetail}>
                                  {msg.errorDetail}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Visible Retry Action for honest error handling */}
                      {msg.isError && msg.failedPrompt && (
                        <div className="mt-2.5 pt-2 border-t border-rose-500/20 flex items-center space-x-2">
                          <button
                            type="button"
                            onClick={() => handleSendMessage(msg.failedPrompt)}
                            className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-lg bg-rose-500/25 hover:bg-rose-500/35 text-white text-[11px] font-semibold border border-rose-400/40 transition hover:scale-102 active:scale-98"
                          >
                            <RotateCcw className="w-3 h-3 text-rose-200" />
                            <span>Retry</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setChatInput(msg.failedPrompt || '');
                              setIsDrawerOpen(false);
                              inputRef.current?.focus();
                            }}
                            className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-slate-200 text-[11px] border border-white/15 transition"
                          >
                            <span>Edit prompt</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setShowDiagnostics(true)}
                            className="inline-flex items-center space-x-1 px-2 py-1 rounded-lg bg-white/5 hover:bg-white/15 text-neutral-300 text-[10px] border border-white/10 transition ml-auto"
                            title="View diagnostics log"
                          >
                            <Activity className="w-3 h-3 text-emerald-400" />
                            <span>Diagnostics</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Drawer Quick Suggestions */}
              <div className="px-3 py-2 border-t border-white/10 bg-[#080910] flex items-center space-x-1.5 overflow-x-auto">
                <span className="text-[10px] font-mono text-neutral-400 shrink-0">Prompts:</span>
                {QUICK_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => {
                      handleSendMessage(prompt);
                    }}
                    className="px-2.5 py-1 rounded-full bg-neutral-900 hover:bg-neutral-800 text-neutral-300 hover:text-white border border-neutral-800 text-[10px] whitespace-nowrap transition"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Bottom Interaction Dock */}
        <footer className="z-20 px-4 sm:px-5 pb-4 sm:pb-5 pt-1.5 flex flex-col space-y-2 bg-gradient-to-t from-[#020204] via-[#020204]/95 to-transparent shrink-0">
          {/* Failed Prompt Retry Banner */}
          {lastFailedPrompt && (
            <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-neutral-900/95 border border-rose-500/40 text-xs text-rose-200 backdrop-blur-md max-w-xl mx-auto w-full animate-in fade-in shadow-lg">
              <div className="flex items-center space-x-2 truncate pr-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <span className="truncate">
                  Request paused: <span className="text-white italic">"{lastFailedPrompt}"</span>
                </span>
              </div>
              <div className="flex items-center space-x-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => handleSendMessage(lastFailedPrompt)}
                  className="px-2.5 py-1 rounded-lg bg-rose-500/30 hover:bg-rose-500/40 text-white border border-rose-400/50 text-[10px] font-bold flex items-center space-x-1 transition"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Retry</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setChatInput(lastFailedPrompt);
                    setLastFailedPrompt(null);
                    inputRef.current?.focus();
                  }}
                  className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-slate-200 border border-white/20 text-[10px]"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => setLastFailedPrompt(null)}
                  className="p-1 text-neutral-400 hover:text-white"
                  title="Dismiss"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>
          )}

          {/* Quick Prompts Bar (When drawer is closed) */}
          {!isDrawerOpen && (
            <div className="flex items-center justify-center space-x-1.5 overflow-x-auto py-1 max-w-xl mx-auto w-full">
              {QUICK_PROMPTS.slice(0, 2).map((p) => (
                <button
                  key={p}
                  onClick={() => handleSendMessage(p)}
                  className="px-2.5 py-0.8 rounded-full bg-[#0c0d14]/90 hover:bg-white/10 border border-neutral-800 hover:border-white/40 text-neutral-400 hover:text-white text-[10px] truncate max-w-[200px] transition backdrop-blur-sm"
                >
                  {p}
                </button>
              ))}
              <button
                onClick={() => setIsDrawerOpen(true)}
                className="px-2 py-0.8 rounded-full bg-white/10 hover:bg-white/20 text-slate-200 text-[10px] border border-white/25 flex items-center space-x-1"
              >
                <MessageSquare className="w-3 h-3" />
                <span>Transcript</span>
              </button>
            </div>
          )}

          {/* Interaction Gestures Hint */}
          <div className="flex items-center justify-center space-x-2 text-[10px] text-neutral-500 font-mono">
            <span>Drag to rotate</span>
            <span>•</span>
            <span>Pinch to zoom</span>
            <span>•</span>
            <span className="text-slate-300">Voice reactive core pulse</span>
          </div>

          {/* Microphone Permission Recovery Guidance Card */}
          {showPermissionGuide && (
            <div className="flex flex-col p-4 rounded-2xl bg-[#090b14]/98 border border-amber-500/40 text-xs text-white backdrop-blur-xl max-w-xl mx-auto w-full shadow-2xl animate-in fade-in slide-in-from-bottom-2">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                  <span className="font-semibold text-amber-200 text-xs">
                    Microphone Access Restricted
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowPermissionGuide(false)}
                  className="p-1 text-neutral-400 hover:text-white"
                  title="Dismiss guide"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <p className="text-slate-300 text-[11px] leading-relaxed mb-3">
                Preview iframes on mobile devices often restrict microphone access by policy. Open the standalone app directly to grant Chrome microphone permissions.
              </p>

              <div className="bg-black/60 rounded-xl p-2.5 border border-white/10 mb-3 space-y-1.5 text-[11px] text-neutral-300 font-mono">
                <div className="text-slate-400 font-semibold mb-1">Android Chrome Permission Setup:</div>
                <div className="flex items-center space-x-1.5">
                  <span className="text-amber-400 font-bold">1.</span>
                  <span>Tap the lock/tune icon in the Chrome URL bar</span>
                </div>
                <div className="flex items-center space-x-1.5">
                  <span className="text-amber-400 font-bold">2.</span>
                  <span>Tap <strong>Permissions</strong> &rarr; Set <strong>Microphone</strong> to <strong>Allow</strong></span>
                </div>
                <div className="flex items-center space-x-1.5">
                  <span className="text-amber-400 font-bold">3.</span>
                  <span>Return here and tap <strong>Try Voice Again</strong></span>
                </div>
              </div>

              <div className="flex items-center space-x-2 pt-1 border-t border-white/10">
                <a
                  href={window.location.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 py-1.5 px-3 rounded-lg bg-white text-black font-semibold text-xs flex items-center justify-center space-x-1.5 hover:bg-slate-200 transition shadow"
                >
                  <span>Open Standalone App</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
                <button
                  type="button"
                  onClick={() => {
                    setShowPermissionGuide(false);
                    handleMicClick();
                  }}
                  className="py-1.5 px-3 rounded-lg bg-white/10 hover:bg-white/20 text-white font-semibold text-xs border border-white/20 transition flex items-center space-x-1"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Try Voice Again</span>
                </button>
              </div>
            </div>
          )}

          {/* Active Voice Input HUD */}
          {micStatus === 'requesting_permission' && (
            <div className="flex items-center justify-between px-3.5 py-2 rounded-xl bg-neutral-900/95 border border-amber-400/40 text-xs text-amber-200 backdrop-blur-md max-w-xl mx-auto w-full animate-in fade-in shadow-lg">
              <div className="flex items-center space-x-2 truncate pr-2">
                <Loader2 className="w-4 h-4 text-amber-400 animate-spin shrink-0" />
                <span className="truncate">
                  Requesting microphone permission… Please tap <strong>Allow</strong> in your browser prompt.
                </span>
              </div>
              <button
                type="button"
                onClick={handleCancelVoice}
                className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-neutral-300 text-[10px]"
              >
                Cancel
              </button>
            </div>
          )}

          {micStatus === 'listening' && (
            <div className="flex items-center justify-between px-3.5 py-2.5 rounded-2xl bg-[#090b14]/95 border border-white/30 text-xs text-white backdrop-blur-md max-w-xl mx-auto w-full shadow-2xl animate-in fade-in">
              <div className="flex items-center space-x-2.5 flex-1 min-w-0 pr-2">
                {/* Live recording indicator dot + audio amplitude bars */}
                <div className="flex items-center space-x-1 shrink-0">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                  </span>
                  {/* Real-time amplitude bars */}
                  <div className="flex items-end space-x-0.5 h-3.5 px-1">
                    <span
                      className="w-0.5 bg-white rounded-full transition-all duration-75"
                      style={{ height: `${Math.max(3, Math.min(14, audioAmplitude * 18 + 3))}px` }}
                    />
                    <span
                      className="w-0.5 bg-white rounded-full transition-all duration-75"
                      style={{ height: `${Math.max(4, Math.min(14, audioAmplitude * 24 + 4))}px` }}
                    />
                    <span
                      className="w-0.5 bg-white rounded-full transition-all duration-75"
                      style={{ height: `${Math.max(5, Math.min(14, audioAmplitude * 20 + 5))}px` }}
                    />
                    <span
                      className="w-0.5 bg-white rounded-full transition-all duration-75"
                      style={{ height: `${Math.max(3, Math.min(14, audioAmplitude * 14 + 3))}px` }}
                    />
                  </div>
                </div>

                {/* Live Recognized Transcript Preview */}
                <div className="truncate flex-1">
                  {interimTranscript ? (
                    <span className="text-white font-medium italic">"{interimTranscript}"</span>
                  ) : (
                    <span className="text-neutral-400 text-xs">
                      Listening… Speak now ({speechLanguage === 'hi-IN' ? 'Hindi / Hinglish' : 'Indian English'})
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center space-x-1.5 shrink-0">
                {/* Language Toggle Button */}
                <button
                  type="button"
                  onClick={handleToggleSpeechLanguage}
                  className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 border border-white/20 text-[10px] font-mono text-slate-200 transition"
                  title={speechLanguage === 'hi-IN' ? 'Current: Hindi (hi-IN). Tap to switch to Indian English (en-IN)' : 'Current: Indian English (en-IN). Tap to switch to Hindi (hi-IN)'}
                >
                  {speechLanguage === 'hi-IN' ? 'HI' : 'EN'}
                </button>

                {/* Send / Commit Button */}
                <button
                  type="button"
                  onClick={handleFinishVoice}
                  className="px-2.5 py-1 rounded-lg bg-white hover:bg-slate-200 text-black text-[10px] font-bold flex items-center space-x-1 transition shadow-md"
                  title="Finish speaking and send prompt to SHADOW AI"
                >
                  <Send className="w-3 h-3" />
                  <span>Send</span>
                </button>

                {/* Cancel Button */}
                <button
                  type="button"
                  onClick={handleCancelVoice}
                  className="p-1 text-neutral-400 hover:text-white"
                  title="Cancel voice recording"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {micStatus === 'processing' && (
            <div className="flex items-center justify-between px-3.5 py-2 rounded-xl bg-neutral-900/95 border border-white/30 text-xs text-white backdrop-blur-md max-w-xl mx-auto w-full animate-in fade-in shadow-lg">
              <div className="flex items-center space-x-2 truncate">
                <Loader2 className="w-4 h-4 text-white animate-spin shrink-0" />
                <span>Processing voice and connecting to SHADOW AI…</span>
              </div>
            </div>
          )}

          {/* Visual Attachment Preview Banner */}
          {attachedImage && (
            <div className="flex items-center space-x-2.5 px-3 py-1.5 rounded-xl bg-cyan-950/60 border border-cyan-500/40 text-xs text-cyan-200 backdrop-blur-md max-w-xl mx-auto w-full animate-in fade-in shadow-lg">
              <img
                src={attachedImage.previewUrl}
                alt="Attachment preview"
                className="w-8 h-8 rounded-lg object-cover border border-cyan-500/50 shrink-0 bg-black"
              />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-mono font-medium truncate text-white">{attachedImage.filename || 'Visual Upload'}</p>
                <p className="text-[9px] text-cyan-400 font-mono">Gemini Multimodal Vision Ready</p>
              </div>
              <button
                type="button"
                onClick={() => setAttachedImage(null)}
                className="p-1 rounded-md text-cyan-400 hover:text-white hover:bg-cyan-900/40 transition"
                title="Remove attachment"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Chat input & Mic control */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage();
            }}
            className="flex items-center space-x-2.5 w-full max-w-xl mx-auto"
          >
            {/* Attachment Button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="Attach image or document for multimodal analysis"
              className={`w-12 h-12 rounded-2xl flex items-center justify-center transition border shrink-0 ${
                attachedImage
                  ? 'bg-cyan-500/20 border-cyan-500/60 text-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.3)]'
                  : 'bg-white/5 hover:bg-white/15 border-white/15 text-neutral-400 hover:text-white'
              }`}
            >
              <Paperclip className="w-4 h-4" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf,.txt,.md,.json,.ts,.tsx,.js,.py,.kt"
              className="hidden"
              onChange={handleFileSelect}
            />

            {/* Input field */}
            <div className="relative flex-1">
              <input
                ref={inputRef}
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onPaste={handlePaste}
                placeholder={
                  micStatus === 'requesting_permission'
                    ? 'Requesting microphone permission…'
                    : micStatus === 'listening'
                    ? 'Listening… Speak now'
                    : micStatus === 'processing'
                    ? 'Transcribing speech…'
                    : isSeriousActive
                    ? 'Ask Shadow (Serious Mode: Gemini 4 Argon)…'
                    : 'Ask Shadow in Indian English (en-IN), Hindi (hi-IN), or Hinglish…'
                }
                className="w-full h-12 pl-4 pr-11 rounded-2xl bg-[#0a0b12]/90 border border-neutral-800 focus:border-white text-neutral-100 placeholder-neutral-500 text-xs focus:outline-none focus:ring-1 focus:ring-white/30 transition backdrop-blur-md"
              />
              <button
                type="submit"
                disabled={!chatInput.trim() && !attachedImage}
                className={`absolute right-1.5 top-1.5 w-9 h-9 rounded-xl flex items-center justify-center transition ${
                  chatInput.trim() || attachedImage
                    ? 'bg-white text-black hover:bg-slate-200 shadow-md shadow-white/20'
                    : 'text-neutral-600 hover:text-neutral-400'
                }`}
              >
                <Send className="w-4 h-4" />
              </button>
            </div>

            {/* Microphone button */}
            <button
              type="button"
              onClick={handleMicClick}
              title={
                micStatus === 'listening'
                  ? 'Stop Listening'
                  : micStatus === 'requesting_permission'
                  ? 'Waiting for Permission (Tap to cancel)'
                  : micStatus === 'processing'
                  ? 'Transcribing speech…'
                  : 'Voice Input (Speech-to-Text)'
              }
              className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-300 shadow-lg ${
                micStatus === 'requesting_permission'
                  ? 'bg-amber-400 text-black shadow-amber-400/40 scale-105 ring-4 ring-amber-400/25 animate-pulse'
                  : micStatus === 'listening'
                  ? 'bg-red-500 text-white shadow-red-500/40 scale-105 ring-4 ring-red-500/25 animate-pulse'
                  : micStatus === 'processing'
                  ? 'bg-slate-200 text-black shadow-white/30 ring-4 ring-white/20'
                  : micStatus === 'error'
                  ? 'bg-rose-600 text-white ring-4 ring-rose-500/25 shadow-rose-600/30'
                  : 'bg-gradient-to-br from-white to-slate-300 text-black hover:from-slate-100 hover:to-slate-300 shadow-white/10 hover:shadow-white/25 active:scale-95'
              }`}
            >
              {micStatus === 'requesting_permission' || micStatus === 'processing' ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : micStatus === 'listening' ? (
                <MicOff className="w-5 h-5" />
              ) : (
                <Mic className="w-5 h-5" />
              )}
            </button>
          </form>

          {/* Footnote */}
          <div className="flex items-center justify-between text-[10px] text-neutral-500 font-mono px-1">
            <button
              type="button"
              onClick={() => setShowDiagnostics(true)}
              className="flex items-center space-x-1 hover:text-white transition"
              title="Open Diagnostics"
            >
              <Zap className="w-3 h-3 text-emerald-400" />
              <span>Proxy /api/chat active</span>
            </button>
            <button
              type="button"
              onClick={() => setShowDiagnostics(true)}
              className="hover:text-white transition"
              title="Open Diagnostics"
            >
              {isSeriousActive ? 'gemini-3.8-flash' : 'gemini-3.5-flash-lite'} • Galaxy F55
            </button>
          </div>
        </footer>

        {/* Global Toast Notification */}
        {toastMessage && (
          <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl bg-[#0c0d16]/95 border border-white/25 text-white text-xs font-mono shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-top-2 max-w-[90vw] text-center">
            <div className="flex items-center space-x-2">
              <Info className="w-3.5 h-3.5 text-white shrink-0" />
              <span>{toastMessage}</span>
            </div>
          </div>
        )}

        {/* Settings and Personality Configuration Modal */}
        <SettingsModal
          isOpen={showSettings}
          onClose={() => setShowSettings(false)}
          config={config}
          onChangeConfig={handleConfigChange}
          onClearHistory={handleClearHistory}
        />

        {/* Live System & Developer Diagnostics Modal */}
        <DiagnosticsModal
          isOpen={showDiagnostics}
          onClose={() => setShowDiagnostics(false)}
          onClearHistory={handleClearHistory}
        />

        {/* Long-Term Memory Core Drawer */}
        <MemoryDrawer
          isOpen={showMemoryDrawer}
          onClose={() => setShowMemoryDrawer(false)}
          onOpenAuth={() => setShowAuthModal(true)}
        />

        {/* Conversation Threads & Sessions Drawer */}
        {showSessionsDrawer && (
          <SessionsDrawer
            isOpen={showSessionsDrawer}
            onClose={() => setShowSessionsDrawer(false)}
            onSelectSession={(session) => {
              setActiveSession(session);
              setMessages(session.messages || []);
              setShowSessionsDrawer(false);
            }}
          />
        )}

        {/* Cross-Device Account & Cloud Sync Modal */}
        <AuthModal
          isOpen={showAuthModal}
          onClose={() => setShowAuthModal(false)}
        />
      </div>
    </div>
  );
};
