# SHADOW AI — Native Android Application (Energy Planet Edition)

**Target Hardware:** Samsung Galaxy F55 5G (SM-E556B)  
**Display:** 6.7" Super AMOLED+ FHD+ (1080 × 2340), 120Hz  
**Chipset:** Exynos 1480 (Mali-G68 / Xclipse 530 GPU)  
**Architecture:** Kotlin 2.0 + Jetpack Compose + Native OpenGL ES 2.0/3.0  

---

## 🌟 Visual Core: Glowing Energy Planet Hologram

1. **Cinematic Spherical 3D Energy Planet**:
   - Radiant golden-yellow (`#F59E0B`) and amber (`#D97706`, `#FEF08A`) visual identity.
   - Smooth 3D spherical mantle with flowing solar plasma waves and soft flares.
   - Ultra-bright luminous interior solar core (`#FFFBEB`).
   - Outer atmospheric corona shell with additive Fresnel glow.
   - Dual thin, luminous orbital rings tilted at dynamic gyroscopic angles (26° and -34°).
   - Flowing golden embers/particles orbiting the sphere in celestial trajectories.
   - Absolutely zero crystals, diamonds, robots, humanoids, or faces.
   - Responsive multi-touch: **1-finger drag** to rotate with momentum, **2-finger pinch** to zoom, **reset-view** button.

2. **Full Suite of Reactive Celestial States**:
   - **`IDLE`**: Hypnotic, calm planetary rotation with a 2.2s gentle solar breathing cycle.
   - **`LISTENING`**: Core brightens to solar gold (`#FEF08A`); orbital rings gently pulse with receptive sensitivity.
   - **`THINKING` (Serious Mode)**: Accelerated orbital ring velocity (2.8x), rapid plasma wave oscillation, and intensified amber flares.
   - **`SPEAKING`**: Harmonic acoustic pulsations expanding outward from the planet in sync with voice frequencies.
   - **`WORKING` / Researching**: Organized particle swarm circling the planet in high-coherence orbital paths.
   - **`ERROR`**: Subdued, calm dim amber glow (`#78350F`) with slow oscillation (never aggressive or flashing).

---

## 📲 How to Install the APK on Your Samsung Galaxy F55 (Beginner Steps)

Because you develop directly from your phone, you do **not need a computer**:

### Method 1: Automated Cloud Build via GitHub Actions (Recommended — 100% on Phone!)

1. **Download the Project ZIP**:
   - In the SHADOW AI app preview, tap the golden **"Android APK"** button at the top, then tap **"Download Android Project (.zip)"**. The ZIP will save directly into your Galaxy F55 `Downloads` folder.
2. **Create a GitHub Repository**:
   - On your phone browser, open [github.com](https://github.com) and tap **New Repository** named `shadow-ai`.
3. **Upload the Files**:
   - Open the Samsung **"My Files"** app, extract `shadow-ai-android-project.zip`, and upload the files to your GitHub repository.
4. **Automatic APK Build**:
   - The included `.github/workflows/build-apk.yml` pipeline automatically triggers on push.
   - On GitHub, tap the **Actions** tab.
   - Watch the build complete in ~2 minutes.
   - Download the **`shadow-ai-debug-apk`** artifact.
5. **Install on Galaxy F55**:
   - Tap the downloaded `.apk` file in your notifications or "My Files > Downloads".
   - If prompted: "Allow from this source", toggle it on.
   - Tap **Install** and enjoy your custom SHADOW AI Energy Planet!

---

### Method 2: Android Studio (If You Have a PC)

1. Open Android Studio > **Open Project** > Select the `android/` folder.
2. Enable USB Debugging on your Galaxy F55 (Settings > About phone > tap *Build number* 7 times > Settings > Developer options > toggle *USB Debugging*).
3. Connect your phone with a USB cable and click **Run (Shift+F10)**.

---

### Method 3: Direct Compilation on Phone (Termux)

```bash
pkg update && pkg install openjdk-17 gradle
cd shadow-ai-android && gradle assembleDebug
```
The output APK is generated at `app/build/outputs/apk/debug/app-debug.apk`.
