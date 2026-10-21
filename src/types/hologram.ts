export type HologramState = 'IDLE' | 'LISTENING' | 'THINKING' | 'SPEAKING' | 'WORKING' | 'ERROR';

export type IntelligenceMode = 'standard' | 'serious';
export type PersonalityArchetype = 'sci-fi-companion' | 'tactical' | 'concise';

export interface HologramConfig {
  fpsTarget: 60 | 120;
  bloomIntensity: number; // 0.5 to 2.0
  wireframe: boolean;
  soundEnabled: boolean;
  rotationSpeedMultiplier: number; // 0.5 to 2.0
  particleCount: number;
  intelligenceMode: IntelligenceMode;
  personalityArchetype: PersonalityArchetype;
  speechOutputEnabled: boolean;
  speechRate: number; // 0.8 to 1.4
  speechPitch: number; // 0.8 to 1.3
  ttsVoice?: 'Charon' | 'Fenrir' | 'Zephyr' | 'Puck' | 'Aoede';
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'shadow';
  text: string;
  timestamp: string;
  modelUsed?: string;
  latencyMs?: number;
  mode?: IntelligenceMode;
  isError?: boolean;
  canRetry?: boolean;
  failedPrompt?: string;
  errorCode?: string;
  errorDetail?: string;
  imagePreview?: string;
  isLocalModel?: boolean;
  modelSource?: 'cloud' | 'local';
}

export interface AndroidProjectFile {
  path: string;
  category: 'Kotlin' | 'Compose UI' | 'OpenGL ES' | 'Gradle' | 'Manifest' | 'Workflow';
  content: string;
  description: string;
}
