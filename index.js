import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

let scene, camera, renderer, composer, analyser, audioCtx, dataArray;
let particles = [], time = 0, smoothedAudio = new Array(10).fill(0);
let audioSource, audioBuffer, waveformData, playbackStartTime, playbackOffset = 0;
let isDragging = false, isPaused = false, pauseTime = 0, dragProgress = null;
let micWaveformHistory = [], micStartTime, lastSeekTime = 0, dragHandlersAttached = false;
let sound_mode = 'mic', waveCanvas, waveCtx, freqLeftCanvas, freqLeftCtx, freqRightCanvas, freqRightCtx;

const PARTICLE_COUNT_PER_SPHERE = 2000, TOTAL_SPHERES = 10, MAX_MIC_HISTORY = 1000, SEEK_THROTTLE_MS = 50;
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

    createSpheres();
    scene.add(new THREE.AmbientLight(0x444444));
    
    initCanvases();
    useMicrophone();
    document.getElementById('uploadBtn').onclick = uploadAndPlay;
    document.getElementById('micBtn').onclick = useMicrophone;
    const btn = document.getElementById('playPauseBtn');
    if (btn) btn.onclick = togglePlayPause;
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

function createSpheres() {
    for(let s = 0; s < TOTAL_SPHERES; s++) {
        const geometry = new THREE.BufferGeometry();
        const posArray = new Float32Array(PARTICLE_COUNT_PER_SPHERE * 3);
        const originalPos = new Float32Array(PARTICLE_COUNT_PER_SPHERE * 3);
        const randoms = new Float32Array(PARTICLE_COUNT_PER_SPHERE);
        const baseRadius = 2.0 + (s * 0.3);

        for(let i = 0; i < PARTICLE_COUNT_PER_SPHERE; i++) {
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos((Math.random() * 2) - 1);
            const x = baseRadius * Math.sin(phi) * Math.cos(theta);
            const y = baseRadius * Math.sin(phi) * Math.sin(theta);
            const z = baseRadius * Math.cos(phi);
            posArray[i*3] = originalPos[i*3] = x;
            posArray[i*3+1] = originalPos[i*3+1] = y;
            posArray[i*3+2] = originalPos[i*3+2] = z;
            randoms[i] = Math.random();
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
        const points = new THREE.Points(geometry, new THREE.PointsMaterial({
            color: COLORS[s], size: 0.05, transparent: true, opacity: 0.6,
            blending: THREE.AdditiveBlending, depthWrite: false
        }));
        
        points.userData = {
            originalPos, randoms, radius: baseRadius, layerIndex: s,
            rotationSpeed: {
                x: (Math.random() - 0.5) * 0.01,
                y: (Math.random() - 0.5) * 0.01,
                z: (Math.random() - 0.5) * 0.01
            }
        };
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

    for(let i=0; i<10; i++) smoothedAudio[i] += (bands[i] - smoothedAudio[i]) * 0.45;

    particles.forEach((p, idx) => {
        const positions = p.geometry.attributes.position.array;
        const originals = p.userData.originalPos;
        const rand = p.userData.randoms;
        const intensity = smoothedAudio[idx];
        
        p.rotation.x += p.userData.rotationSpeed.x + (intensity * 0.02);
        p.rotation.y += p.userData.rotationSpeed.y + (intensity * 0.02);

        for(let i = 0; i < PARTICLE_COUNT_PER_SPHERE; i++) {
            const ix = i * 3;
            const ox = originals[ix], oy = originals[ix+1], oz = originals[ix+2];
            const vibration = Math.sin(time * 5 + ox + intensity * 10) * 0.1;
            const noise = Math.cos(time * 3 + oy * 2) * Math.sin(time * 2 + oz * 2) * 0.3;
            const scale = 1 + (intensity * (0.8 + rand[i] * 0.5)) + vibration + noise;
            positions[ix] = ox * scale;
            positions[ix+1] = oy * scale;
            positions[ix+2] = oz * scale;
        }
        
        p.geometry.attributes.position.needsUpdate = true;
        p.material.size = 0.04 + (intensity * 0.08);
        p.material.opacity = 0.3 + (intensity * 0.7);
    });

    camera.position.x = Math.sin(time * 0.5) * 12;
    camera.position.z = Math.cos(time * 0.5) * 12;
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
    const file = document.getElementById('audioFile').files[0];
    if (!file) return alert('Please select a file');
    sound_mode = 'up';
    setupAudio(URL.createObjectURL(file));
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
            playbackStartTime = null;
            playbackOffset = 0;
            isPaused = false;
            pauseTime = 0;
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
    if (!audioBuffer || sound_mode !== 'up' || !audioCtx) return;
    
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
    if (sound_mode === 'up' && audioBuffer) {
        btn.style.display = 'flex';
        btn.textContent = (isPaused || !audioSource) ? '▶' : '⏸';
    } else {
        btn.style.display = 'none';
    }
}

function seekToPosition(progress) {
    if (!audioBuffer || !audioCtx || audioCtx.state === 'closed') return;
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(e => console.error('Failed to resume:', e));
    
    const seekTime = Math.max(0, Math.min(progress * audioBuffer.duration, audioBuffer.duration));
    
    // Always update the offset first
    playbackOffset = seekTime;
    
    // If paused, just update the offset without starting playback
    if (isPaused) {
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
    if (!analyser || !dataArray) {
        const timerEl = document.getElementById('audioTimer');
        if (timerEl) timerEl.textContent = '';
        waveCanvas.style.cursor = 'default';
        return;
    }

    const ctx = waveCtx, w = waveCanvas.width, h = waveCanvas.height;
    if (w <= 0 || h <= 0) return;
    ctx.clearRect(0, 0, w, h);

    if (sound_mode === 'up' && waveformData && audioBuffer) {
        waveCanvas.style.cursor = 'pointer';
        drawFileWaveform(ctx, w, h);
    } else if (sound_mode === 'mic') {
        waveCanvas.style.cursor = 'default';
        drawMicWaveform(ctx, w, h);
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
    
    let progress = 0, currentTime = playbackOffset, duration = audioBuffer.duration || 0;
    
    if (dragProgress !== null) {
        progress = dragProgress;
        currentTime = progress * duration;
    } else if (isPaused) {
        currentTime = playbackOffset;
        progress = duration > 0 ? Math.min(Math.max(playbackOffset / duration, 0), 1) : 0;
    } else if (playbackStartTime !== null && audioCtx) {
        const elapsed = audioCtx.currentTime - playbackStartTime;
        currentTime = Math.min(Math.max(elapsed + playbackOffset, 0), duration);
        progress = duration > 0 ? Math.min(Math.max(currentTime / duration, 0), 1) : 0;
    } else {
        currentTime = playbackOffset;
        progress = duration > 0 ? Math.min(Math.max(playbackOffset / duration, 0), 1) : 0;
    }
    
    const progressX = w * progress, progressIndex = Math.floor(progress * waveformData.length);
    const pointWidth = w / waveformData.length, centerY = h / 2, amplitudeMultiplier = 1.2;
    
    ctx.strokeStyle = "#0066ff"; ctx.globalAlpha = 0.3; ctx.lineWidth = 4;
    ctx.beginPath();
    for (let i = progressIndex; i < waveformData.length; i++) {
        const x = i * pointWidth, amplitude = waveformData[i].avg * h * amplitudeMultiplier;
        const y = centerY - amplitude;
        (i === progressIndex) ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    
    ctx.strokeStyle = "#00d4ff"; ctx.globalAlpha = 0.9; ctx.lineWidth = 5;
    ctx.beginPath();
    for (let i = 0; i <= progressIndex; i++) {
        const x = i * pointWidth, amplitude = waveformData[i].avg * h * amplitudeMultiplier;
        const y = centerY - amplitude;
        (i === 0) ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    
    const lineHeight = h * 0.6, lineTop = (h - lineHeight) / 2;
    ctx.strokeStyle = "#ffffff"; ctx.globalAlpha = 0.8; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(progressX, lineTop);
    ctx.lineTo(progressX, lineTop + lineHeight);
    ctx.stroke();
    
    ctx.fillStyle = "#ffffff"; ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(progressX, lineTop, 4, 0, Math.PI * 2);
    ctx.fill();
    
    updateTimer(currentTime, duration);
}

function drawMicWaveform(ctx, w, h) {
    analyser.getByteTimeDomainData(dataArray);
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
    micWaveformHistory.push(sum / dataArray.length);
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
            if (dragProgress !== null && audioBuffer && audioCtx) {
                const finalProgress = dragProgress;
                dragProgress = null;
                requestAnimationFrame(() => seekToPosition(finalProgress));
            }
        }
    };
    
    canvas.addEventListener('mousedown', (e) => {
        if (sound_mode === 'up' && audioBuffer) {
            e.preventDefault();
            isDragging = true;
            handleWaveformClick(e);
        }
    });
    
    document.addEventListener('mousemove', (e) => {
        if (isDragging && sound_mode === 'up' && audioBuffer) {
            e.preventDefault();
            handleWaveformClick(e);
        }
    });
    
    document.addEventListener('mouseup', handleDragEnd);
    canvas.addEventListener('touchstart', (e) => {
        if (sound_mode === 'up' && audioBuffer) {
            e.preventDefault();
            isDragging = true;
            handleWaveformClick(e.touches[0]);
        }
    });
    document.addEventListener('touchmove', (e) => {
        if (isDragging && sound_mode === 'up' && audioBuffer) {
            e.preventDefault();
            if (e.touches.length > 0) handleWaveformClick(e.touches[0]);
        }
    });
    document.addEventListener('touchend', handleDragEnd);
    dragHandlersAttached = true;
}

function handleWaveformClick(e) {
    if (!audioBuffer || !waveCanvas) return;
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
    if (!analyser || !dataArray) {
        if (freqLeftCtx && freqLeftCanvas) freqLeftCtx.clearRect(0, 0, freqLeftCanvas.width, freqLeftCanvas.height);
        if (freqRightCtx && freqRightCanvas) freqRightCtx.clearRect(0, 0, freqRightCanvas.width, freqRightCanvas.height);
        return;
    }
    
    analyser.getByteFrequencyData(dataArray);
    const mid = Math.floor(dataArray.length / 2);
    
    // Calculate overall intensity for left and right channels
    let leftSum = 0, rightSum = 0;
    for (let i = 0; i < mid; i++) leftSum += dataArray[i];
    for (let i = mid; i < dataArray.length; i++) rightSum += dataArray[i];
    
    const leftIntensity = Math.min(1, (leftSum / mid) / 255);
    const rightIntensity = Math.min(1, (rightSum / (dataArray.length - mid)) / 255);
    
    if (freqLeftCtx && freqLeftCanvas) drawProgressBar(freqLeftCtx, freqLeftCanvas, leftIntensity);
    if (freqRightCtx && freqRightCanvas) drawProgressBar(freqRightCtx, freqRightCanvas, rightIntensity);
}

function drawProgressBar(ctx, canvas, intensity) {
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    
    // Draw background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(0, 0, w, h);
    
    // Draw progress bar from bottom to top
    const barHeight = intensity * h;
    const y = h - barHeight;
    
    // Create gradient from blue (bottom) to red (top)
    const gradient = ctx.createLinearGradient(0, h, 0, 0);
    gradient.addColorStop(0, 'rgb(0, 100, 255)'); // Blue at bottom
    gradient.addColorStop(1, 'rgb(255, 0, 0)'); // Red at top
    
    ctx.fillStyle = gradient;
    ctx.fillRect(0, y, w, barHeight);
}

function toggleMenu() {
    document.getElementById('controls').classList.toggle('collapsed');
}

init();
animate();
