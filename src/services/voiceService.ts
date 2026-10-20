import { authService } from './authService';

export type MicStatus = 'idle' | 'requesting_permission' | 'listening' | 'processing' | 'error';
export type SpeechLanguage = 'en-IN' | 'hi-IN';

export type RecognitionCallback = (text: string, isFinal: boolean) => void;
export type ErrorCallback = (error: string, code?: string) => void;
export type StatusCallback = (status: MicStatus) => void;
export type AmplitudeCallback = (amplitude: number) => void;

export interface SessionDiagnostics {
  durationMs: number;
  peakRms: number;
  avgRms: number;
  hasAudibleSound: boolean;
  speechDetected: boolean;
  engineUsed: 'web-speech' | 'gemini-transcribe' | 'none';
}

class VoiceService {
  private recognition: any = null;
  private micStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private animFrameId: number | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private selectedMime: string = 'audio/webm';
  private isCancelled: boolean = false;
  private isExplicitlyStopping: boolean = false;
  private sessionAccumulatedTranscript: string = '';
  private currentSegmentTranscript: string = '';
  private currentSegmentInterim: string = '';
  private accumulatedTranscript: string = '';
  private interimTranscript: string = '';
  private hasDispatchedResult: boolean = false;
  private silenceTimer: any = null;
  private maxDurationTimer: any = null;
  private vadInterval: any = null;
  private restartTimer: any = null;
  private restartCount: number = 0;
  private lastRestartTimestamp: number = 0;
  private currentRms: number = 0;

  // Neural TTS Audio Playback
  private playbackAudioContext: AudioContext | null = null;
  private currentAudioSource: AudioBufferSourceNode | null = null;
  private playbackAnalyser: AnalyserNode | null = null;
  private playbackSessionId: number = 0;
  private selectedVoice: string = 'Charon';

  private currentStatus: MicStatus = 'idle';
  private selectedLanguage: SpeechLanguage = 'en-IN';
  private isSpeaking: boolean = false;
  private amplitudeInterval: number | null = null;
  private currentAmplitude: number = 0;

  // Real-time audio metrics & privacy-conscious diagnostics
  private sessionStartTime: number = 0;
  private peakRms: number = 0;
  private sumRms: number = 0;
  private sampleCount: number = 0;
  private speechFramesCount: number = 0;
  private ambientNoiseFloor: number = 0.01;
  private isSpeechDetected: boolean = false;
  private silenceStartTime: number | null = null;
  private lastDiagnostics: SessionDiagnostics = {
    durationMs: 0,
    peakRms: 0,
    avgRms: 0,
    hasAudibleSound: false,
    speechDetected: false,
    engineUsed: 'none',
  };

  // Active callbacks
  private onResultCb: RecognitionCallback | null = null;
  private onErrorCb: ErrorCallback | null = null;
  private onStatusCb: StatusCallback | null = null;
  private onAmplitudeCb: AmplitudeCallback | null = null;

  public getStatus(): MicStatus {
    return this.currentStatus;
  }

  public getLanguage(): SpeechLanguage {
    return this.selectedLanguage;
  }

  public getLastDiagnostics(): SessionDiagnostics {
    return { ...this.lastDiagnostics };
  }

  public getActiveAnalyser(): AnalyserNode | null {
    if (this.isSpeaking && this.playbackAnalyser) {
      return this.playbackAnalyser;
    }
    if (this.currentStatus === 'listening' && this.analyser) {
      return this.analyser;
    }
    return null;
  }

  public getByteFrequencyData(targetArray: Uint8Array): void {
    const active = this.getActiveAnalyser();
    if (active) {
      active.getByteFrequencyData(targetArray as any);
    } else {
      targetArray.fill(0);
    }
  }

  public setLanguage(lang: SpeechLanguage): void {
    this.selectedLanguage = lang;
    if (this.recognition) {
      try {
        this.recognition.lang = lang;
      } catch {
        // Ignored if not editable mid-session
      }
    }
  }

  public isSpeechRecognitionSupported(): boolean {
    return Boolean(
      typeof window !== 'undefined' &&
        ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
    );
  }

  public isMediaRecorderSupported(): boolean {
    return Boolean(
      typeof window !== 'undefined' &&
        typeof navigator !== 'undefined' &&
        'mediaDevices' in navigator &&
        typeof (window as any).MediaRecorder !== 'undefined'
    );
  }

  public isVoiceInputAvailable(): boolean {
    return this.isSpeechRecognitionSupported() || this.isMediaRecorderSupported();
  }

  public isSpeechSynthesisSupported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  private setStatus(status: MicStatus) {
    this.currentStatus = status;
    this.onStatusCb?.(status);
  }

