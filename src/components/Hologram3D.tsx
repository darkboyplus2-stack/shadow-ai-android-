import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { HologramConfig, HologramState } from '../types/hologram';
import { soundFx } from '../services/soundFx';
import { voiceService } from '../services/voiceService';

interface Hologram3DProps {
  state: HologramState;
  config: HologramConfig;
  onResetView?: () => void;
  resetTrigger?: number;
  audioAmplitude?: number;
}

// Pre-allocated reusable math helpers for zero GC in animation loop
const _targetRotation = new THREE.Vector2(0.15, 0);
const _currentRotation = new THREE.Vector2(0.15, 0);
let _targetZoom = 4.2;
let _currentZoom = 4.2;

export const Hologram3D: React.FC<Hologram3DProps> = ({
  state,
  config,
  resetTrigger = 0,
  audioAmplitude = 0,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<HologramState>(state);
  const configRef = useRef<HologramConfig>(config);
  const audioAmplitudeRef = useRef<number>(audioAmplitude);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    audioAmplitudeRef.current = audioAmplitude;
  }, [audioAmplitude]);

  // Handle reset view trigger
  useEffect(() => {
    if (resetTrigger > 0) {
      _targetRotation.set(0.15, 0);
      _targetZoom = 4.2;
    }
  }, [resetTrigger]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // 1. Scene & Camera Setup (Deep void space)
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020204);
    scene.fog = new THREE.FogExp2(0x020204, 0.06);

    const width = container.clientWidth;
    const height = container.clientHeight;
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 50);
    camera.position.set(0, 0, _currentZoom);

    // 2. High-Performance WebGL Renderer
    const isHeadless = navigator.webdriver || /HeadlessChrome/i.test(navigator.userAgent);
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(isHeadless ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.35;
    renderer.shadowMap.enabled = !isHeadless;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // 3. Studio Environment for Metallic Silver & Crystalline Reflections
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    // 4. White & Silver Lighting Rig
    const ambientLight = new THREE.AmbientLight(0x334155, 1.2);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 4.0);
    keyLight.position.set(4, 5, 5);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xe2e8f0, 2.8);
    rimLight.position.set(-5, -3, -4);
    scene.add(rimLight);

    // Concentrated pure white energy point light at core center
    const corePointLight = new THREE.PointLight(0xffffff, 9.0, 15, 1.6);
    corePointLight.position.set(0, 0, 0);
    scene.add(corePointLight);

    // 5. White Energy Core Root
    const energyCoreRoot = new THREE.Group();
    scene.add(energyCoreRoot);

    // ── 5A. Brilliant Pure White Point Singularity (Intense center) ──
    const innerSingularityGeo = new THREE.SphereGeometry(0.38, 32, 32);
    const innerSingularityMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.98,
    });
    const innerSingularityMesh = new THREE.Mesh(innerSingularityGeo, innerSingularityMat);
    energyCoreRoot.add(innerSingularityMesh);

    // ── 5B. Radiant Plasma Core Flare (Layered additive white glow) ──
    const coreFlareGeo = new THREE.SphereGeometry(0.72, 32, 32);
    const coreFlareMat = new THREE.MeshBasicMaterial({
      color: 0xf8fafc,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
    });
    const coreFlareMesh = new THREE.Mesh(coreFlareGeo, coreFlareMat);
    energyCoreRoot.add(coreFlareMesh);

    // ── 5C. Translucent Luminous Energy Corona Shell ──
    const coronaGeo = new THREE.SphereGeometry(1.22, 48, 48);
    const coronaMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xe2e8f0,
      emissiveIntensity: 0.9,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      wireframe: config.wireframe,
    });
    const coronaMesh = new THREE.Mesh(coronaGeo, coronaMat);
    energyCoreRoot.add(coronaMesh);

    // ── 5D. Complex Spherical Energy Network (Dense Intersecting Lines) ──
    // Lattice 1: Outer high-density geodesic cage
    const latticeGeo1 = new THREE.IcosahedronGeometry(1.18, 3);
    const wireframeGeo1 = new THREE.WireframeGeometry(latticeGeo1);
    const latticeMat1 = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
    });
    const latticeMesh1 = new THREE.LineSegments(wireframeGeo1, latticeMat1);
    energyCoreRoot.add(latticeMesh1);

    // Lattice 2: Inner counter-rotating geodesic cage
    const latticeGeo2 = new THREE.IcosahedronGeometry(1.06, 2);
    const wireframeGeo2 = new THREE.WireframeGeometry(latticeGeo2);
    const latticeMat2 = new THREE.LineBasicMaterial({
      color: 0xcfd8dc,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
    });
    const latticeMesh2 = new THREE.LineSegments(wireframeGeo2, latticeMat2);
    energyCoreRoot.add(latticeMesh2);

    // Luminous Energy Nexus Nodes on Outer Lattice Vertices
    const vertexPositions = latticeGeo1.attributes.position;
    const vertexCount = vertexPositions.count;
    const nodeCount = Math.min(vertexCount, 42); // Top 42 prominent vertices
    const nexusNodeGeo = new THREE.SphereGeometry(0.024, 12, 12);
    const nexusNodeMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
    });
    const nexusNodesMesh = new THREE.InstancedMesh(nexusNodeGeo, nexusNodeMat, nodeCount);
    const dummyNode = new THREE.Object3D();

    for (let i = 0; i < nodeCount; i++) {
      const idx = (i * 3) % vertexCount;
      const vx = vertexPositions.getX(idx);
      const vy = vertexPositions.getY(idx);
      const vz = vertexPositions.getZ(idx);
      dummyNode.position.set(vx, vy, vz);
      dummyNode.scale.setScalar(1.0);
      dummyNode.updateMatrix();
      nexusNodesMesh.setMatrixAt(i, dummyNode.matrix);
    }
    nexusNodesMesh.instanceMatrix.needsUpdate = true;
    energyCoreRoot.add(nexusNodesMesh);

    // Intersecting Spherical Meridian Filaments (4 great-circle energy loops)
    const meridianFilamentsGroup = new THREE.Group();
    energyCoreRoot.add(meridianFilamentsGroup);
    const meridianGeo = new THREE.TorusGeometry(1.17, 0.007, 12, 96);
    const meridianMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
    });

    const meridianAngles = [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4];
    const meridianMeshes: THREE.Mesh[] = [];
    meridianAngles.forEach((angle) => {
      const mMesh = new THREE.Mesh(meridianGeo, meridianMat);
      mMesh.rotation.y = angle;
      mMesh.rotation.x = Math.PI / 2;
      meridianFilamentsGroup.add(mMesh);
      meridianMeshes.push(mMesh);
    });

    // ── 5E. 6 Dynamic Gyroscopic Orbital Rings ──
    const orbitalRingGroups: THREE.Group[] = [];
    const ringMaterials: THREE.MeshStandardMaterial[] = [];
    const ringGeometries: THREE.TorusGeometry[] = [];

    // Configuration for the 6 gyroscopic orbital rings
    const ringConfigs = [
      { radius: 1.62, tube: 0.015, rotX: 24, rotZ: 16, speed: 0.65, nodeDist: 1.62 },
      { radius: 1.94, tube: 0.014, rotX: -36, rotZ: -24, speed: -0.78, nodeDist: 1.94 },
      { radius: 2.26, tube: 0.013, rotX: 68, rotZ: 14, speed: 0.92, nodeDist: 2.26 },
      { radius: 2.58, tube: 0.012, rotX: -58, rotZ: 38, speed: -0.55, nodeDist: 2.58 },
      { radius: 2.90, tube: 0.011, rotX: 14, rotZ: -64, speed: 0.72, nodeDist: 2.90 },
      { radius: 3.22, tube: 0.010, rotX: -16, rotZ: 52, speed: -0.88, nodeDist: 3.22 },
    ];

    const ringNodeSharedGeo = new THREE.SphereGeometry(0.038, 16, 16);
    const ringNodeSharedMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      blending: THREE.AdditiveBlending,
    });

    ringConfigs.forEach((rc) => {
      const group = new THREE.Group();
      group.rotation.x = THREE.MathUtils.degToRad(rc.rotX);
      group.rotation.z = THREE.MathUtils.degToRad(rc.rotZ);
      energyCoreRoot.add(group);
      orbitalRingGroups.push(group);

      const rGeo = new THREE.TorusGeometry(rc.radius, rc.tube, 16, 120);
      ringGeometries.push(rGeo);
      const rMat = new THREE.MeshStandardMaterial({
        color: 0xf8fafc,
        emissive: 0xffffff,
        emissiveIntensity: 0.9,
        metalness: 0.95,
        roughness: 0.08,
      });
      ringMaterials.push(rMat);

      const rMesh = new THREE.Mesh(rGeo, rMat);
      rMesh.rotation.x = Math.PI / 2;
      group.add(rMesh);

      // Glowing white telemetry nodes on ring
      const nodeA = new THREE.Mesh(ringNodeSharedGeo, ringNodeSharedMat);
      nodeA.position.set(rc.nodeDist, 0, 0);
      const nodeB = new THREE.Mesh(ringNodeSharedGeo, ringNodeSharedMat);
      nodeB.position.set(-rc.nodeDist, 0, 0);
      group.add(nodeA, nodeB);
    });

    // ── 5F. Orbiting White Sparks & Floating Energy Particles ──
    const particleCount = config.particleCount || 160;
    const particleGeo = new THREE.TetrahedronGeometry(0.036, 0);
    const particleMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
    });
    const particleMesh = new THREE.InstancedMesh(particleGeo, particleMat, particleCount);

    const dummy = new THREE.Object3D();
    const particleSpeeds: number[] = [];
    const particleRadii: number[] = [];
    const particleHeights: number[] = [];
    const particlePhases: number[] = [];
    const particleTilts: number[] = [];

    for (let i = 0; i < particleCount; i++) {
      const radius = 1.35 + Math.random() * 1.8;
      const height = (Math.random() - 0.5) * 1.8;
      const phase = Math.random() * Math.PI * 2;
      const speed = (0.35 + Math.random() * 0.75) * (Math.random() > 0.45 ? 1 : -1);
      const tilt = (Math.random() - 0.5) * 0.7;

      particleRadii.push(radius);
      particleHeights.push(height);
      particlePhases.push(phase);
      particleSpeeds.push(speed);
      particleTilts.push(tilt);

      dummy.position.set(Math.cos(phase) * radius, height, Math.sin(phase) * radius);
      dummy.scale.setScalar(0.4 + Math.random() * 0.8);
      dummy.updateMatrix();
      particleMesh.setMatrixAt(i, dummy.matrix);
    }
    particleMesh.instanceMatrix.needsUpdate = true;
    energyCoreRoot.add(particleMesh);

    // ── 5G. Ambient Floor Telemetry Ring Emitter (Hologram projector floor) ──
    const baseEmitterGroup = new THREE.Group();
    baseEmitterGroup.position.y = -2.2;
    scene.add(baseEmitterGroup);

    const emitterRing1 = new THREE.RingGeometry(0.65, 0.68, 48);
    const emitterRing2 = new THREE.RingGeometry(1.45, 1.48, 64);
    const emitterRing3 = new THREE.RingGeometry(2.2, 2.22, 64);
    const emitterMat = new THREE.MeshBasicMaterial({
      color: 0xe2e8f0,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
    });

    const eMesh1 = new THREE.Mesh(emitterRing1, emitterMat);
    eMesh1.rotation.x = Math.PI / 2;
    const eMesh2 = new THREE.Mesh(emitterRing2, emitterMat);
    eMesh2.rotation.x = Math.PI / 2;
    const eMesh3 = new THREE.Mesh(emitterRing3, emitterMat);
    eMesh3.rotation.x = Math.PI / 2;
    baseEmitterGroup.add(eMesh1, eMesh2, eMesh3);

    // ── 5H. Dynamic 3D Audio Waveform Spectrum Rings ──
    const spectrumRingsGroup = new THREE.Group();
    energyCoreRoot.add(spectrumRingsGroup);

    const SPECTRUM_POINTS = 64;
    const spectrumRadii = [1.52, 2.12, 2.76];
    const spectrumColors = [0x38bdf8, 0xf8fafc, 0xf59e0b]; // Cyan, White, Neural Amber
    const spectrumLineMeshes: THREE.LineLoop[] = [];
    const spectrumOrigPositions: THREE.Vector3[][] = [];

    spectrumRadii.forEach((baseRadius, rIdx) => {
      const points: THREE.Vector3[] = [];
      const origs: THREE.Vector3[] = [];
      for (let i = 0; i < SPECTRUM_POINTS; i++) {
        const theta = (i / SPECTRUM_POINTS) * Math.PI * 2;
        const x = Math.cos(theta) * baseRadius;
        const z = Math.sin(theta) * baseRadius;
        const v = new THREE.Vector3(x, 0, z);
        points.push(v.clone());
        origs.push(v.clone());
      }
      spectrumOrigPositions.push(origs);

      const sGeo = new THREE.BufferGeometry().setFromPoints(points);
      const sMat = new THREE.LineBasicMaterial({
        color: spectrumColors[rIdx],
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
      });
      const sLoop = new THREE.LineLoop(sGeo, sMat);
      sLoop.rotation.x = Math.PI * 0.12 * (rIdx === 1 ? -1 : 1);
      sLoop.rotation.z = Math.PI * 0.08 * (rIdx === 2 ? 1 : -1);
      spectrumRingsGroup.add(sLoop);
      spectrumLineMeshes.push(sLoop);
    });

    // 6. Interactive Drag & Touch Gestures
    let isDragging = false;
    let previousPointerPosition = { x: 0, y: 0 };
    let touchDistance = 0;
    let dragTickThrottle = 0;

    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      isDragging = true;
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
      previousPointerPosition = { x: clientX, y: clientY };

      if ('touches' in e && e.touches.length === 2) {
        touchDistance = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
      }
    };

    const onPointerMove = (e: MouseEvent | TouchEvent) => {
      if (!isDragging) return;

      if ('touches' in e && e.touches.length === 2) {
        // Pinch to zoom
        const currentDistance = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        const diff = (currentDistance - touchDistance) * 0.008;
        _targetZoom = THREE.MathUtils.clamp(_targetZoom - diff, 2.4, 7.2);
        touchDistance = currentDistance;
        return;
      }

      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

      const deltaX = clientX - previousPointerPosition.x;
      const deltaY = clientY - previousPointerPosition.y;

      const speedFactor = 0.0055 * configRef.current.rotationSpeedMultiplier;
      _targetRotation.y += deltaX * speedFactor;
      _targetRotation.x += deltaY * speedFactor;

      _targetRotation.x = THREE.MathUtils.clamp(_targetRotation.x, -Math.PI / 2.3, Math.PI / 2.3);

      previousPointerPosition = { x: clientX, y: clientY };

      const now = performance.now();
      if (now - dragTickThrottle > 140) {
        soundFx.playDragTick();
        dragTickThrottle = now;
      }
    };

    const onPointerUp = () => {
      isDragging = false;
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      _targetZoom = THREE.MathUtils.clamp(_targetZoom + e.deltaY * 0.003, 2.4, 7.2);
    };

    const domElement = renderer.domElement;
    domElement.addEventListener('mousedown', onPointerDown);
    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', onPointerUp);

    domElement.addEventListener('touchstart', onPointerDown, { passive: true });
    window.addEventListener('touchmove', onPointerMove, { passive: true });
    window.addEventListener('touchend', onPointerUp);
    domElement.addEventListener('wheel', onWheel, { passive: false });

    // 7. Window Resize Handler
    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    // 8. Animation Render Loop
    let animationFrameId: number;
    const clock = new THREE.Clock();
    const _freqArray = new Uint8Array(32);

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      const delta = Math.min(clock.getDelta(), 0.1);
      const elapsedTime = clock.getElapsedTime();

      const currentState = stateRef.current;
      const currentConfig = configRef.current;

      // Update wireframe mode dynamically
      if (coronaMat.wireframe !== currentConfig.wireframe) {
        coronaMat.wireframe = currentConfig.wireframe;
      }

      // Smooth camera damping (zoom)
      _currentZoom = THREE.MathUtils.damp(_currentZoom, _targetZoom, 8, delta);
      camera.position.z = _currentZoom;

      // Smooth view rotation damping
      _currentRotation.x = THREE.MathUtils.damp(_currentRotation.x, _targetRotation.x, 9, delta);
      _currentRotation.y = THREE.MathUtils.damp(_currentRotation.y, _targetRotation.y, 9, delta);

      // Natural energy core rotation when not dragging
      if (!isDragging) {
        let naturalSpin = 0.35;
        if (currentState === 'LISTENING') naturalSpin = 0.55;
        if (currentState === 'THINKING') naturalSpin = 1.35;
        if (currentState === 'SPEAKING') naturalSpin = 0.75;
        if (currentState === 'WORKING') naturalSpin = 1.0;
        if (currentState === 'ERROR') naturalSpin = 0.18;

        _targetRotation.y += delta * naturalSpin * currentConfig.rotationSpeedMultiplier;
      }

      energyCoreRoot.rotation.x = _currentRotation.x;
      energyCoreRoot.rotation.y = _currentRotation.y;

      // State-specific energy dynamics
      let coreScale = 1.0;
      let latticeScale = 1.0;
      let coronaScale = 1.0;
      let coreBrightness = 8.0;
      let globalSpeedMultiplier = 1.0;
      let particleSpeedFactor = 1.0;

      switch (currentState) {
        case 'IDLE': {
          // Hypnotic white energy breathing cycle
          const breath = Math.sin(elapsedTime * 2.0);
          coreScale = 1.0 + breath * 0.04;
          latticeScale = 1.0 + breath * 0.02;
          coronaScale = 1.0 + breath * 0.05;
          coreBrightness = 7.5 + breath * 1.5;
          break;
        }
        case 'LISTENING': {
          // Concentrated receptive white bloom modulated dynamically by live microphone audio amplitude
          const amp = audioAmplitudeRef.current;
          const shimmer = Math.sin(elapsedTime * 7.0) * 0.04;
          const voiceFactor = amp > 0.02 ? amp : 0;
          coreScale = 1.05 + shimmer + voiceFactor * 0.22;
          latticeScale = 1.04 + shimmer * 0.8 + voiceFactor * 0.15;
          coronaScale = 1.12 + shimmer * 1.5 + voiceFactor * 0.32;
          coreBrightness = 11.0 + shimmer * 8 + voiceFactor * 10;
          globalSpeedMultiplier = 1.4 + voiceFactor * 1.2;
          particleSpeedFactor = 1.6 + voiceFactor * 1.6;
          break;
        }
        case 'THINKING': {
          // Rapid energy lattice oscillation and accelerated ring rotation
          const isSerious = currentConfig.intelligenceMode === 'serious';
          const speedBoost = isSerious ? 1.8 : 1.3;
          const fastPlasma = Math.sin(elapsedTime * (isSerious ? 18.0 : 14.0)) * 0.06;
          coreScale = 1.1 + fastPlasma;
          latticeScale = 1.08 + fastPlasma * 1.2;
          coronaScale = 1.25 + fastPlasma * 2.0;
          coreBrightness = (isSerious ? 16.0 : 12.0) + fastPlasma * 14;
          globalSpeedMultiplier = 2.4 * speedBoost;
          particleSpeedFactor = 3.2 * speedBoost;
          break;
        }
        case 'SPEAKING': {
          // Harmonic speech pulsations synced with live audio amplitude
          const amp = audioAmplitudeRef.current;
          const voiceWave = amp > 0.04
            ? amp
            : Math.abs(Math.sin(elapsedTime * 4.5) * Math.cos(elapsedTime * 7.0));
          coreScale = 0.96 + voiceWave * 0.22;
          latticeScale = 0.98 + voiceWave * 0.14;
          coronaScale = 1.06 + voiceWave * 0.32;
          coreBrightness = 8.5 + voiceWave * 8.5;
          globalSpeedMultiplier = 1.2 + voiceWave * 1.5;
          particleSpeedFactor = 1.5 + voiceWave * 1.8;
          break;
        }
        case 'WORKING': {
          // High-output reactor processing state
          const flow = Math.sin(elapsedTime * 6.0) * 0.035;
          coreScale = 1.04 + flow;
          latticeScale = 1.03 + flow;
          coronaScale = 1.15 + flow * 1.4;
          coreBrightness = 10.0;
          globalSpeedMultiplier = 1.9;
          particleSpeedFactor = 2.4;
          break;
        }
        case 'ERROR': {
          // Gentle muted cool-silver pulsation
          const calmPulse = Math.sin(elapsedTime * 1.2) * 0.02;
          coreScale = 0.94 + calmPulse;
          latticeScale = 0.96 + calmPulse;
          coronaScale = 0.98 + calmPulse;
          coreBrightness = 3.5;
          globalSpeedMultiplier = 0.3;
          particleSpeedFactor = 0.4;
          break;
        }
      }

      // Apply dynamic scale transforms
      innerSingularityMesh.scale.setScalar(coreScale);
      coreFlareMesh.scale.setScalar(coreScale * (1.0 + Math.sin(elapsedTime * 3.5) * 0.02));
      coronaMesh.scale.setScalar(coronaScale);
      latticeMesh1.scale.setScalar(latticeScale);
      latticeMesh2.scale.setScalar(latticeScale);
      meridianFilamentsGroup.scale.setScalar(latticeScale);
      nexusNodesMesh.scale.setScalar(latticeScale);

      // Core point light intensity
      corePointLight.intensity = coreBrightness * currentConfig.bloomIntensity;

      // Color adjustments for error state vs pristine white
      if (currentState === 'ERROR') {
        innerSingularityMat.color.setHex(0x94a3b8);
        coreFlareMat.color.setHex(0x64748b);
        latticeMat1.color.setHex(0x94a3b8);
        nexusNodeMat.color.setHex(0x94a3b8);
      } else {
        innerSingularityMat.color.setHex(0xffffff);
        coreFlareMat.color.setHex(0xf8fafc);
        latticeMat1.color.setHex(0xffffff);
        nexusNodeMat.color.setHex(0xffffff);
      }

      // Counter-rotate the dual geodesic lattices for technological intricate look
      latticeMesh1.rotation.y += delta * 0.35 * globalSpeedMultiplier;
      latticeMesh1.rotation.x += delta * 0.15 * globalSpeedMultiplier;

      latticeMesh2.rotation.y -= delta * 0.45 * globalSpeedMultiplier;
      latticeMesh2.rotation.z += delta * 0.25 * globalSpeedMultiplier;

      meridianFilamentsGroup.rotation.y += delta * 0.25 * globalSpeedMultiplier;
      meridianFilamentsGroup.rotation.x -= delta * 0.18 * globalSpeedMultiplier;

      // Rotate each of the 6 gyroscopic orbital rings with its specific velocity
      ringConfigs.forEach((rc, idx) => {
        const group = orbitalRingGroups[idx];
        if (group) {
          group.rotation.y += delta * rc.speed * globalSpeedMultiplier;
        }
      });

      // Animate floating white sparks and particles
      for (let i = 0; i < particleCount; i++) {
        const phase = particlePhases[i] + elapsedTime * particleSpeeds[i] * particleSpeedFactor * 0.6;
        const radius = particleRadii[i];
        const y = particleHeights[i] + Math.sin(elapsedTime * 2.2 + i) * 0.2 + Math.sin(phase) * particleTilts[i];

        dummy.position.set(Math.cos(phase) * radius, y, Math.sin(phase) * radius);
        dummy.rotation.x = phase * 2;
        dummy.rotation.y = phase * 1.5;
        dummy.scale.setScalar((0.5 + Math.sin(phase) * 0.25) * (currentState === 'ERROR' ? 0.5 : 1.0));
        dummy.updateMatrix();
        particleMesh.setMatrixAt(i, dummy.matrix);
      }
      particleMesh.instanceMatrix.needsUpdate = true;

      // Base telemetry floor rings rotation
      baseEmitterGroup.rotation.y += delta * 0.12;

      // Modulate Dynamic 3D Audio Waveform Spectrum Rings
      voiceService.getByteFrequencyData(_freqArray);
      let avgFreq = 0;
      for (let i = 0; i < 32; i++) {
        avgFreq += _freqArray[i];
      }
      avgFreq /= 32 * 255; // Normalized 0.0 .. 1.0

      const isAudioActive = avgFreq > 0.02 || currentState === 'SPEAKING' || currentState === 'LISTENING';
      spectrumRingsGroup.rotation.y += delta * (0.35 + avgFreq * 2.2);

      spectrumLineMeshes.forEach((loop, rIdx) => {
        const posAttr = loop.geometry.attributes.position as THREE.BufferAttribute;
        const origs = spectrumOrigPositions[rIdx];
        const phaseOffset = elapsedTime * 4.5 + rIdx * 1.8;

        for (let i = 0; i < SPECTRUM_POINTS; i++) {
          const bin = (i + rIdx * 5) % 32;
          const freqNorm = _freqArray[bin] / 255.0;
          const ripple = Math.sin(phaseOffset + i * 0.35) * (0.03 + freqNorm * 0.28);
          const orig = origs[i];
          const scale = 1.0 + (isAudioActive ? freqNorm * 0.42 + ripple : Math.sin(elapsedTime * 2.0 + i * 0.2) * 0.02);

          posAttr.setXYZ(i, orig.x * scale, orig.y + (ripple * 0.18), orig.z * scale);
        }
        posAttr.needsUpdate = true;
        (loop.material as THREE.LineBasicMaterial).opacity = 0.2 + (isAudioActive ? avgFreq * 0.7 + 0.35 : 0.12);
      });

      renderer.render(scene, camera);
    };

    animate();

    // 9. Cleanup & Resource Disposal
    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', onResize);
      domElement.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('mousemove', onPointerMove);
      window.removeEventListener('mouseup', onPointerUp);
      domElement.removeEventListener('touchstart', onPointerDown);
      window.removeEventListener('touchmove', onPointerMove);
      window.removeEventListener('touchend', onPointerUp);
      domElement.removeEventListener('wheel', onWheel);

      // Dispose geometries & materials
      innerSingularityGeo.dispose();
      innerSingularityMat.dispose();
      coreFlareGeo.dispose();
      coreFlareMat.dispose();
      coronaGeo.dispose();
      coronaMat.dispose();
      latticeGeo1.dispose();
      wireframeGeo1.dispose();
      latticeMat1.dispose();
      latticeGeo2.dispose();
      wireframeGeo2.dispose();
      latticeMat2.dispose();
      nexusNodeGeo.dispose();
      nexusNodeMat.dispose();
      meridianGeo.dispose();
      meridianMat.dispose();
      particleGeo.dispose();
      particleMat.dispose();
      emitterRing1.dispose();
      emitterRing2.dispose();
      emitterRing3.dispose();
      emitterMat.dispose();
      ringNodeSharedGeo.dispose();
      ringNodeSharedMat.dispose();

      ringGeometries.forEach((g) => g.dispose());
      ringMaterials.forEach((m) => m.dispose());

      renderer.dispose();

      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div
      ref={mountRef}
      className="w-full h-full cursor-grab active:cursor-grabbing relative overflow-hidden select-none touch-none"
      title="Drag energy core to rotate, pinch/scroll to zoom"
    />
  );
};
