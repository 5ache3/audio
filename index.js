import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

let scene, camera, renderer, composer, analyser, audioCtx, dataArray, leftAnalyser, rightAnalyser, dataArrayLeft, dataArrayRight, splitterNode;
let ambientLight;
let particles = [], time = 0, smoothedAudio = new Array(10).fill(0);
let currentShape = 'sphere';
let audioSource, audioBuffer, waveformData, playbackStartTime, playbackOffset = 0;
let isDragging = false, isPaused = false, pauseTime = 0, dragProgress = null;
let micWaveformHistory = [], micStartTime, lastSeekTime = 0, dragHandlersAttached = false;
let sound_mode = 'mic', waveCanvas, waveCtx, freqLeftCanvas, freqLeftCtx, freqRightCanvas, freqRightCtx;
let mediaElement, mediaSource;
let showWaveLine = true;

const PARTICLE_COUNT_PER_GROUP = 1000, TOTAL_GROUPS = 10, MAX_MIC_HISTORY = 1000, SEEK_THROTTLE_MS = 50;
const COLORS = [0xff0044, 0xff4400, 0xffcc00, 0x88ff00, 0x00ff88, 0x00d4ff, 0x0066ff, 0x4400ff, 0x8800ff, 0xff00cc];

function init() {
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x000000, 0.02);
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 12;
    renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ReinhardToneMapping;
    document.getElementById('container').appendChild(renderer.domElement);

    const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
    bloomPass.strength = 2.0; bloomPass.radius = 0.5; bloomPass.threshold = 0.1;
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(bloomPass);
    window.bloomPass = bloomPass;

    createParticles(currentShape);
    ambientLight = new THREE.AmbientLight(0x444444);
    scene.add(ambientLight);
    
    initCanvases();
    useMicrophone();
    document.getElementById('uploadBtn').onclick = uploadAndPlay;
    document.getElementById('micBtn').onclick = useMicrophone;
    const btn = document.getElementById('playPauseBtn');
    if (btn) btn.onclick = togglePlayPause;
    const shapeSel = document.getElementById('shapeSelect');
    if (shapeSel) {
        shapeSel.onchange = () => { const v = document.getElementById('shapeSelect').value; createParticles(v); };
        buildCustomShapeSelect(shapeSel);
    }
    const hideBtn = document.getElementById('hideDashboardBtn');
    if (hideBtn) hideBtn.onclick = toggleMenu;
    const hideLineBtn = document.getElementById('hideLineBtn');
    if (hideLineBtn) hideLineBtn.onclick = () => { showWaveLine = !showWaveLine; hideLineBtn.textContent = showWaveLine ? 'Hide Line' : 'Show Line'; };
    window.addEventListener('resize', onWindowResize);
    window.toggleMenu = toggleMenu;
    setupWaveformDragHandlers();
}

function initCanvases() {
    waveCanvas = document.getElementById("waveform");
    if (waveCanvas) { waveCtx = waveCanvas.getContext("2d"); resizeWaveCanvas(); }
    freqLeftCanvas = document.getElementById("freqLeft");
    if (freqLeftCanvas) { freqLeftCtx = freqLeftCanvas.getContext("2d"); resizeFreqCanvas(freqLeftCanvas); }
    freqRightCanvas = document.getElementById("freqRight");
    if (freqRightCanvas) { freqRightCtx = freqRightCanvas.getContext("2d"); resizeFreqCanvas(freqRightCanvas); }
}

function clearParticles() {
    particles.forEach(p => scene.remove(p));
    particles = [];
}

function createParticles(shape) {
    clearParticles();
    currentShape = shape;
    switch(shape) {
        case 'octahedron':
            createTetrahedronParticles();
            break;
        case 'cylinder':
            createCylinderParticles();
            break;
        case 'torus':
            createTorusParticles();
            break;
        case 'spiral':
            createSpiralParticles();
            break;
        case 'sphere':
        default:
            createSphereParticles();
    }
}

function createSphereParticles() {
    for(let s = 0; s < TOTAL_GROUPS; s++) {
        const geometry = new THREE.BufferGeometry();
        const posArray = new Float32Array(PARTICLE_COUNT_PER_GROUP * 3);
        const originalPos = new Float32Array(PARTICLE_COUNT_PER_GROUP * 3);
        const randoms = new Float32Array(PARTICLE_COUNT_PER_GROUP);
        const baseRadius = 2.0 + (s * 0.3);
        for(let i = 0; i < PARTICLE_COUNT_PER_GROUP; i++) {
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos((Math.random() * 2) - 1);
            const x = baseRadius * Math.sin(phi) * Math.cos(theta);
            const y = baseRadius * Math.sin(phi) * Math.sin(theta);
            const z = baseRadius * Math.cos(phi);
            posArray[i*3] = x;
            posArray[i*3+1] = y;
            posArray[i*3+2] = z;
            originalPos[i*3] = x;
            originalPos[i*3+1] = y;
            originalPos[i*3+2] = z;
            randoms[i] = Math.random();
        }
        geometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
        const material = new THREE.PointsMaterial({ color: COLORS[s], size: 0.05, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false });
        const points = new THREE.Points(geometry, material);
        points.userData = { originalPos, randoms, radius: baseRadius, type: 'sphere', rotationSpeed: { x: (Math.random() - 0.5) * 0.01, y: (Math.random() - 0.5) * 0.01, z: (Math.random() - 0.5) * 0.01 } };
        scene.add(points);
        particles.push(points);
    }
}

