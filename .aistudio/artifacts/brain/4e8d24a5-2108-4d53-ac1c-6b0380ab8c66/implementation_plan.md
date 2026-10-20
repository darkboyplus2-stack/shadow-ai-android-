# SHADOW AI — Multimodal Vision, Multi-Thread Sessions & Dynamic Audio Waveform Core

An architectural blueprint to elevate SHADOW AI into a next-generation intelligence console by introducing native multimodal visual analysis (images, screenshots, diagrams, and documents), a collapsible conversation threads drawer with search and export, and dynamic 3D audio waveform spectrum rings radiating around the hologram core in Three.js.

---

### User Review & Critical Decisions

> [!IMPORTANT]
> The following architectural decisions were selected and confirmed by the user in Phase 1:
>
> - **Flagship Capability**: Multimodal visual analysis for images, code, screenshots, and documents via Gemini's vision pipeline, triggering visual inspection states on the hologram.
> - **Conversation Architecture**: Collapsible sidebar drawer with full search, session creation/switching, and JSON/Markdown export options, backed by Cloud Firestore.
> - **Audio-Visual Telemetry**: Dynamic 3D audio waveform spectrum rings in Three.js reacting in real time to both user voice input and AI neural speech synthesis.

---

### 1. Overview & Core Concept

- **The Problem**: While SHADOW AI now possesses long-term memory and cross-device sync, interaction is confined to a single text/audio stream without visual perception, conversation session branching, or real-time 3D frequency visualization.
- **The Solution**:
  1. **Multimodal Visual Perception**: Enable users to attach or drag-and-drop images, screenshots, diagrams, and text files. The server proxy (`POST /api/chat`) incorporates inline base64 image data parts for `gemini-3.5-flash-lite` or `gemini-3.8-flash`, while the hologram transitions into an active optical scanning mode.
  2. **Multi-Thread Session Manager**: A collapsible session drawer that allows users to create dedicated threads (e.g., "Galaxy F55 Jetpack Compose Hub", "Quantum Physics", "App Architecture"), switch between past discussions, search transcript history, and export sessions to clean Markdown or JSON archives.
  3. **3D Audio Waveform Spectrum Rings**: Using the Web Audio API `AnalyserNode`, extract frequency bin data and drive procedural concentric ring geometries in Three.js that expand, ripple, and glow harmonically during speech recognition and neural audio playback.

---

### 2. User Experience & Visual Design

- **Key User Flows**:
  - **Visual Attachment & Analysis**: User taps the paperclip/image icon in the chat input bar or pastes an image from the clipboard &rarr; A thumbnail preview appears with a remove button &rarr; User asks *"Analyze this Android layout error"* &rarr; Hologram shifts to `WORKING` optical scan mode &rarr; AI analyzes the image with grounded reasoning.
  - **Thread Management & Archiving**: Tapping the `Sessions` icon opens a sleek, collapsible drawer listing active and past conversations with last-activity timestamps &rarr; User can create a "New Thread", rename threads, search through transcripts, or tap `Export (.md / .json)` for offline study.
  - **Dynamic Audio Reactive Hologram**: When the user speaks or SHADOW synthesizes speech, glowing concentric spectrum rings pulse outward from the core in sync with vocal pitch and amplitude.

- **Visual Identity & Theme**:
  - *Palette*: Deep space obsidian `#07080d`, structural obsidian `#0d0f18`, frosted overlays `rgba(13, 15, 24, 0.9)`, crisp white typography `#f8fafc`, slate accents `#94a3b8`, electric cyan `#06b6d4`, neural amber `#f59e0b`, and neon emerald `#10b981`.
  - *Top Bar Contract*: Brand wordmark &rarr; Navigation/State &rarr; Primary Actions: `Sessions` + `Memory Core` + `Account`.
  - *Audio Waveforms*: Physically-grounded glowing torus/ring mesh segments with dynamic vertex displacement scaled by audio frequency bins.

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: Direct Inline Base64 Image Processing via Server Proxy**
  - *Chosen Approach*: Client encodes attached image as JPEG/PNG base64 thumbnail (< 4MB) and sends it directly in the `/api/chat` request body.
  - *Why*: Eliminates complex multi-step cloud storage uploads, ensures zero-latency streaming responses, and protects user privacy by keeping images ephemeral unless explicitly referenced in memories.