  /**
   * Request microphone permission explicitly and initialize audio amplitude & RMS monitoring
   */
  private async acquireMicrophoneStream(): Promise<MediaStream> {
    if (!navigator?.mediaDevices?.getUserMedia) {
      throw new Error('Microphone audio capture is not supported in this browser context.');
    }

    try {
      // Preferred audio constraints: mono, noise suppression, acoustic echo cancellation
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            sampleRate: 16000,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch {
        // Fallback to basic audio constraints if sampleRate/channelCount rejected by device
        stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
      }

      this.micStream = stream;
      this.setupAudioAnalyser(stream);
      return stream;
    } catch (err: any) {
      const name = err?.name || '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
        const error = new Error('Microphone permission was denied. Please allow microphone access in your browser or Android settings.');
        (error as any).code = 'PERMISSION_BLOCKED';
        throw error;
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        const error = new Error('No microphone device was detected on your system.');
        (error as any).code = 'NOT_FOUND';
        throw error;
      } else if (name === 'NotReadableError' || name === 'TrackStartError') {
        const error = new Error('Microphone is currently in use by another application.');
        (error as any).code = 'IN_USE';
        throw error;
      }
      const error = new Error(err?.message || 'Could not access microphone.');
      (error as any).code = 'CAPTURE_FAILED';
      throw error;
    }
  }

  /**
   * Real-time audio RMS waveform analysis for visual pulsing of the 3D energy core
   * and accurate voice activity / silence detection.
   */
  private setupAudioAnalyser(stream: MediaStream) {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;

      if (!this.audioContext || this.audioContext.state === 'closed') {
        this.audioContext = new AudioCtx();
      } else if (this.audioContext.state === 'suspended') {
        this.audioContext.resume();
      }

      const source = this.audioContext.createMediaStreamSource(stream);
      const analyser = this.audioContext.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.25; // Quick responsiveness to speech transients
      source.connect(analyser);
      this.analyser = analyser;

      const timeBuffer = new Uint8Array(analyser.fftSize);

      const updateAmplitude = () => {
        if (!this.analyser || this.currentStatus !== 'listening') {
          this.currentAmplitude = 0;
          this.onAmplitudeCb?.(0);
          return;
        }

        // Mathematical RMS from time-domain waveform
        this.analyser.getByteTimeDomainData(timeBuffer);
        let sumSquares = 0;
        for (let i = 0; i < timeBuffer.length; i++) {
          const normalized = (timeBuffer[i] - 128) / 128; // -1.0 .. 1.0
          sumSquares += normalized * normalized;
        }
        const rms = Math.sqrt(sumSquares / timeBuffer.length);
        this.currentRms = rms;

        // Track session metrics
        this.peakRms = Math.max(this.peakRms, rms);
        this.sumRms += rms;
        this.sampleCount++;

        // Measure ambient noise during first 250ms
        const elapsed = Date.now() - this.sessionStartTime;
        if (elapsed < 250) {
          this.ambientNoiseFloor = Math.max(0.005, (this.ambientNoiseFloor + rms) / 2);
        }

        // Voice activity detection threshold:
        // Even quiet speech is typically >= 0.020 (2% RMS).
        const speechThreshold = Math.max(0.018, this.ambientNoiseFloor * 1.5);
        if (rms >= speechThreshold) {
          this.speechFramesCount++;
          if (this.speechFramesCount >= 3) {
            this.isSpeechDetected = true;
          }
        }

        // Responsive visual amplitude scaled for the 3D hologram energy core
        const scaledAmplitude = Math.min(1.0, Math.pow(rms * 5.2, 0.85));
        this.currentAmplitude = scaledAmplitude;
        this.onAmplitudeCb?.(scaledAmplitude);

        this.animFrameId = requestAnimationFrame(updateAmplitude);
      };

      this.animFrameId = requestAnimationFrame(updateAmplitude);
    } catch (e) {
      console.warn('[SHADOW AI Voice] Analyser setup error:', e);
    }
  }

  private clearRestartTimer() {
    if (this.restartTimer !== null) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }

  private resetSilenceTimeout(callback: () => void, delayMs: number = 3800) {
    this.clearSilenceTimeout();
    this.silenceTimer = setTimeout(callback, delayMs);
  }

  private clearSilenceTimeout() {
    if (this.silenceTimer !== null) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  /**
   * Finalize speech recognition using accumulated Web Speech transcript if available,
   * or seamlessly fallback to transcribing the recorded audio chunks.
   */
  private finalizeSpeechRecognition(knownText?: string): void {
    if (this.hasDispatchedResult || this.isCancelled) return;
    this.clearSilenceTimeout();
    this.clearRestartTimer();

    const finalText = (
      knownText ||
      [this.sessionAccumulatedTranscript, this.currentSegmentTranscript, this.currentSegmentInterim]
        .filter(Boolean)
        .join(' ') ||
      this.accumulatedTranscript
    ).trim();

    if (finalText) {
      // Web Speech API successfully returned a transcript!
      this.hasDispatchedResult = true;
      this.lastDiagnostics = {
        durationMs: Date.now() - this.sessionStartTime,
        peakRms: Number(this.peakRms.toFixed(3)),
        avgRms: Number((this.sumRms / Math.max(1, this.sampleCount)).toFixed(3)),
        hasAudibleSound: this.peakRms >= 0.015,
        speechDetected: this.isSpeechDetected,
        engineUsed: 'web-speech',
      };

      if (this.recognition) {
        try {
          this.recognition.onstart = null;
          this.recognition.onresult = null;
          this.recognition.onerror = null;
          this.recognition.onend = null;
          this.recognition.stop();
        } catch {
          // Ignored
        }
        this.recognition = null;
      }

      this.setStatus('processing');
      this.onResultCb?.(finalText, true);
      this.cleanupAudio();
      return;
    }

    // Web Speech API returned empty or timed out:
    // Seamlessly fallback to the concurrent audio recording!
    this.transcribeRecordedAudioFallback();
  }

  /**
   * Transcribe the recorded audio chunks using the Gemini multimodal endpoint.
   * This handles Web Speech failures, Android Chrome timeouts, and browsers without SpeechRecognition.
   */
  private async transcribeRecordedAudioFallback(): Promise<void> {
    if (this.hasDispatchedResult || this.isCancelled) return;

    if (this.recognition) {
      try {
        this.recognition.onend = null;
        this.recognition.onerror = null;
        this.recognition.stop();
      } catch {
        // Ignored
      }
      this.recognition = null;
    }

    const durationMs = Date.now() - this.sessionStartTime;
    const avgRms = this.sumRms / Math.max(1, this.sampleCount);
    const hasAudibleSound = this.peakRms >= 0.015;

    this.lastDiagnostics = {
      durationMs,
      peakRms: Number(this.peakRms.toFixed(3)),
      avgRms: Number(avgRms.toFixed(3)),
      hasAudibleSound,
      speechDetected: this.isSpeechDetected,
      engineUsed: 'gemini-transcribe',
    };

    // If microphone was stopped before any audio could be buffered
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop();
      } catch {
        // Ignored
      }
    }

    // Brief wait for any remaining ondataavailable chunks to flush
    await new Promise((r) => setTimeout(r, 100));

    if (this.isCancelled) {
      this.setStatus('idle');
      this.cleanupAudio();
      return;
    }

    // If completely silent and duration was under 600ms (accidental quick tap):
    if (durationMs < 600 && !hasAudibleSound) {
      this.setStatus('error');
      this.onErrorCb?.(
        'Microphone was quiet (0% audio level). Please speak when the hologram pulses.',
        'MIC_QUIET'
      );
      this.cleanupAudio();
      return;
    }

    const blob = new Blob(this.recordedChunks, { type: this.selectedMime });
    if (blob.size < 300) {
      this.setStatus('error');
      this.onErrorCb?.(
        'No speech detected. Microphone was quiet.',
        'NO_SPEECH'
      );
      this.cleanupAudio();
      return;
    }

    this.setStatus('processing');
    try {
      const base64 = await this.blobToBase64(blob);

      const token = await authService.getIdToken().catch(() => null);
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch('/api/transcribe', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          audioBase64: base64,
          mimeType: this.selectedMime,
          language: this.selectedLanguage,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const code = errData.code || 'TRANSCRIPTION_FAILED';
        const msg = errData.error || `Audio transcription service error (status ${res.status}).`;
        this.setStatus('error');
        this.onErrorCb?.(msg, code);
        return;
      }

      const data = await res.json();
      const transcript = (data.transcript || '').trim();

      if (transcript) {
        this.hasDispatchedResult = true;
        this.onResultCb?.(transcript, true);
      } else if (data.isSilence) {
        this.setStatus('error');
        if (!hasAudibleSound) {
          this.onErrorCb?.(
            'Microphone was quiet (0% audio level). Check that your microphone is unmuted.',
            'MIC_QUIET'
          );
        } else {
          this.onErrorCb?.(
            'Audio was detected, but no distinct speech was recognized. Please speak closer to the microphone.',
            'NO_SPEECH'
          );
        }
      } else {
        this.setStatus('error');
        this.onErrorCb?.('No speech detected. Microphone was quiet.', 'NO_SPEECH');
      }
    } catch (e: any) {
      console.warn('[SHADOW AI Voice] Transcription request failed:', e);
      this.setStatus('error');
      this.onErrorCb?.(
        'Network error during speech transcription. Please check your connection.',
        'NETWORK_ERROR'
      );
    } finally {
      this.cleanupAudio();
    }
  }

  /**
   * Start microphone listening session with dual-pipeline recording:
   * 1. MediaRecorder records continuously from millisecond 0.
   * 2. Web Speech API runs concurrently for live interim preview and instant recognition.
   * 3. If Web Speech produces no transcript or fails, MediaRecorder audio is sent to Gemini.
   */
  public async startListening(
    onResult: RecognitionCallback,
    onError: ErrorCallback,
    onStatus: StatusCallback,
    onAmplitude?: AmplitudeCallback
  ): Promise<boolean> {
    if (this.currentStatus === 'listening' || this.currentStatus === 'requesting_permission') {
      this.stopListening();
    }

    this.onResultCb = onResult;
    this.onErrorCb = onError;
    this.onStatusCb = onStatus;
    this.onAmplitudeCb = onAmplitude || null;

    if (!this.isVoiceInputAvailable()) {
      this.setStatus('error');
      onError('Voice input is not supported in this browser.', 'UNSUPPORTED');
      return false;
    }

    this.setStatus('requesting_permission');

    this.isCancelled = false;
    this.isExplicitlyStopping = false;
    this.hasDispatchedResult = false;
    this.sessionAccumulatedTranscript = '';
    this.currentSegmentTranscript = '';
    this.currentSegmentInterim = '';
    this.accumulatedTranscript = '';
    this.interimTranscript = '';
    this.recordedChunks = [];
    this.clearSilenceTimeout();
    this.clearRestartTimer();
    this.restartCount = 0;
    this.lastRestartTimestamp = 0;

    // Reset metrics
    this.sessionStartTime = Date.now();
    this.peakRms = 0;
    this.sumRms = 0;
    this.sampleCount = 0;
    this.speechFramesCount = 0;
    this.ambientNoiseFloor = 0.01;
    this.isSpeechDetected = false;
    this.silenceStartTime = null;

    let stream: MediaStream;
    try {
      stream = await this.acquireMicrophoneStream();
    } catch (err: any) {
      this.setStatus('error');
      const code = err?.code || 'PERMISSION_DENIED';
      onError(err.message, code);
      this.cleanupAudio();
      return false;
    }

    // Step 1: Start MediaRecorder IMMEDIATELY to capture every word continuously from millisecond 0
    this.startMediaRecorder(stream);

    // Step 2: Start VAD (Voice Activity Detection) loop
    this.startVadMonitor();

    // Step 3: Safeguard generous maximum duration (60 seconds)
    this.maxDurationTimer = setTimeout(() => {
      if (this.currentStatus === 'listening') {
        this.stopListening();
      }
    }, 60000);

    // Step 4: If Web Speech API is supported, run it with automatic session-restart handling
    if (this.isSpeechRecognitionSupported()) {
      try {
        const recognition = this.initSpeechRecognition();
        recognition?.start();
        this.setStatus('listening');
        return true;
      } catch (err: any) {
        console.warn('[SHADOW AI Voice] Web Speech start notice, running MediaRecorder fallback:', err);
        this.setStatus('listening');
        return true;
      }
    } else {
      // Direct MediaRecorder mode
      this.setStatus('listening');
      return true;
    }
  }

  /**
   * Initialize a SpeechRecognition instance with event handlers that support
   * transparent restarts and multi-segment speech accumulation.
   */
  private initSpeechRecognition(): any {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return null;

    if (this.recognition) {
      try {
        this.recognition.onstart = null;
        this.recognition.onresult = null;
        this.recognition.onerror = null;
        this.recognition.onend = null;
        this.recognition.abort();
      } catch {
        // Ignored
      }
      this.recognition = null;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = this.selectedLanguage;
      this.setupRecognitionHandlers(recognition);
      this.recognition = recognition;
      return recognition;
    } catch (e) {
      console.warn('[SHADOW AI Voice] SpeechRecognition init notice:', e);
      return null;
    }
  }

  private setupRecognitionHandlers(recognition: any): void {
    recognition.onstart = () => {
      if (this.currentStatus === 'listening') {
        // Recognition is actively capturing
      }
    };

    recognition.onresult = (event: any) => {
      let segFinal = '';
      let segInterim = '';

      for (let i = 0; i < event.results.length; ++i) {
        const res = event.results[i];
        const text = res[0]?.transcript || '';
        if (res.isFinal) {
          segFinal += (segFinal ? ' ' : '') + text;
        } else {
          segInterim += (segInterim ? ' ' : '') + text;
        }
      }

      this.currentSegmentTranscript = segFinal.trim();
      this.currentSegmentInterim = segInterim.trim();

      const combined = [
        this.sessionAccumulatedTranscript,
        this.currentSegmentTranscript,
        this.currentSegmentInterim,
      ]
        .filter(Boolean)
        .join(' ')
        .trim();

      this.accumulatedTranscript = combined;
      this.interimTranscript = this.currentSegmentInterim;

      if (combined) {
        this.isSpeechDetected = true;
        this.onResultCb?.(combined, false);

        // Natural pause silence timer: wait for 3.8s of continuous silence after speech
        this.resetSilenceTimeout(() => {
          if (this.currentStatus === 'listening' && !this.isCancelled && !this.isExplicitlyStopping) {
            this.stopListening();
          }
        }, 3800);
      }
    };

    recognition.onerror = (event: any) => {
      const errType = event.error || '';
      console.info('[SHADOW AI Voice] Web Speech event notice:', errType);

      // 'no-speech' and 'aborted' are benign and expected during natural pauses.
      // NEVER terminate or cut off the user!
      if (errType === 'no-speech' || errType === 'aborted') {
        return;
      }

      if (errType === 'not-allowed' || errType === 'service-not-allowed') {
        this.setStatus('error');
        this.onErrorCb?.(
          'Microphone permission was denied. Please allow microphone access in settings.',
          'PERMISSION_DENIED'
        );
        this.cleanupAudio();
        return;
      }

      // For network or audio-capture notices, let the session continue because MediaRecorder
      // is capturing audio concurrently.
    };

    recognition.onend = () => {
      // If user tapped Send/Cancel, or we're explicitly stopping/finished: do nothing
      if (this.isExplicitlyStopping || this.isCancelled || this.hasDispatchedResult) {
        return;
      }

      // If still in active listening session:
      // Commit any text gathered in this segment to sessionAccumulatedTranscript
      const segText = (this.currentSegmentTranscript || this.currentSegmentInterim).trim();
      if (segText) {
        this.sessionAccumulatedTranscript = [
          this.sessionAccumulatedTranscript,
          segText,
        ]
          .filter(Boolean)
          .join(' ')
          .trim();
      }
      this.currentSegmentTranscript = '';
      this.currentSegmentInterim = '';

      // On Android / mobile Chrome, Google Speech Services automatically closes after ~5 seconds.
      // Transparently restart recognition so user can continue speaking naturally for long sentences!
      if (this.currentStatus === 'listening') {
        const now = Date.now();
        if (now - this.lastRestartTimestamp > 3000) {
          this.restartCount = 0;
        }
        this.lastRestartTimestamp = now;
        this.restartCount++;

        // Guard against runaway rapid loops (max 30 restarts per session)
        if (this.restartCount <= 30) {
          this.clearRestartTimer();
          this.restartTimer = setTimeout(() => {
            if (this.currentStatus === 'listening' && !this.isExplicitlyStopping && !this.isCancelled) {
              try {
                const rec = this.initSpeechRecognition();
                rec?.start();
              } catch (e) {
                console.info('[SHADOW AI Voice] Speech recognition restart notice:', e);
              }
            }
          }, 80);
        }
      }
    };
  }

  /**
   * Start MediaRecorder audio buffering with format detection
   */
  private startMediaRecorder(stream: MediaStream): void {
    const mimeCandidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/aac',
      'audio/ogg',
    ];
    let selectedMime = 'audio/webm';
    for (const candidate of mimeCandidates) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(candidate)) {
        selectedMime = candidate;
        break;
      }
    }
    this.selectedMime = selectedMime;

    try {
      const recorder = new MediaRecorder(stream, { mimeType: selectedMime });
      this.mediaRecorder = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this.recordedChunks.push(e.data);
        }
      };

      recorder.start(250); // Buffer chunks every 250ms
    } catch {
      // Fallback: default browser options
      try {
        const recorder = new MediaRecorder(stream);
        this.mediaRecorder = recorder;
        this.selectedMime = 'audio/webm';
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            this.recordedChunks.push(e.data);
          }
        };
        recorder.start(250);
      } catch (e) {
        console.warn('[SHADOW AI Voice] MediaRecorder start error:', e);
      }
    }
  }

  /**
   * Voice Activity Detection monitor:
   * Once speech is detected, triggers auto-finalization after 3.8s of continuous silence.
   */
  private startVadMonitor(): void {
    if (this.vadInterval) {
      clearInterval(this.vadInterval);
    }

    this.vadInterval = setInterval(() => {
      if (this.currentStatus !== 'listening' || this.isExplicitlyStopping || this.isCancelled) {
        clearInterval(this.vadInterval);
        this.vadInterval = null;
        return;
      }

      // Check current RMS level vs speech threshold
      const speechThreshold = Math.max(0.018, this.ambientNoiseFloor * 1.5);
      const isCurrentlyLoud = this.currentAmplitude > 0.08 || this.currentRms > speechThreshold;

      if (isCurrentlyLoud) {
        this.silenceStartTime = null;
      } else if (this.isSpeechDetected) {
        // User had spoken, and is currently quiet
        if (!this.silenceStartTime) {
          this.silenceStartTime = Date.now();
        } else if (Date.now() - this.silenceStartTime > 3800) {
          // 3.8 seconds of continuous silence after speech! Automatically finish and transcribe
          clearInterval(this.vadInterval);
          this.vadInterval = null;
          if (this.currentStatus === 'listening') {
            this.stopListening();
          }
        }
      }
    }, 150);
  }

  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = (reader.result as string) || '';
        const pureBase64 = result.includes(',') ? result.split(',')[1].trim() : result.trim();
        resolve(pureBase64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Cancel active listening session without transcribing or saving
   */
  public cancelListening(): void {
    this.isCancelled = true;
    this.isExplicitlyStopping = true;
    this.clearSilenceTimeout();
    this.clearRestartTimer();
    if (this.maxDurationTimer) {
      clearTimeout(this.maxDurationTimer);
      this.maxDurationTimer = null;
    }
    if (this.vadInterval) {
      clearInterval(this.vadInterval);
      this.vadInterval = null;
    }

    this.hasDispatchedResult = true;
    this.sessionAccumulatedTranscript = '';
    this.currentSegmentTranscript = '';
    this.currentSegmentInterim = '';
    this.accumulatedTranscript = '';
    this.interimTranscript = '';
    this.recordedChunks = [];

    if (this.recognition) {
      try {
        this.recognition.onstart = null;
        this.recognition.onresult = null;
        this.recognition.onerror = null;
        this.recognition.onend = null;
        this.recognition.abort();
      } catch {
        // Ignored
      }
      this.recognition = null;
    }

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop();
      } catch {
        // Ignored
      }
    }

    this.setStatus('idle');
    this.cleanupAudio();
  }

  /**
   * Stop active listening session and transcribe if using recorder
   */
  public stopListening(): void {
    if (this.isExplicitlyStopping || this.hasDispatchedResult || this.isCancelled) {
      return;
    }
    this.isExplicitlyStopping = true;

    this.clearSilenceTimeout();
    this.clearRestartTimer();
    if (this.maxDurationTimer) {
      clearTimeout(this.maxDurationTimer);
      this.maxDurationTimer = null;
    }
    if (this.vadInterval) {
      clearInterval(this.vadInterval);
      this.vadInterval = null;
    }

    // Detach event listeners to prevent onend restart
    if (this.recognition) {
      try {
        this.recognition.onstart = null;
        this.recognition.onresult = null;
        this.recognition.onerror = null;
        this.recognition.onend = null;
        this.recognition.stop();
      } catch {
        // Ignored
      }
    }

    // Commit any last words from current segment
    const lastSeg = (this.currentSegmentTranscript || this.currentSegmentInterim).trim();
    if (lastSeg) {
      this.sessionAccumulatedTranscript = [
        this.sessionAccumulatedTranscript,
        lastSeg,
      ]
        .filter(Boolean)
        .join(' ')
        .trim();
    }

    const finalText = (
      this.sessionAccumulatedTranscript ||
      this.accumulatedTranscript ||
      ''
    ).trim();

    if (finalText) {
      this.finalizeSpeechRecognition(finalText);
      return;
    }

    // Otherwise, transcribe whatever audio was recorded
    this.transcribeRecordedAudioFallback();
  }

  /**
   * Release hardware microphone tracks to shut off Android/browser recording indicator
   */
  private cleanupAudio(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }

    this.clearRestartTimer();
    this.clearSilenceTimeout();

    if (this.vadInterval) {
      clearInterval(this.vadInterval);
      this.vadInterval = null;
    }

    if (this.maxDurationTimer) {
      clearTimeout(this.maxDurationTimer);
      this.maxDurationTimer = null;
    }

    if (this.micStream) {
      this.micStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // Ignored
        }
      });
      this.micStream = null;
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        this.audioContext.close();
      } catch {
        // Ignored
      }
      this.audioContext = null;
    }

    this.analyser = null;
    this.currentAmplitude = 0;
    this.currentRms = 0;
    this.onAmplitudeCb?.(0);
  }

  private cachedVoices: SpeechSynthesisVoice[] = [];

  constructor() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        this.cachedVoices = window.speechSynthesis.getVoices();
        window.speechSynthesis.onvoiceschanged = () => {
          this.cachedVoices = window.speechSynthesis.getVoices();
        };
      } catch {
        // Ignored
      }
    }
  }

  public setVoice(voice: string): void {
    this.selectedVoice = voice;
  }

  public getVoice(): string {
    return this.selectedVoice;
  }

  /**
   * Lazily initialize or resume playback AudioContext.
   * Avoids hardcoded sampleRate constraints that trigger NotSupportedError on Android hardware.
   */
  public getPlaybackAudioContext(): AudioContext {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!this.playbackAudioContext || this.playbackAudioContext.state === 'closed') {
      try {
        this.playbackAudioContext = new AudioCtx();
      } catch {
        try {
          this.playbackAudioContext = new AudioCtx({ sampleRate: 24000 });
        } catch {
          this.playbackAudioContext = new (AudioCtx as any)();
        }
      }
    }
    if (this.playbackAudioContext && this.playbackAudioContext.state === 'suspended') {
      this.playbackAudioContext.resume().catch(() => {});
    }
    return this.playbackAudioContext || new (window.AudioContext || (window as any).webkitAudioContext)();
  }

  /**
   * Unlocks playback AudioContext on direct user gesture (tap/click) for mobile browser compliance.
   */
  public resumePlaybackContext(): void {
    if (this.playbackAudioContext && this.playbackAudioContext.state === 'suspended') {
      this.playbackAudioContext.resume().catch(() => {});
    }
  }

  /**
   * Robust audio decoder:
   * Decodes studio-grade audio via Web Audio API. Supports modern Promise API as well as
   * legacy callback API. If decodeAudioData fails, falls back to direct 16-bit PCM little-endian
   * buffer parsing so audio playback never fails.
   */
  private async decodeWavOrPcm(bytes: Uint8Array, audioCtx: AudioContext): Promise<AudioBuffer> {
    try {
      const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      const decoded = await new Promise<AudioBuffer>((resolve, reject) => {
        let isSettled = false;
        try {
          const ret = audioCtx.decodeAudioData(
            copy,
            (buf) => {
              if (!isSettled) {
                isSettled = true;
                resolve(buf);
              }
            },
            (err) => {
              if (!isSettled) {
                isSettled = true;
                reject(err);
              }
            }
          );
          if (ret && typeof ret.then === 'function') {
            ret.then(resolve).catch(reject);
          }
        } catch (e) {
          reject(e);
        }
      });
      if (decoded) return decoded;
    } catch {
      // Manual PCM parsing fallback
    }

    let pcmOffset = 0;
    let pcmLength = bytes.length;

    // Extract raw PCM if RIFF header is present
    if (
      bytes.length > 44 &&
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    ) {
      for (let i = 12; i < bytes.length - 8; i++) {
        if (
          bytes[i] === 0x64 && bytes[i + 1] === 0x61 && bytes[i + 2] === 0x74 && bytes[i + 3] === 0x61
        ) {
          pcmOffset = i + 8;
          pcmLength = bytes.length - pcmOffset;
          break;
        }
      }
    }

    const numSamples = Math.floor(pcmLength / 2);
    const audioBuffer = audioCtx.createBuffer(1, Math.max(1, numSamples), 24000);
    const channelData = audioBuffer.getChannelData(0);

    for (let i = 0; i < numSamples; i++) {
      const byteIndex = pcmOffset + i * 2;
      const low = bytes[byteIndex] || 0;
      const high = bytes[byteIndex + 1] || 0;
      let int16 = (high << 8) | low;
      if (int16 >= 0x8000) int16 -= 0x10000;
      channelData[i] = int16 < 0 ? int16 / 32768.0 : int16 / 32767.0;
    }

    return audioBuffer;
  }

  /**
   * Detect language/script to select optimal voice and phonetics (Hindi, Hinglish, or English)
   */
  public detectTextLanguage(text: string): 'hi-IN' | 'en-IN' {
    if (/[\u0900-\u097F]/.test(text)) {
      return 'hi-IN';
    }
    const hinglishMarkers = /\b(namaste|aap|aapka|aapki|kaise|kaisi|kaisa|hain|hai|hum|kya|kar|karo|karein|sakte|accha|theek|dhanyawad|shukriya|mera|meri|mere|tum|tumhara|kaun|ho|bhai|nahi|haan|batao|kripya|dost|kuch|bahut|chahiye|samajh|raha|rahe|alvida)\b/i;
    if (hinglishMarkers.test(text)) {
      return 'hi-IN';
    }
    return 'en-IN';
  }

  /**
   * High-Fidelity Neural Text-to-Speech synthesis for Shadow responses:
   * 1. Fetches studio-grade 24kHz WAV audio from the server's Gemini neural TTS endpoint.
   * 2. Plays back with real-time waveform RMS analysis for the 3D hologram energy core.
   * 3. Gracefully falls back to localized browser synthesis if network is offline or quota exceeded.
   */
  public async speak(
    text: string,
    options: {
      rate?: number;
      pitch?: number;
      voice?: string;
      onStart?: () => void;
      onEnd?: () => void;
      onAmplitude?: AmplitudeCallback;
    } = {}
  ): Promise<void> {
    this.stopSpeaking();

    if (!text || !text.trim()) {
      options.onEnd?.();
      return;
    }

    const voiceName = options.voice || this.selectedVoice || 'Charon';
    const detectedLang = this.detectTextLanguage(text);
    const sessionId = ++this.playbackSessionId;

    // Clean markdown, links, hashtags, and code blocks for clean voice reading
    const cleanedText = text
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/[*_#~[\]()]/g, '')
      .replace(/\bhttps?:\/\/\S+/g, 'link')
      .replace(/(\r\n|\n|\r)/gm, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleanedText) {
      options.onEnd?.();
      return;
    }

    // Attempt Neural AI Text-to-Speech via dedicated backend
    try {
      const token = await authService.getIdToken().catch(() => null);
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch('/api/tts', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          text: cleanedText,
          voice: voiceName,
          language: detectedLang,
        }),
      });

      if (!res.ok) {
        if (sessionId === this.playbackSessionId) {
          this.speakWithBrowserFallback(cleanedText, detectedLang, options);
        }
        return;
      }

      const data = await res.json();
      if (!data.audioBase64) {
        // Server signaled fallback (quota limit, rate limit, or model cooldown)
        if (sessionId === this.playbackSessionId) {
          this.speakWithBrowserFallback(cleanedText, detectedLang, options);
        }
        return;
      }

      // If another speak() request started while fetching, abort this older session
      if (sessionId !== this.playbackSessionId) {
        return;
      }

      // Play 24kHz neural WAV with real-time waveform sync
      await this.playNeuralAudio(data.audioBase64, sessionId, options, cleanedText);
    } catch {
      if (sessionId === this.playbackSessionId) {
        this.speakWithBrowserFallback(cleanedText, detectedLang, options);
      }
    }
  }

  /**
   * Play decoded 24kHz neural WAV audio via Web Audio API with real-time waveform synchronization
   */
  private async playNeuralAudio(
    base64Wav: string,
    sessionId: number,
    options: {
      onStart?: () => void;
      onEnd?: () => void;
      onAmplitude?: AmplitudeCallback;
    },
    cleanedText: string
  ): Promise<void> {
    try {
      const audioCtx = this.getPlaybackAudioContext();
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }

      // Decode Base64 binary
      const binaryStr = atob(base64Wav);
      const len = binaryStr.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      const audioBuffer = await this.decodeWavOrPcm(bytes, audioCtx);

      if (sessionId !== this.playbackSessionId) {
        return;
      }

      const source = audioCtx.createBufferSource();
      source.buffer = audioBuffer;

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.25;

      source.connect(analyser);
      analyser.connect(audioCtx.destination);
      this.currentAudioSource = source;
      this.playbackAnalyser = analyser;

      this.isSpeaking = true;
      options.onStart?.();

      // Real-time waveform amplitude tracking during neural audio playback
      const timeBuffer = new Uint8Array(analyser.fftSize);
      let isPlaying = true;

      const updateWaveformAmplitude = () => {
        if (!isPlaying || sessionId !== this.playbackSessionId) {
          return;
        }

        analyser.getByteTimeDomainData(timeBuffer);
        let sumSquares = 0;
        for (let i = 0; i < timeBuffer.length; i++) {
          const norm = (timeBuffer[i] - 128) / 128;
          sumSquares += norm * norm;
        }
        const rms = Math.sqrt(sumSquares / timeBuffer.length);
        const scaledAmp = Math.min(1.0, Math.pow(rms * 4.6, 0.85));
        this.currentAmplitude = scaledAmp;
        options.onAmplitude?.(scaledAmp);

        requestAnimationFrame(updateWaveformAmplitude);
      };

      requestAnimationFrame(updateWaveformAmplitude);

      source.onended = () => {
        isPlaying = false;
        if (this.currentAudioSource === source) {
          this.currentAudioSource = null;
        }
        if (this.playbackAnalyser === analyser) {
          this.playbackAnalyser = null;
        }
        this.isSpeaking = false;
        this.currentAmplitude = 0;
        options.onAmplitude?.(0);
        options.onEnd?.();
      };

      source.start(0);
    } catch (decodeErr) {
      this.playbackAnalyser = null;
      console.warn('[SHADOW AI Voice] Web Audio playback error, using localized speech fallback:', decodeErr);
      const detectedLang = this.detectTextLanguage(cleanedText);
      this.speakWithBrowserFallback(cleanedText, detectedLang, options);
    }
  }

  /**
   * Localized speech synthesis fallback when neural TTS is unavailable or rate limited.
   * Uses natural pitch, explicit language locale, and proper Hindi / Indian English voice matching.
   */
  private speakWithBrowserFallback(
    cleanedText: string,
    detectedLang: 'hi-IN' | 'en-IN',
    options: {
      rate?: number;
      pitch?: number;
      onStart?: () => void;
      onEnd?: () => void;
      onAmplitude?: AmplitudeCallback;
    }
  ): void {
    if (!this.isSpeechSynthesisSupported() || !cleanedText) {
      this.simulateSpeech(cleanedText || 'Understood.', options);
      return;
    }

    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(cleanedText);
      const isHindi = detectedLang === 'hi-IN';

      // Explicitly set language locale so Android TTS engine activates the correct phoneme pack
      utterance.lang = isHindi ? 'hi-IN' : 'en-IN';
      utterance.rate = 1.0;
      utterance.pitch = 1.0;

      const voices = this.cachedVoices.length > 0 ? this.cachedVoices : window.speechSynthesis.getVoices();

      let preferredVoice: SpeechSynthesisVoice | undefined;
      if (isHindi) {
        preferredVoice =
          voices.find((v) => v.lang.toLowerCase().startsWith('hi') && v.name.toLowerCase().includes('male')) ||
          voices.find((v) => v.lang.toLowerCase().startsWith('hi')) ||
          voices.find((v) => v.name.toLowerCase().includes('hindi')) ||
          voices.find((v) => v.lang.toLowerCase() === 'en-in');
      } else {
        // Deep / natural male voice preference for English
        preferredVoice =
          voices.find((v) => v.name.toLowerCase().includes('male') && v.lang.startsWith('en')) ||
          voices.find((v) => v.name.includes('Natural') || v.name.includes('Neural')) ||
          voices.find((v) => v.lang === 'en-IN' || v.lang === 'en-GB' || v.lang.startsWith('en'));
      }

      if (preferredVoice) {
        utterance.voice = preferredVoice;
      }

      utterance.onstart = () => {
        this.isSpeaking = true;
        this.startAmplitudeSimulation(options.onAmplitude);
        options.onStart?.();
      };

      utterance.onend = () => {
        this.isSpeaking = false;
        this.stopAmplitudeSimulation(options.onAmplitude);
        options.onEnd?.();
      };

      utterance.onerror = () => {
        this.isSpeaking = false;
        this.stopAmplitudeSimulation(options.onAmplitude);
        options.onEnd?.();
      };

      window.speechSynthesis.speak(utterance);
    } catch {
      this.simulateSpeech(cleanedText, options);
    }
  }

  private simulateSpeech(
    text: string,
    options: {
      onStart?: () => void;
      onEnd?: () => void;
      onAmplitude?: AmplitudeCallback;
    }
  ) {
    const wordCount = text.split(/\s+/).length;
    const durationMs = Math.min(Math.max(wordCount * 260, 1500), 7000);

    options.onStart?.();
    this.startAmplitudeSimulation(options.onAmplitude);

    setTimeout(() => {
      this.stopAmplitudeSimulation(options.onAmplitude);
      options.onEnd?.();
    }, durationMs);
  }

  private startAmplitudeSimulation(onAmplitude?: AmplitudeCallback) {
    if (this.amplitudeInterval) {
      clearInterval(this.amplitudeInterval);
    }

    let phase = 0;
    this.amplitudeInterval = window.setInterval(() => {
      phase += 0.25;
      const base = (Math.sin(phase) + Math.cos(phase * 2.3) + 2) / 4;
      const jitter = Math.random() * 0.35;
      this.currentAmplitude = Math.min(1.0, Math.max(0.1, base * 0.7 + jitter));
      onAmplitude?.(this.currentAmplitude);
    }, 50);
  }

  private stopAmplitudeSimulation(onAmplitude?: AmplitudeCallback) {
    if (this.amplitudeInterval) {
      clearInterval(this.amplitudeInterval);
      this.amplitudeInterval = null;
    }
    this.currentAmplitude = 0;
    onAmplitude?.(0);
  }

  public stopSpeaking(): void {
    this.playbackSessionId++;
    if (this.currentAudioSource) {
      try {
        this.currentAudioSource.stop();
        this.currentAudioSource.disconnect();
      } catch {
        // Ignored
      }
      this.currentAudioSource = null;
    }
    if (this.isSpeechSynthesisSupported()) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignored
      }
    }
    this.isSpeaking = false;
    this.stopAmplitudeSimulation();
  }

  public getSpeakingState(): boolean {
    return this.isSpeaking;
  }
}

export const voiceService = new VoiceService();