function createTetrahedronParticles() {
    const radius = 2.5;
    for(let s = 0; s < TOTAL_GROUPS; s++) {
        const geometry = new THREE.BufferGeometry();
        const posArray = new Float32Array(PARTICLE_COUNT_PER_GROUP * 3);
        const originalPos = new Float32Array(PARTICLE_COUNT_PER_GROUP * 3);
        const randoms = new Float32Array(PARTICLE_COUNT_PER_GROUP);
        const groupScale = 1.0 + (s * 0.15);
        for(let i = 0; i < PARTICLE_COUNT_PER_GROUP; i++) {
            let x = (Math.random() * 2 - 1) * radius;
            let y = (Math.random() * 2 - 1) * radius;
            let z = (Math.random() * 2 - 1) * radius;
            let length = Math.sqrt(x*x + y*y + z*z);
            x /= length; y /= length; z /= length;
            const projFactor = radius / (Math.abs(x) + Math.abs(y) + Math.abs(z));
            x *= projFactor * groupScale * 0.8;
            y *= projFactor * groupScale * 0.8;
            z *= projFactor * groupScale * 0.8;
            posArray[i*3] = x; posArray[i*3+1] = y; posArray[i*3+2] = z;
            originalPos[i*3] = x; originalPos[i*3+1] = y; originalPos[i*3+2] = z;
            randoms[i] = Math.random();
        }
        geometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
        const material = new THREE.PointsMaterial({ color: COLORS[s], size: 0.03, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false });
        const points = new THREE.Points(geometry, material);
        points.userData = { originalPos, randoms, radius, type: 'octahedron', rotationSpeed: { x: (Math.random() - 0.5) * 0.01, y: (Math.random() - 0.5) * 0.01, z: (Math.random() - 0.5) * 0.01 } };
        scene.add(points);
        particles.push(points);
    }
}