- **Decision 2: Firestore Multi-Thread Storage Schema**
  - *Chosen Approach*: Persist threads under `/users/{userId}/chats/{chatId}` containing `{ id, title, messages, updatedAt, createdAt }`, synchronized in real-time.
  - *Why*: Conforms strictly to existing deployed Firestore security rules without needing schema migrations or breaking changes.

- **Decision 3: Procedural Audio Waveform Rings in Three.js**
  - *Chosen Approach*: Connect Web Audio API `AnalyserNode` to the shared `AudioContext` in `voiceService.ts`, passing a normalized frequency array (`Uint8Array`) into `Hologram3D.tsx` to deform concentric ring vertices.
  - *Why*: 60 FPS GPU-accelerated rendering with zero garbage collection overhead and zero third-party visualizer library bloat.

---

### 4. Technical Architecture & Data Strategy

```
┌────────────────────────────────────────────────────────────────────────┐
│                              SHADOW UI                                 │
│  [Top Bar: Sessions | Memory | Account]  ──>  [3D Hologram + Waves]   │
│  [Sessions Drawer] [Memory Drawer] [Chat Input + Multimodal Upload]   │
└───────────────────┬──────────────────────────────────┬─────────────────┘
                    │                                  │
          1. Multimodal Prompt & Image         2. Real-time Audio Stream
                    │                                  │
                    ▼                                  ▼
┌──────────────────────────────────────┐   ┌─────────────────────────────┐
│          geminiService.ts            │   │      voiceService.ts        │
│  • Inline image parts { mime, data } │   │  • AnalyserNode (FFT 64)    │
│  • POST /api/chat                    │   │  • Normalized frequency data│
└───────────────────┬──────────────────┘   └───────────────┬─────────────┘
                    │                                      │
                    ▼                                      ▼
┌──────────────────────────────────────┐   ┌─────────────────────────────┐
│          server.ts (/api/chat)       │   │       Hologram3D.tsx        │
│  • Multimodal Gemini payload         │   │  • Concentric Waveform Rings│
│  • Memory Context Integration        │   │  • Harmonic Vertex Jitter   │
└──────────────────────────────────────┘   └─────────────────────────────┘
```

#### Firestore Data Consistency
- Utilizes existing deployed collections:
  - `/users/{userId}/chats/{chatId}`: Stores threaded chat logs.
  - `/users/{userId}/memories/{memoryId}`: Stores user preferences.
  - `/users/{userId}/settings/{settingId}`: Stores voice & mode preferences.

---

### Implementation Phases & Tasks

1. **Phase 1: Web Audio Analyser & 3D Waveform Spectrum Rings**
   - Hook an `AnalyserNode` into `voiceService.ts` for microphone input and neural audio output.
   - Update `Hologram3D.tsx` to render glowing, audio-reactive concentric spectrum rings around the central energy core.

2. **Phase 2: Multimodal Visual Perception Pipeline**
   - Add image attachment and preview affordance to the chat input in `ShadowInterface.tsx` (drag-and-drop, clipboard paste, file picker).
   - Update `geminiService.ts` and `server.ts` to accept `image` payloads (inline data parts) with Gemini vision models.
   - Introduce visual scanning animation state in the 3D hologram when an image is being processed.

3. **Phase 3: Multi-Thread Conversation Manager Drawer**
   - Build `src/components/SessionsDrawer.tsx` allowing users to create new threads, switch between sessions, search message transcripts, and rename threads.
   - Integrate with Firestore (`/users/{userId}/chats`) and `localStorage` for seamless guest fallback and cloud sync.
   - Add one-click export to Markdown (`.md`) and JSON format.

4. **Phase 4: Top Bar & UI Integration**
   - Add the `Sessions` HUD toggle to the top navigation bar.
   - Ensure complete responsiveness on desktop and Samsung Galaxy F55 frame.

5. **Phase 5: Verification & Compilation**
   - Validate multimodal image queries, conversation switching, export files, and audio waveform reaction.
   - Run `compile_applet` and `lint_applet` to ensure zero regressions and clean builds.