function createCylinderParticles() {
    const cylinderHeight = 8;
    const cylinderRadius = 0.5;
    for(let s = 0; s < TOTAL_GROUPS; s++) {
        const geometry = new THREE.BufferGeometry();
        const posArray = new Float32Array(PARTICLE_COUNT_PER_GROUP * 3);
        const originalPos = new Float32Array(PARTICLE_COUNT_PER_GROUP * 3);
        const randoms = new Float32Array(PARTICLE_COUNT_PER_GROUP);
        const groupRadius = cylinderRadius + (s * 0.1);
        for(let i = 0; i < PARTICLE_COUNT_PER_GROUP; i++) {
            const h = Math.random();
            const theta = Math.random() * Math.PI * 2;
            const r = groupRadius + (Math.random() - 0.5) * 0.2;
            const x = r * Math.cos(theta);
            const z = r * Math.sin(theta);
            const y = (h - 0.5) * cylinderHeight;
            posArray[i*3] = x; posArray[i*3+1] = y; posArray[i*3+2] = z;
            originalPos[i*3] = x; originalPos[i*3+1] = y; originalPos[i*3+2] = z;
            randoms[i] = Math.random();
        }
        geometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
        const material = new THREE.PointsMaterial({ color: COLORS[s], size: 0.04, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
        const points = new THREE.Points(geometry, material);
        points.userData = { originalPos, randoms, radius: groupRadius, type: 'cylinder', rotationSpeed: { x: (Math.random() - 0.5) * 0.01, y: (Math.random() - 0.5) * 0.01, z: (Math.random() - 0.5) * 0.01 } };
        scene.add(points);
        particles.push(points);
    }
}

function createTorusParticles() {
    const tubeRadius = 1.5;
    for(let s = 0; s < TOTAL_GROUPS; s++) {
        const geometry = new THREE.BufferGeometry();
        const posArray = new Float32Array(PARTICLE_COUNT_PER_GROUP * 3);
        const originalPos = new Float32Array(PARTICLE_COUNT_PER_GROUP * 3);
        const randoms = new Float32Array(PARTICLE_COUNT_PER_GROUP);
        const innerRadius = 2.5 + (s * 0.3);
        for(let i = 0; i < PARTICLE_COUNT_PER_GROUP; i++) {
            const u = Math.random() * Math.PI * 2;
            const v = Math.random() * Math.PI * 2;
            const x = (innerRadius + tubeRadius * Math.cos(v)) * Math.cos(u);
            const y = tubeRadius * Math.sin(v);
            const z = (innerRadius + tubeRadius * Math.cos(v)) * Math.sin(u);
            posArray[i*3] = x; posArray[i*3+1] = y; posArray[i*3+2] = z;
            originalPos[i*3] = x; originalPos[i*3+1] = y; originalPos[i*3+2] = z;
            randoms[i] = Math.random();
        }
        geometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
        const material = new THREE.PointsMaterial({ color: COLORS[s], size: 0.04, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
        const points = new THREE.Points(geometry, material);
        points.userData = { originalPos, randoms, radius: innerRadius, type: 'torus', rotationSpeed: { x: (Math.random() - 0.5) * 0.01, y: (Math.random() - 0.5) * 0.01, z: (Math.random() - 0.5) * 0.01 } };
        scene.add(points);
        particles.push(points);
    }
}

function createSpiralParticles() {
    const spiralHeight = 10;
    const spiralRadius = 1.5;
    const turns = 1.2;
    for(let s = 0; s < TOTAL_GROUPS; s++) {
        const geometry = new THREE.BufferGeometry();
        const posArray = new Float32Array(PARTICLE_COUNT_PER_GROUP * 3);
        const originalPos = new Float32Array(PARTICLE_COUNT_PER_GROUP * 3);
        const randoms = new Float32Array(PARTICLE_COUNT_PER_GROUP);
        const groupRadius = spiralRadius + (s * 0.1);
        for(let i = 0; i < PARTICLE_COUNT_PER_GROUP; i++) {
            const t = i / PARTICLE_COUNT_PER_GROUP;
            const theta = t * Math.PI * 2 * turns;
            const r = groupRadius + (Math.random() - 0.5) * 0.1;
            const x = r * Math.cos(theta);
            const z = r * Math.sin(theta);
            const y = (t - 0.5) * spiralHeight;
            posArray[i*3] = x; posArray[i*3+1] = y; posArray[i*3+2] = z;
            originalPos[i*3] = x; originalPos[i*3+1] = y; originalPos[i*3+2] = z;
            randoms[i] = Math.random();
        }
        geometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
        const material = new THREE.PointsMaterial({ color: COLORS[s], size: 0.03, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false });
        const points = new THREE.Points(geometry, material);
        points.userData = { originalPos, randoms, radius: groupRadius, type: 'spiral', rotationSpeed: { x: (Math.random() - 0.5) * 0.01, y: (Math.random() - 0.5) * 0.01, z: (Math.random() - 0.5) * 0.01 } };
        scene.add(points);
        particles.push(points);
    }
}

function animate() {
    requestAnimationFrame(animate);
    time += 0.005;

    let bands = new Array(10).fill(0);
    if (analyser && dataArray) {
        analyser.getByteFrequencyData(dataArray);
        const binSize = Math.floor(dataArray.length / 10);
        for (let i = 0; i < 10; i++) {
            let sum = 0;
            for (let j = 0; j < binSize; j++) sum += dataArray[i * binSize + j];
            bands[i] = (sum / binSize) / 255;
        }
    }

    for(let i=0; i<10; i++) smoothedAudio[i] += (bands[i] - smoothedAudio[i]) * 0.15;
    const bassIntensity = smoothedAudio[0];
    const trebleIntensity = smoothedAudio[9];
    const emotionFactor = bassIntensity * 0.5 + trebleIntensity * 0.5;
    const densityRaw = (smoothedAudio[0] * 5 + smoothedAudio[1] + smoothedAudio[2] + smoothedAudio[3] + smoothedAudio[4]) / 6;
    const densityFactor = densityRaw * 0.6 + 0.4;
    if (ambientLight) ambientLight.intensity = 0.01 + densityFactor * 0.03;
    if (window.bloomPass) window.bloomPass.strength = 2.0 + densityFactor * 1.5;

    particles.forEach((p, idx) => {
        const positions = p.geometry.attributes.position.array;
        const originals = p.userData.originalPos;
        const rand = p.userData.randoms;
        const particleType = p.userData.type;
        const intensity = smoothedAudio[idx];
        
        p.rotation.x += p.userData.rotationSpeed.x + (densityFactor * 0.02);
        p.rotation.y += p.userData.rotationSpeed.y + (densityFactor * 0.03);

        for(let i = 0; i < PARTICLE_COUNT_PER_GROUP; i++) {
            const ix = i * 3;
            const ox = originals[ix];
            const oy = originals[ix+1];
            const oz = originals[ix+2];
            const vibration = Math.sin(time * 8 + ox * 2 + intensity * 15) * 0.10;
            const noise = Math.cos(time * 5 + oy * 3) * Math.sin(time * 4 + oz * 3) * 0.4;
            const explosion = 1 + (intensity * (1.5 + rand[i] * 0.5));
            let finalMagnitude;
            const magnitude = Math.sqrt(ox*ox + oy*oy + oz*oz);
            const dirX = ox / magnitude;
            const dirY = oy / magnitude;
            const dirZ = oz / magnitude;
            switch (particleType) {
                case 'sphere':
                    finalMagnitude = magnitude * explosion + vibration + noise;
                    positions[ix]   = dirX * finalMagnitude;
                    positions[ix+1] = dirY * finalMagnitude;
                    positions[ix+2] = dirZ * finalMagnitude;
                    break;
                case 'octahedron':
                    positions[ix]   = ox * (1 + intensity * 1.5) + vibration;
                    positions[ix+1] = oy * (1 + intensity * 1.5) + vibration;
                    positions[ix+2] = oz * (1 + intensity * 1.5) + vibration;
                    break;
                case 'cylinder':
                    positions[ix]   = ox * explosion;
                    positions[ix+1] = oy + intensity * 1.5 * Math.sin(time * 5 + rand[i] * 5);
                    positions[ix+2] = oz * explosion;
                    break;
                case 'torus':
                    finalMagnitude = magnitude * (1 + intensity * 0.5);
                    positions[ix]   = dirX * finalMagnitude;
                    positions[ix+1] = dirY * finalMagnitude * explosion;
                    positions[ix+2] = dirZ * finalMagnitude;
                    break;
                case 'spiral':
                    positions[ix]   = ox * explosion;
                    positions[ix+1] = oy + intensity * 2.0 * Math.sin(time * 8 + rand[i] * 5);
                    positions[ix+2] = oz * explosion;
                    break;
            }
        }
        p.geometry.attributes.position.needsUpdate = true;
        p.material.size = 0.04 + (intensity * 0.15);
        p.material.opacity = 0.2 + (intensity * 0.8);
    });

    const cameraDistance = 12 - (emotionFactor * 3);
    camera.position.x = Math.sin(time * 0.5 * densityFactor) * cameraDistance;
    camera.position.z = Math.cos(time * 0.5 * densityFactor) * cameraDistance;
    const shake = bassIntensity * 2;
    camera.position.y = Math.sin(time * 15) * shake * 0.1;
    camera.position.z += Math.cos(time * 7) * shake * 0.1;
    camera.lookAt(0,0,0);
    composer.render();
    drawWaveform();
    drawFrequencyVisualizers();
}

function stopAudioSource() {
    if (audioSource) {
        try { audioSource.stop(); } catch(e) {}
        try { audioSource.disconnect(); } catch(e) {}
        audioSource = null;
    }
}

function uploadAndPlay() {
    const input = document.getElementById('audioFile');
    if (!input) return;
    const file = input.files && input.files[0];
    if (!file) {
        const handler = () => { uploadAndPlay(); };
        input.addEventListener('change', handler, { once: true });
        try { input.click(); } catch(e) {}
        return;
    }
    sound_mode = 'up';
    setupAudioFromFile(file);
}

function useMicrophone() {
    sound_mode = 'mic';
    stopAudioSource();
    if (analyser) { try { analyser.disconnect(); } catch(e) {} }
    playbackStartTime = playbackOffset = 0;
    audioBuffer = waveformData = null;
    navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => setupAudioStream(stream))
        .catch(e => alert('Mic denied'));
}

function setupAudio(url) {
    if (audioCtx) audioCtx.close();
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    waveformData = audioBuffer = audioSource = null;
    playbackStartTime = playbackOffset = 0;
    micWaveformHistory = [];
    
    fetch(url).then(r => r.arrayBuffer())
        .then(buffer => audioCtx.decodeAudioData(buffer))
        .then(decoded => {
            audioBuffer = decoded;
            generateWaveformData(decoded);
            isPaused = pauseTime = playbackOffset = 0;
            updatePlayPauseButton();
            startPlayback(0);
        });
}

async function setupAudioFromFile(file) {
    if (!audioCtx || audioCtx.state === 'closed') {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    try { await audioCtx.resume(); } catch(e) {}
    waveformData = null;
    audioBuffer = null;
    audioSource = null;
    playbackStartTime = null;
    playbackOffset = 0;
    micWaveformHistory = [];
    isPaused = false;
    pauseTime = 0;
    if (mediaElement) {
        try { mediaElement.pause(); } catch(e) {}
        try { mediaElement.src = ''; } catch(e) {}
        mediaElement = null;
    }
    if (mediaSource) {
        try { mediaSource.disconnect(); } catch(e) {}
        mediaSource = null;
    }
    try {
        const arrayBuffer = await file.arrayBuffer();
        const decoded = await decodeArrayBuffer(arrayBuffer);
        audioBuffer = decoded;
        generateWaveformData(decoded);
        isPaused = false;
        pauseTime = 0;
        playbackOffset = 0;
        updatePlayPauseButton();
        startPlayback(0);
    } catch(err) {
        const url = URL.createObjectURL(file);
        if (!audioCtx || audioCtx.state === 'closed') {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        try { await audioCtx.resume(); } catch(e) {}
        const el = new Audio();
        el.src = url;
        el.crossOrigin = 'anonymous';
        el.preload = 'auto';
        el.loop = false;
        mediaElement = el;
        const source = audioCtx.createMediaElementSource(el);
        mediaSource = source;
        connectAnalyser(source);
        try { await el.play(); } catch(e) {}
        updatePlayPauseButton();
        el.onended = () => {
            try { el.pause(); } catch(e) {}
            try { el.currentTime = 0; } catch(e) {}
            updatePlayPauseButton();
        };
    }
}

function decodeArrayBuffer(buffer) {
    return new Promise((resolve, reject) => {
        try {
            audioCtx.decodeAudioData(buffer, resolve, reject);
        } catch(e) {
            audioCtx.decodeAudioData(buffer).then(resolve).catch(reject);
        }
    });
}

function startPlayback(offset) {
    if (!audioBuffer || !audioCtx || audioCtx.state === 'closed') return;
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(e => console.error('Failed to resume:', e));
    
    // Stop current source if playing
    stopAudioSource();
    
    // Ensure offset is valid
    const validOffset = Math.max(0, Math.min(offset, audioBuffer.duration));
    
    try {
        const source = audioCtx.createBufferSource();
        source.buffer = audioBuffer;
        audioSource = source;
        playbackOffset = validOffset; // Use the validated offset
        playbackStartTime = audioCtx.currentTime;
        isPaused = false;
        pauseTime = 0;
        
        connectAnalyser(source);
        source.start(0, playbackOffset);
        updatePlayPauseButton();
        
        source.onended = () => {
            if (source !== audioSource) return;
            playbackOffset = 0;
            playbackStartTime = null;
            isPaused = true;
            audioSource = null;
            updatePlayPauseButton();
        };
    } catch(e) {
        console.error('Failed to start playback:', e);
        audioSource = null;
        isPaused = false;
        updatePlayPauseButton();
    }
}

function togglePlayPause() {
    if (sound_mode !== 'up' || !audioCtx) return;
    if (mediaElement && !audioBuffer) {
        if (mediaElement.paused) { try { mediaElement.play(); } catch(e) {} }
        else { try { mediaElement.pause(); } catch(e) {} }
        updatePlayPauseButton();
        return;
    }
    if (!audioBuffer) return;
    
    if (isPaused) {
        // Resume: start playback from saved offset (don't recalculate)
        const resumeOffset = playbackOffset;
        if (resumeOffset >= 0 && resumeOffset <= audioBuffer.duration) {
            startPlayback(resumeOffset);
        } else {
            // If offset is invalid, start from beginning
            playbackOffset = 0;
            startPlayback(0);
        }
    } else {
        // Pause: stop and save current position
        if (audioSource && playbackStartTime !== null) {
            // Calculate current position accurately before stopping
            const elapsed = audioCtx.currentTime - playbackStartTime;
            playbackOffset = Math.max(0, Math.min(elapsed + playbackOffset, audioBuffer.duration));
            stopAudioSource();
            playbackStartTime = null;
        }
        // If no source, keep the current offset (don't reset it)
        isPaused = true;
        updatePlayPauseButton();
    }
}

function updatePlayPauseButton() {
    const btn = document.getElementById('playPauseBtn');
    if (!btn) return;
    if (sound_mode === 'up' && (audioBuffer || mediaElement)) {
        btn.style.display = 'flex';
        if (audioBuffer) {
            btn.textContent = (isPaused || !audioSource) ? '▶' : '⏸';
        } else if (mediaElement) {
            btn.textContent = mediaElement.paused ? '▶' : '⏸';
        }
    } else {
        btn.style.display = 'none';
    }
}

function seekToPosition(progress) {
    if (sound_mode === 'up' && mediaElement && !audioBuffer) {
        if (!mediaElement || !isFinite(mediaElement.duration) || mediaElement.duration <= 0) return;
        const seekTimeEl = Math.max(0, Math.min(progress * mediaElement.duration, mediaElement.duration));
        try { mediaElement.currentTime = seekTimeEl; } catch(e) {}
        return;
    }
    if (!audioBuffer || !audioCtx || audioCtx.state === 'closed') return;
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(e => console.error('Failed to resume:', e));
    
    const seekTime = Math.max(0, Math.min(progress * audioBuffer.duration, audioBuffer.duration));
    
    // Always update the offset first
    playbackOffset = seekTime;
    
    // If paused, just update the offset without starting playback
    if (isPaused) {
        playbackStartTime = null;
        return;
    }
    
    // If playing, seek to the new position and continue playing
    isPaused = false;
    pauseTime = 0;
    startPlayback(seekTime);
}

function setupAudioStream(stream) {
    if (audioCtx) audioCtx.close();
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    waveformData = audioBuffer = audioSource = null;
    playbackStartTime = 0;
    micWaveformHistory = [];
    micStartTime = Date.now();
    connectAnalyser(audioCtx.createMediaStreamSource(stream));
}

function connectAnalyser(source) {
    if (!source || !audioCtx) return;
    if (analyser) { try { analyser.disconnect(); } catch(e) {} }
    if (leftAnalyser) { try { leftAnalyser.disconnect(); } catch(e) {} leftAnalyser = null; }
    if (rightAnalyser) { try { rightAnalyser.disconnect(); } catch(e) {} rightAnalyser = null; }
    if (splitterNode) { try { splitterNode.disconnect(); } catch(e) {} splitterNode = null; }
    
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.8;
    dataArray = new Uint8Array(analyser.frequencyBinCount);
    
    try {
        source.connect(analyser);
        if (sound_mode !== 'mic') analyser.connect(audioCtx.destination);
    } catch(e) {
        console.error('Failed to connect analyser:', e);
    }
    
    if (sound_mode !== 'mic') {
        try {
            splitterNode = audioCtx.createChannelSplitter(2);
            source.connect(splitterNode);
            leftAnalyser = audioCtx.createAnalyser();
            rightAnalyser = audioCtx.createAnalyser();
            leftAnalyser.fftSize = 512;
            rightAnalyser.fftSize = 512;
            leftAnalyser.smoothingTimeConstant = 0.8;
            rightAnalyser.smoothingTimeConstant = 0.8;
            dataArrayLeft = new Uint8Array(leftAnalyser.frequencyBinCount);
            dataArrayRight = new Uint8Array(rightAnalyser.frequencyBinCount);
            splitterNode.connect(leftAnalyser, 0);
            splitterNode.connect(rightAnalyser, 1);
        } catch(e) {
        }
    } else {
        dataArrayLeft = null;
        dataArrayRight = null;
    }
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
    resizeWaveCanvas();
}

function resizeWaveCanvas() {
    if (!waveCanvas) return;
    const rect = waveCanvas.getBoundingClientRect();
    const newWidth = Math.floor(rect.width);
    const newHeight = Math.floor(rect.height);
    if (waveCanvas.width !== newWidth || waveCanvas.height !== newHeight) {
        waveCanvas.width = newWidth;
        waveCanvas.height = newHeight;
        if (!waveCtx) waveCtx = waveCanvas.getContext("2d");
    }
}

function resizeFreqCanvas(canvas) {
    if (canvas) { canvas.width = 20; canvas.height = window.innerHeight * 0.6; }
}

window.addEventListener("resize", () => {
    resizeWaveCanvas();
    if (freqLeftCanvas) resizeFreqCanvas(freqLeftCanvas);
    if (freqRightCanvas) resizeFreqCanvas(freqRightCanvas);
});

function generateWaveformData(buffer) {
    const channelData = buffer.getChannelData(0);
    const targetPoints = 2000;
    const step = Math.floor(buffer.length / targetPoints);
    waveformData = [];
    
    for (let i = 0; i < targetPoints; i++) {
        const start = i * step;
        const end = Math.min(start + step, buffer.length);
        let sum = 0;
        for (let j = start; j < end; j++) sum += channelData[j];
        waveformData.push({ avg: sum / step, peak: Math.abs(sum / step) });
    }
}

function drawWaveform() {
    if (!waveCanvas) return;
    if (!waveCtx) { waveCtx = waveCanvas.getContext("2d"); if (!waveCtx) return; }

    const ctx = waveCtx, w = waveCanvas.width, h = waveCanvas.height;
    if (w <= 0 || h <= 0) return;
    ctx.clearRect(0, 0, w, h);

    if (!showWaveLine) {
        waveCanvas.style.cursor = 'default';
        if (sound_mode === 'up' && audioBuffer) {
            const duration = audioBuffer.duration || 0;
            let currentTime = playbackOffset;
            if (!isPaused && playbackStartTime !== null && audioCtx) {
                const elapsed = audioCtx.currentTime - playbackStartTime;
                currentTime = Math.min(Math.max(playbackOffset + elapsed, 0), duration);
            }
            updateTimer(currentTime, duration);
            updatePlayPauseButton();
        } else if (sound_mode === 'up' && mediaElement && !audioBuffer) {
            const ct = mediaElement && isFinite(mediaElement.currentTime) ? mediaElement.currentTime : 0;
            const dur = mediaElement && isFinite(mediaElement.duration) ? mediaElement.duration : 0;
            updateTimer(ct, dur);
            updatePlayPauseButton();
        } else if (sound_mode === 'mic') {
            const timerEl = document.getElementById('audioTimer');
            if (timerEl) timerEl.textContent = '';
            updatePlayPauseButton();
        }
        return;
    }

    if (sound_mode === 'up' && waveformData && audioBuffer) {
        waveCanvas.style.cursor = 'pointer';
        drawFileWaveform(ctx, w, h);
    } else if (sound_mode === 'mic' && analyser && dataArray) {
        waveCanvas.style.cursor = 'default';
        drawMicWaveform(ctx, w, h);
        updatePlayPauseButton();
    } else if (sound_mode === 'up' && mediaElement && !audioBuffer) {
        waveCanvas.style.cursor = 'pointer';
        drawMicWaveform(ctx, w, h);
        const ct = mediaElement && isFinite(mediaElement.currentTime) ? mediaElement.currentTime : 0;
        const dur = mediaElement && isFinite(mediaElement.duration) ? mediaElement.duration : 0;
        updateTimer(ct, dur);
        updatePlayPauseButton();
    } else {
        const timerEl = document.getElementById('audioTimer');
        if (timerEl) timerEl.textContent = '';
        waveCanvas.style.cursor = 'default';
        updatePlayPauseButton();
    }
}

function drawFileWaveform(ctx, w, h) {
    if (!waveformData || !audioBuffer || !audioCtx) return;
    
    const duration = audioBuffer.duration || 0;
    const computePosition = () => {
        if (isPaused || playbackStartTime === null) return Math.max(0, Math.min(playbackOffset, duration));
        const elapsed = (audioCtx ? audioCtx.currentTime : 0) - playbackStartTime;
        return Math.max(0, Math.min(playbackOffset + elapsed, duration));
    };
    let currentTime;
    let progress;
    if (dragProgress !== null) {
        progress = Math.max(0, Math.min(dragProgress, 1));
        currentTime = progress * duration;
    } else {
        currentTime = computePosition();
        progress = duration > 0 ? Math.min(Math.max(currentTime / duration, 0), 1) : 0;
    }
    
    const progressX = w * progress, progressIndex = Math.floor(progress * waveformData.length);
    const pointWidth = w / waveformData.length, centerY = h / 2, amplitudeMultiplier = 1.2;
    
    const gradFuture = ctx.createLinearGradient(0, 0, w, 0);
    gradFuture.addColorStop(0, "rgba(0, 102, 255, 0.25)");
    gradFuture.addColorStop(1, "rgba(0, 212, 255, 0.15)");
    ctx.strokeStyle = gradFuture; ctx.globalAlpha = 1.0; ctx.lineWidth = 6;
    ctx.beginPath();
    for (let i = progressIndex; i < waveformData.length; i++) {
        const x = i * pointWidth, amplitude = waveformData[i].avg * h * amplitudeMultiplier;
        const y = centerY - amplitude;
        (i === progressIndex) ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    
    const gradPast = ctx.createLinearGradient(0, 0, w, 0);
    gradPast.addColorStop(0, "#00bfff");
    gradPast.addColorStop(1, "#00d4ff");
    ctx.strokeStyle = gradPast; ctx.globalAlpha = 0.35; ctx.lineWidth = 10;
    ctx.beginPath();
    for (let i = 0; i <= progressIndex; i++) {
        const x = i * pointWidth, amplitude = waveformData[i].avg * h * amplitudeMultiplier;
        const y = centerY - amplitude;
        (i === 0) ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.strokeStyle = gradPast; ctx.globalAlpha = 0.95; ctx.lineWidth = 5;
    ctx.beginPath();
    for (let i = 0; i <= progressIndex; i++) {
        const x = i * pointWidth, amplitude = waveformData[i].avg * h * amplitudeMultiplier;
        const y = centerY - amplitude;
        (i === 0) ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    
    const barWidth = Math.max(3, Math.floor(w * 0.003));
    const indexClamped = Math.max(0, Math.min(progressIndex, waveformData.length - 1));
    const energy = waveformData[indexClamped].peak;
    const baseLen = Math.min(90, Math.max(40, h * 0.25));
    const shortLen = Math.min(Math.max(baseLen + energy * 40, 30), Math.max(50, h * 0.35));
    const yStart = centerY - shortLen / 2;
    const yEnd = centerY + shortLen / 2;

    ctx.save();
    ctx.shadowColor = 'rgba(0, 212, 255, 0.6)';
    ctx.shadowBlur = 12;
    const lineGrad = ctx.createLinearGradient(progressX, yStart, progressX, yEnd);
    lineGrad.addColorStop(0, '#00bfff');
    lineGrad.addColorStop(1, '#00d4ff');
    ctx.strokeStyle = lineGrad;
    ctx.lineWidth = barWidth;
    ctx.globalAlpha = 1.0;
    ctx.beginPath();
    ctx.moveTo(progressX, yStart);
    ctx.lineTo(progressX, yEnd);
    ctx.stroke();
    ctx.restore();
    
    updateTimer(currentTime, duration);
}

function drawMicWaveform(ctx, w, h) {
    const tdAnalyser = leftAnalyser || analyser;
    const tdArray = leftAnalyser ? dataArrayLeft : dataArray;
    if (!tdAnalyser || !tdArray) return;
    tdAnalyser.getByteTimeDomainData(tdArray);
    let sum = 0;
    for (let i = 0; i < tdArray.length; i++) sum += tdArray[i];
    micWaveformHistory.push(sum / tdArray.length);
    if (micWaveformHistory.length > MAX_MIC_HISTORY) micWaveformHistory.shift();
    if (micWaveformHistory.length === 0) return;
    
    const centerY = h / 2, sampleWidth = w / micWaveformHistory.length;
    ctx.strokeStyle = "#00d4ff"; ctx.globalAlpha = 0.9; ctx.lineWidth = 5;
    ctx.beginPath();
    let x = 0;
    for (let i = 0; i < micWaveformHistory.length; i++) {
        const v = micWaveformHistory[i] / 255;
        const amplitude = 1.5; // Increased amplitude multiplier
        const y = centerY - ((v - 0.5) * h * amplitude);
        (i === 0) ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        x += sampleWidth;
    }
    ctx.stroke();
    const timerEl = document.getElementById('audioTimer');
    if (timerEl) timerEl.textContent = '';
}

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function updateTimer(currentTime, duration) {
    const timerEl = document.getElementById('audioTimer');
    if (timerEl) timerEl.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;
}

function setupWaveformDragHandlers() {
    const canvas = waveCanvas;
    if (!canvas || dragHandlersAttached) return;
    
    const handleDragEnd = () => {
        if (isDragging) {
            isDragging = false;
            if (dragProgress !== null && (audioBuffer || mediaElement) && audioCtx) {
                const finalProgress = dragProgress;
                dragProgress = null;
                requestAnimationFrame(() => seekToPosition(finalProgress));
            }
        }
    };
    
    canvas.addEventListener('mousedown', (e) => {
        if (sound_mode === 'up' && (audioBuffer || mediaElement)) {
            e.preventDefault();
            isDragging = true;
            handleWaveformClick(e);
        }
    });
    
    document.addEventListener('mousemove', (e) => {
        if (isDragging && sound_mode === 'up' && (audioBuffer || mediaElement)) {
            e.preventDefault();
            handleWaveformClick(e);
        }
    });
    
    document.addEventListener('mouseup', handleDragEnd);
    canvas.addEventListener('touchstart', (e) => {
        if (sound_mode === 'up' && (audioBuffer || mediaElement)) {
            e.preventDefault();
            isDragging = true;
            handleWaveformClick(e.touches[0]);
        }
    });
    document.addEventListener('touchmove', (e) => {
        if (isDragging && sound_mode === 'up' && (audioBuffer || mediaElement)) {
            e.preventDefault();
            if (e.touches.length > 0) handleWaveformClick(e.touches[0]);
        }
    });
    document.addEventListener('touchend', handleDragEnd);
    dragHandlersAttached = true;
}

function handleWaveformClick(e) {
    if (!(audioBuffer || mediaElement) || !waveCanvas) return;
    const rect = waveCanvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const progress = Math.max(0, Math.min(1, (Math.max(0, Math.min(e.clientX - rect.left, rect.width)) / rect.width)));
    if (isDragging) {
        dragProgress = progress;
    } else {
        dragProgress = null;
        // Always seek, whether paused or playing
        seekToPosition(progress);
    }
}

function drawFrequencyVisualizers() {
    if (leftAnalyser && rightAnalyser && dataArrayLeft && dataArrayRight) {
        leftAnalyser.getByteFrequencyData(dataArrayLeft);
        rightAnalyser.getByteFrequencyData(dataArrayRight);
        if (freqLeftCtx && freqLeftCanvas) drawFrequencyBars(freqLeftCtx, freqLeftCanvas, dataArrayLeft, 0, dataArrayLeft.length);
        if (freqRightCtx && freqRightCanvas) drawFrequencyBars(freqRightCtx, freqRightCanvas, dataArrayRight, 0, dataArrayRight.length);
        return;
    }
    if (analyser && dataArray) {
        analyser.getByteFrequencyData(dataArray);
        const mid = Math.floor(dataArray.length / 2);
        if (freqLeftCtx && freqLeftCanvas) drawFrequencyBars(freqLeftCtx, freqLeftCanvas, dataArray, 0, mid);
        if (freqRightCtx && freqRightCanvas) drawFrequencyBars(freqRightCtx, freqRightCanvas, dataArray, mid, dataArray.length);
        return;
    }
    if (freqLeftCtx && freqLeftCanvas) freqLeftCtx.clearRect(0, 0, freqLeftCanvas.width, freqLeftCanvas.height);
    if (freqRightCtx && freqRightCanvas) freqRightCtx.clearRect(0, 0, freqRightCanvas.width, freqRightCanvas.height);
}

function drawFrequencyBars(ctx, canvas, arr, startIndex, endIndex) {
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const count = Math.max(1, endIndex - startIndex);
    const barWidth = w / count;
    for (let i = startIndex, x = 0; i < endIndex; i++, x += barWidth) {
        const v = arr[i] / 255;
        const barHeight = v * h;
        const y = h - barHeight;
        const g = ctx.createLinearGradient(0, h, 0, 0);
        g.addColorStop(0, 'rgb(0, 100, 255)');
        g.addColorStop(1, 'rgb(255, 0, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(x, y, Math.max(1, barWidth - 0.5), barHeight);
    }
}


function toggleMenu() {
    document.getElementById('controls').classList.toggle('collapsed');
}

init();
animate();
function buildCustomShapeSelect(nativeSelect) {
    try {
        if (!nativeSelect || nativeSelect.dataset.customized === '1') return;
        nativeSelect.dataset.customized = '1';
        nativeSelect.classList.add('visually-hidden-select');
        const wrapper = document.createElement('div');
        wrapper.className = 'custom-select';
        const selected = document.createElement('div');
        selected.className = 'selected';
        selected.textContent = 'SHAPE';
        const opts = document.createElement('ul');
        opts.className = 'options';
        for (let i = 0; i < nativeSelect.options.length; i++) {
            const o = nativeSelect.options[i];
            const li = document.createElement('li');
            li.className = 'option' + (o.selected ? ' active' : '');
            li.textContent = o.text;
            li.dataset.value = o.value;
            li.onclick = (e) => {
                e.stopPropagation();
                nativeSelect.value = o.value;
                selected.textContent = 'SHAPE';
                [...opts.children].forEach(c => c.classList.remove('active'));
                li.classList.add('active');
                wrapper.classList.remove('open');
                const evt = new Event('change', { bubbles: true });
                nativeSelect.dispatchEvent(evt);
            };
            opts.appendChild(li);
        }
        selected.onclick = (e) => {
            e.stopPropagation();
            const controls = document.getElementById('controls');
            const willOpen = !wrapper.classList.contains('open');
            wrapper.classList.toggle('open');
            if (controls) controls.classList.toggle('showing-select', willOpen);
        };
        document.addEventListener('click', () => {
            if (wrapper.classList.contains('open')) {
                wrapper.classList.remove('open');
                const controls = document.getElementById('controls');
                if (controls) controls.classList.remove('showing-select');
            }
        });
        wrapper.appendChild(selected);
        wrapper.appendChild(opts);
        nativeSelect.parentNode.insertBefore(wrapper, nativeSelect.nextSibling);
    } catch(_) {}
}
