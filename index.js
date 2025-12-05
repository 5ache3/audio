
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

let scene, camera, renderer, composer;
let analyser, audioCtx, dataArray;
let particles = [];
let time = 0;
let smoothedAudio = new Array(10).fill(0); // For smooth transitions

// Waveform data
let audioSource = null; // For uploaded files
let audioBuffer = null; // Full audio buffer for uploaded files
let waveformData = null; // Pre-computed waveform peaks
let playbackStartTime = null; // When playback started
let playbackOffset = 0; // Offset when seeking
let isDragging = false; // Whether user is dragging the progress line
let isPaused = false; // Whether audio is paused
let pauseTime = 0; // Time when paused
let micWaveformHistory = []; // Rolling buffer for microphone
const MAX_MIC_HISTORY = 1000; // Max samples to keep for mic
let lastSeekTime = 0; // Throttle seeking during drag
let dragHandlersAttached = false; // Prevent duplicate event listeners
let dragProgress = null; // Store progress during drag (null when not dragging)

// Config
const PARTICLE_COUNT_PER_SPHERE = 2000; // Slightly reduced for performance with Bloom
const TOTAL_SPHERES = 10;
const COLORS = [
    0xff0044, // Deep Red
    0xff4400, // Orange
    0xffcc00, // Gold
    0x88ff00, // Lime
    0x00ff88, // Teal
    0x00d4ff, // Cyan
    0x0066ff, // Azure
    0x4400ff, // Indigo
    0x8800ff, // Violet
    0xff00cc  // Magenta
];

let sound_mode='mic';
let waveCanvas, waveCtx;
let freqLeftCanvas, freqLeftCtx;
let freqRightCanvas, freqRightCtx;

function init() {
    // Scene
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x000000, 0.02); // Depth cue

    // Camera
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 12;

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: false }); // False for performance with bloom
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ReinhardToneMapping;
    document.getElementById('container').appendChild(renderer.domElement);

    // POST PROCESSING (The Glow Effect)
    const renderScene = new RenderPass(scene, camera);
    
    // Resolution, Strength, Radius, Threshold
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
    bloomPass.strength = 2.0;
    bloomPass.radius = 0.5;
    bloomPass.threshold = 0.1;

    composer = new EffectComposer(renderer);
    composer.addPass(renderScene);
    composer.addPass(bloomPass);

    // Generate Spheres
    createSpheres();

    // Lights (Subtle, as particles are self-illuminated, but helps depth)
    const ambient = new THREE.AmbientLight(0x444444);
    scene.add(ambient);
    
    // Initialize waveform canvas
    waveCanvas = document.getElementById("waveform");
    if (waveCanvas) {
        waveCtx = waveCanvas.getContext("2d");
        resizeWaveCanvas();
    }
    
    // Initialize frequency visualizer canvases
    freqLeftCanvas = document.getElementById("freqLeft");
    if (freqLeftCanvas) {
        freqLeftCtx = freqLeftCanvas.getContext("2d");
        resizeFreqCanvas(freqLeftCanvas);
    }
    
    freqRightCanvas = document.getElementById("freqRight");
    if (freqRightCanvas) {
        freqRightCtx = freqRightCanvas.getContext("2d");
        resizeFreqCanvas(freqRightCanvas);
    }
    
    useMicrophone()
    // Event Listeners
    document.getElementById('uploadBtn').onclick = uploadAndPlay;
    document.getElementById('micBtn').onclick = useMicrophone;
    const playPauseBtn = document.getElementById('playPauseBtn');
    if (playPauseBtn) {
        playPauseBtn.onclick = togglePlayPause;
    }
    window.addEventListener('resize', onWindowResize);
    window.toggleMenu = toggleMenu; // Expose to global scope
    
    // Waveform canvas drag handlers for seeking
    setupWaveformDragHandlers();
}

// Start initialization and animation
init();
animate();

function createSpheres() {
    for(let s = 0; s < TOTAL_SPHERES; s++) {
        const geometry = new THREE.BufferGeometry();
        const posArray = new Float32Array(PARTICLE_COUNT_PER_SPHERE * 3);
        const originalPos = new Float32Array(PARTICLE_COUNT_PER_SPHERE * 3);
        const randoms = new Float32Array(PARTICLE_COUNT_PER_SPHERE); // For variation

        const baseRadius = 2.0 + (s * 0.3); // Spheres get slightly larger

        for(let i = 0; i < PARTICLE_COUNT_PER_SPHERE; i++) {
            // Random point on sphere surface
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
        
        const material = new THREE.PointsMaterial({
            color: COLORS[s],
            size: 0.05,
            transparent: true,
            opacity: 0.6,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        const points = new THREE.Points(geometry, material);
        
        // Give each sphere a unique random rotation axis
        points.userData = {
            originalPos: originalPos,
            randoms: randoms,
            radius: baseRadius,
            rotationSpeed: {
                x: (Math.random() - 0.5) * 0.01,
                y: (Math.random() - 0.5) * 0.01,
                z: (Math.random() - 0.5) * 0.01
            },
            layerIndex: s
        };

        scene.add(points);
        particles.push(points);
    }
}

// ==========================================
// ANIMATION LOOP
// ==========================================
function animate() {
    requestAnimationFrame(animate);
    time += 0.005;

    // 1. Get Audio Data
    let bands = new Array(10).fill(0);
    if (analyser && dataArray) {
        analyser.getByteFrequencyData(dataArray);
        // Split frequency spectrum into 10 bands
        const binSize = Math.floor(dataArray.length / 10);
        for (let i = 0; i < 10; i++) {
            let sum = 0;
            for (let j = 0; j < binSize; j++) {
                sum += dataArray[i * binSize + j];
            }
            bands[i] = (sum / binSize) / 255; // Normalize 0-1
        }
    }

    // 2. Smooth the Audio (LERP)
    // This prevents the visualization from jittering too aggressively
    for(let i=0; i<10; i++) {
        smoothedAudio[i] += (bands[i] - smoothedAudio[i]) * 0.45;
    }

    // 3. Update Particles
    particles.forEach((p, idx) => {
        const positions = p.geometry.attributes.position.array;
        const originals = p.userData.originalPos;
        const rand = p.userData.randoms;
        const intensity = smoothedAudio[idx]; 
        
        // Rotate entire sphere
        p.rotation.x += p.userData.rotationSpeed.x + (intensity * 0.02);
        p.rotation.y += p.userData.rotationSpeed.y + (intensity * 0.02);

        // Morph particles
        for(let i = 0; i < PARTICLE_COUNT_PER_SPHERE; i++) {
            const ix = i * 3;
            const ox = originals[ix];
            const oy = originals[ix+1];
            const oz = originals[ix+2];

            // Noise / Wave Calculation
            // We create a "wave" effect that travels across the sphere
            const vibration = Math.sin(time * 5 + ox + intensity * 10) * 0.1;
            const noise = Math.cos(time * 3 + oy * 2) * Math.sin(time * 2 + oz * 2) * 0.3;
            
            // Explosion magnitude based on audio
            // Inner spheres react to Bass (idx 0), Outer to Treble (idx 9)
            const explosion = 1 + (intensity * (0.8 + rand[i] * 0.5)); 

            const scale = explosion + vibration + noise;

            positions[ix]   = ox * scale;
            positions[ix+1] = oy * scale;
            positions[ix+2] = oz * scale;
        }
        
        p.geometry.attributes.position.needsUpdate = true;
        
        // Pulse size and opacity
        p.material.size = 0.04 + (intensity * 0.08);
        p.material.opacity = 0.3 + (intensity * 0.7);
    });

    // 4. Camera movement (Gentle Orbit)
    camera.position.x = Math.sin(time * 0.5) * 12;
    camera.position.z = Math.cos(time * 0.5) * 12;
    camera.lookAt(0,0,0);

    // 5. Render with Bloom
    composer.render();
    
    // 6. Update waveform visualization
    drawWaveform();
    
    // 7. Update frequency visualizers
    drawFrequencyVisualizers();
    
    // FPS update (rough)
    // document.getElementById('fpsCounter').innerText = 'Time: ' + time.toFixed(2);
}

// ==========================================
// AUDIO HANDLING
// ==========================================
async function uploadAndPlay() {
    const fileInput = document.getElementById('audioFile');
    const file = fileInput.files[0];
    if (!file) return alert('Please select a file');
    
    sound_mode = 'up';

    // Convert file into local Object URL
    const localUrl = URL.createObjectURL(file);

    // Play it using your existing function
    setupAudio(localUrl);
}


function useMicrophone() {
    // Set mode first so connectAnalyser knows not to connect to destination
    sound_mode = 'mic';
    
    // Stop any playing audio file
    if (audioSource) {
        try {
            audioSource.stop();
        } catch(e) {}
        try {
            audioSource.disconnect();
        } catch(e) {}
        audioSource = null;
    }
    
    // Disconnect analyser from destination if connected
    if (analyser) {
        try {
            analyser.disconnect();
        } catch(e) {}
    }
    
    // Clear file playback state
    playbackStartTime = null;
    playbackOffset = 0;
    audioBuffer = null;
    waveformData = null;
    
    navigator.mediaDevices.getUserMedia({ audio: true })
    .then(stream => {
        setupAudioStream(stream);
    }).catch(e => alert('Mic denied'));
}

function setupAudio(url) {
    if (audioCtx) audioCtx.close();
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    // Reset waveform data
    waveformData = null;
    audioBuffer = null;
    audioSource = null;
    playbackStartTime = null;
    playbackOffset = 0;
    micWaveformHistory = [];
    
    fetch(url)
        .then(r => r.arrayBuffer())
        .then(buffer => audioCtx.decodeAudioData(buffer))
        .then(decoded => {
            audioBuffer = decoded;
            // Generate waveform data from the entire buffer
            generateWaveformData(decoded);
            
            // Reset pause state when new file is loaded
            isPaused = false;
            pauseTime = 0;
            playbackOffset = 0;
            updatePlayPauseButton();
            startPlayback(0);
        });
}

function startPlayback(offset) {
    if (!audioBuffer || !audioCtx) return;
    
    // Check if audio context is valid
    if (audioCtx.state === 'closed') {
        console.error('Audio context is closed');
        return;
    }
    
    // Resume audio context if suspended
    if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(e => console.error('Failed to resume audio context:', e));
    }
    
    // Stop current source if playing
    if (audioSource) {
        try {
            audioSource.stop();
        } catch(e) {
            // Source might already be stopped
        }
        try {
            audioSource.disconnect();
        } catch(e) {
            // Source might already be disconnected
        }
        audioSource = null;
    }
    
    try {
        const source = audioCtx.createBufferSource();
        source.buffer = audioBuffer;
        audioSource = source;
        playbackOffset = Math.max(0, Math.min(offset, audioBuffer.duration));
        playbackStartTime = audioCtx.currentTime;
        isPaused = false;
        pauseTime = 0;
        
        connectAnalyser(source);
        source.start(0, playbackOffset);
        
        // Update play/pause button
        updatePlayPauseButton();
        
        // Handle end of playback
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
        updatePlayPauseButton();
    }
}

function togglePlayPause() {
    if (!audioBuffer || sound_mode !== 'up' || !audioCtx) return;
    
    if (isPaused) {
        // Resume playback from where we paused - preserve the offset
        const resumeOffset = playbackOffset;
        if (resumeOffset >= 0 && resumeOffset < audioBuffer.duration) {
            startPlayback(resumeOffset);
        }
    } else if (!audioSource) {
        // No source playing, start from current offset or beginning
        const startOffset = playbackOffset > 0 ? playbackOffset : 0;
        startPlayback(startOffset);
    } else {
        // Pause playback - save current position
        if (audioSource && playbackStartTime !== null) {
            try {
                audioSource.stop();
            } catch(e) {}
            try {
                audioSource.disconnect();
            } catch(e) {}
            
            // Calculate current position before stopping - this is critical
            const elapsed = audioCtx.currentTime - playbackStartTime;
            const newOffset = Math.max(0, Math.min(elapsed + playbackOffset, audioBuffer.duration));
            
            // Save the position
            playbackOffset = newOffset;
            pauseTime = audioCtx.currentTime;
            playbackStartTime = null;
            audioSource = null;
        }
        isPaused = true;
        updatePlayPauseButton();
    }
}

function updatePlayPauseButton() {
    const btn = document.getElementById('playPauseBtn');
    if (!btn) return;
    
    // Only show in file upload mode, never in mic mode
    if (sound_mode === 'up' && audioBuffer) {
        btn.style.display = 'flex';
        if (isPaused || !audioSource) {
            btn.textContent = '▶';
        } else {
            btn.textContent = '⏸';
        }
    } else {
        // Hide in mic mode or when no audio
        btn.style.display = 'none';
    }
}

function seekToPosition(progress) {
    if (!audioBuffer || !audioCtx) return;
    
    // Don't seek if already seeking or if context is closing
    if (audioCtx.state === 'closed') return;
    
    // Ensure audio context is running
    if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(e => console.error('Failed to resume audio context:', e));
    }
    
    const seekTime = Math.max(0, Math.min(progress * audioBuffer.duration, audioBuffer.duration));
    
    // If paused, just update the offset without starting playback
    if (isPaused) {
        playbackOffset = seekTime;
        return;
    }
    
    // Otherwise, seek and start playback
    isPaused = false;
    pauseTime = 0;
    startPlayback(seekTime);
}

function setupAudioStream(stream) {
    if (audioCtx) audioCtx.close();
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    // Reset waveform data for file mode
    waveformData = null;
    audioBuffer = null;
    audioSource = null;
    playbackStartTime = null;
    micWaveformHistory = [];
    micStartTime = Date.now();
    
    const source = audioCtx.createMediaStreamSource(stream);
    connectAnalyser(source);
}

function connectAnalyser(source) {
    // Disconnect old analyser from destination if connected
    if (analyser) {
        try {
            analyser.disconnect();
        } catch(e) {}
    }
    
    // Create new analyser
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.8;
    dataArray = new Uint8Array(analyser.frequencyBinCount);
    
    // Connect source to analyser
    source.connect(analyser);
    
    // Connect analyser to destination only if not in mic mode
    if (sound_mode !== 'mic') {
        analyser.connect(audioCtx.destination);
    }
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
    // Also resize waveform canvas
    resizeWaveCanvas();
    // Also resize frequency canvases
    try {
        resizeFreqCanvas(freqLeftCanvas);
    } catch(e) {}
    try {
        resizeFreqCanvas(freqRightCanvas);
    } catch(e) {}
}

function resizeWaveCanvas() {
    if (waveCanvas) {
        const rect = waveCanvas.getBoundingClientRect();
        const newWidth = Math.floor(rect.width);
        const newHeight = Math.floor(rect.height);
        
        // Only resize if dimensions actually changed
        if (waveCanvas.width !== newWidth || waveCanvas.height !== newHeight) {
            waveCanvas.width = newWidth;
            waveCanvas.height = newHeight;
            
            // Re-get context if needed (shouldn't be necessary, but safety check)
            if (!waveCtx) {
                waveCtx = waveCanvas.getContext("2d");
            }
        }
    }
}
window.addEventListener("resize", resizeWaveCanvas);

// Ensure frequency canvases match CSS size and devicePixelRatio
function resizeFreqCanvas(canvas) {
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const cssWidth = Math.floor(rect.width) || 0;
    const cssHeight = Math.floor(rect.height) || 0;
    const dpr = window.devicePixelRatio || 1;

    const pixelWidth = Math.max(0, Math.floor(cssWidth * dpr));
    const pixelHeight = Math.max(0, Math.floor(cssHeight * dpr));

    // Only update if actual drawing buffer size changed
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
        // Keep CSS size in sync
        canvas.style.width = cssWidth + 'px';
        canvas.style.height = cssHeight + 'px';

        // Reset transform on the context so drawing uses CSS pixels
        const ctx = canvas.getContext('2d');
        if (ctx && typeof ctx.setTransform === 'function') {
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
    }
}

// When the window resizes, update both waveform and frequency canvases
window.addEventListener('resize', () => {
    resizeWaveCanvas();
    try { resizeFreqCanvas(freqLeftCanvas); } catch(e) {}
    try { resizeFreqCanvas(freqRightCanvas); } catch(e) {}
});

function generateWaveformData(buffer) {
    // Generate waveform peaks from audio buffer
    const samples = buffer.length;
    const sampleRate = buffer.sampleRate;
    const channelData = buffer.getChannelData(0); // Use first channel
    
    // Downsample to ~2000 points for performance
    const targetPoints = 2000;
    const step = Math.floor(samples / targetPoints);
    waveformData = [];
    
    for (let i = 0; i < targetPoints; i++) {
        const start = i * step;
        const end = Math.min(start + step, samples);
        
        let sum = 0;
        for (let j = start; j < end; j++) {
            // Use actual audio value (can be negative) for centered wave
            sum += channelData[j];
        }
        
        // Store average (audio values are -1 to 1, we'll normalize in drawing)
        const avg = sum / step;
        waveformData.push({
            avg: avg, // Keep as -1 to 1 range for proper centered wave
            peak: Math.abs(avg)
        });
    }
}

function drawWaveform() {
    if (!waveCanvas) return;
    
    // Ensure context is valid
    if (!waveCtx) {
        waveCtx = waveCanvas.getContext("2d");
        if (!waveCtx) return;
    }
    
    if (!analyser || !dataArray) {
        // Hide timer if no audio
        const timerEl = document.getElementById('audioTimer');
        if (timerEl) timerEl.textContent = '';
        waveCanvas.style.cursor = 'default';
        return;
    }

    const ctx = waveCtx;
    const w = waveCanvas.width;
    const h = waveCanvas.height;
    
    // Safety check for valid dimensions
    if (w <= 0 || h <= 0) return;

    ctx.clearRect(0, 0, w, h);

    if (sound_mode === 'up' && waveformData && audioBuffer) {
        // Draw full waveform for uploaded file
        if (waveCanvas) waveCanvas.style.cursor = 'pointer';
        drawFileWaveform(ctx, w, h);
    } else if (sound_mode === 'mic') {
        // Draw scrolling waveform for microphone
        if (waveCanvas) waveCanvas.style.cursor = 'default';
        drawMicWaveform(ctx, w, h);
        // Hide play/pause button in mic mode
        updatePlayPauseButton();
    } else {
        // Hide timer if not in file mode
        const timerEl = document.getElementById('audioTimer');
        if (timerEl) timerEl.textContent = '';
        if (waveCanvas) waveCanvas.style.cursor = 'default';
        // Hide play/pause button when no audio
        updatePlayPauseButton();
    }
}

function drawFileWaveform(ctx, w, h) {
    if (!waveformData || !audioBuffer || !audioCtx) return;
    
    // Calculate current playback position
    let progress = 0;
    let currentTime = playbackOffset; // Start with offset
    let duration = audioBuffer.duration || 0;
    
    // If dragging, use drag progress instead of actual playback position
    if (dragProgress !== null) {
        progress = dragProgress;
        currentTime = progress * duration;
    } else if (isPaused) {
        // If paused, show paused position
        currentTime = playbackOffset;
        progress = duration > 0 ? Math.min(Math.max(playbackOffset / duration, 0), 1) : 0;
    } else if (playbackStartTime !== null && audioCtx) {
        const elapsed = audioCtx.currentTime - playbackStartTime;
        currentTime = Math.max(elapsed + playbackOffset, 0);
        // Clamp to duration
        currentTime = Math.min(currentTime, duration);
        progress = duration > 0 ? Math.min(Math.max(currentTime / duration, 0), 1) : 0;
    } else {
        // If not playing yet, show the seek position
        currentTime = playbackOffset;
        progress = duration > 0 ? Math.min(Math.max(playbackOffset / duration, 0), 1) : 0;
    }
    
    const progressX = w * progress;
    const progressIndex = Math.floor(progress * waveformData.length);
    
    const pointWidth = w / waveformData.length;
    const centerY = h / 2;
    const amplitudeMultiplier = 0.7; // Increased from 0.4
    
    // Draw unplayed portion (darker, single wave)
    ctx.strokeStyle = "#0066ff";
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = 2;
    ctx.beginPath();
    
    for (let i = progressIndex; i < waveformData.length; i++) {
        const x = i * pointWidth;
        const data = waveformData[i];
        // data.avg is in -1 to 1 range, multiply by amplitude
        const amplitude = data.avg * h * amplitudeMultiplier;
        const y = centerY - amplitude;
        
        if (i === progressIndex) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    }
    ctx.stroke();
    
    // Draw played portion (bright, single wave)
    ctx.strokeStyle = "#00d4ff";
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    
    for (let i = 0; i <= progressIndex; i++) {
        const x = i * pointWidth;
        const data = waveformData[i];
        // data.avg is in -1 to 1 range, multiply by amplitude
        const amplitude = data.avg * h * amplitudeMultiplier;
        const y = centerY - amplitude;
        
        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    }
    ctx.stroke();
    
    // Draw progress line (shorter, about 60% of height)
    const lineHeight = h * 0.6;
    const lineTop = (h - lineHeight) / 2;
    ctx.strokeStyle = "#ffffff";
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(progressX, lineTop);
    ctx.lineTo(progressX, lineTop + lineHeight);
    ctx.stroke();
    
    // Draw a small circle at the top of the progress line for better visibility
    ctx.fillStyle = "#ffffff";
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(progressX, lineTop, 4, 0, Math.PI * 2);
    ctx.fill();
    
    // Update timer display
    updateTimer(currentTime, duration);
}

function drawMicWaveform(ctx, w, h) {
    // Get current waveform data
    analyser.getByteTimeDomainData(dataArray);
    
    // Add current sample to history (average of the sample array)
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
    }
    const avgValue = sum / dataArray.length;
    micWaveformHistory.push(avgValue);
    
    // Keep only recent history
    if (micWaveformHistory.length > MAX_MIC_HISTORY) {
        micWaveformHistory.shift();
    }
    
    if (micWaveformHistory.length === 0) return;
    
    // Draw scrolling waveform (single wave)
    const centerY = h / 2;
    const sampleWidth = w / micWaveformHistory.length;
    const amplitudeMultiplier = 1.0; // Increased amplitude
    
    ctx.strokeStyle = "#00d4ff";
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 2;
    
    // Draw single wave
    ctx.beginPath();
    let x = 0;
    for (let i = 0; i < micWaveformHistory.length; i++) {
        const v = micWaveformHistory[i] / 255;
        const amplitude = (v - 0.5) * h * amplitudeMultiplier; // Center around 0.5
        const y = centerY - amplitude;
        
        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
        
        x += sampleWidth;
    }
    ctx.stroke();
    
    // Hide timer for mic mode
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
    if (timerEl) {
        timerEl.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;
    }
}

function setupWaveformDragHandlers() {
    const canvas = waveCanvas;
    if (!canvas || dragHandlersAttached) return;
    
    // Mouse events
    const mouseDownHandler = (e) => {
        if (sound_mode === 'up' && audioBuffer) {
            e.preventDefault();
            isDragging = true;
            handleWaveformClick(e);
        }
    };
    
    const mouseMoveHandler = (e) => {
        if (isDragging && sound_mode === 'up' && audioBuffer) {
            e.preventDefault();
            handleWaveformClick(e);
        }
    };
    
    const mouseUpHandler = () => {
        if (isDragging) {
            isDragging = false;
            // Seek to the final drag position when drag ends - this makes it snap in place
            if (dragProgress !== null && audioBuffer && audioCtx) {
                const finalProgress = dragProgress;
                dragProgress = null;
                // Use requestAnimationFrame to ensure we're not in the middle of a render
                requestAnimationFrame(() => {
                    seekToPosition(finalProgress);
                });
            }
        }
    };
    
    // Touch handlers
    const touchStartHandler = (e) => {
        if (sound_mode === 'up' && audioBuffer) {
            e.preventDefault();
            isDragging = true;
            handleWaveformClick(e.touches[0]);
        }
    };
    
    const touchMoveHandler = (e) => {
        if (isDragging && sound_mode === 'up' && audioBuffer) {
            e.preventDefault();
            if (e.touches.length > 0) {
                handleWaveformClick(e.touches[0]);
            }
        }
    };
    
    const touchEndHandler = () => {
        if (isDragging) {
            isDragging = false;
            // Seek to the final drag position when drag ends - this makes it snap in place
            if (dragProgress !== null && audioBuffer && audioCtx) {
                const finalProgress = dragProgress;
                dragProgress = null;
                // Use requestAnimationFrame to ensure we're not in the middle of a render
                requestAnimationFrame(() => {
                    seekToPosition(finalProgress);
                });
            }
        }
    };
    
    canvas.addEventListener('mousedown', mouseDownHandler);
    document.addEventListener('mousemove', mouseMoveHandler);
    document.addEventListener('mouseup', mouseUpHandler);
    canvas.addEventListener('touchstart', touchStartHandler);
    document.addEventListener('touchmove', touchMoveHandler);
    document.addEventListener('touchend', touchEndHandler);
    
    dragHandlersAttached = true;
}

function handleWaveformClick(e) {
    if (!audioBuffer || !waveCanvas) return;
    
    const rect = waveCanvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return; // Safety check
    
    const canvasX = e.clientX - rect.left;
    // Clamp to canvas bounds
    const clampedX = Math.max(0, Math.min(canvasX, rect.width));
    
    // Calculate progress based on displayed width (not internal canvas width)
    // This is more reliable when canvas is resized
    const progress = Math.max(0, Math.min(1, clampedX / rect.width));
    
    if (isDragging) {
        // During drag, just store the progress - don't seek yet
        dragProgress = progress;
    } else {
        // On click (not drag), seek immediately
        dragProgress = null;
        seekToPosition(progress);
    }
}

function drawFrequencyVisualizers() {
    if (!analyser || !dataArray) {
        // Clear both canvases if no audio
        if (freqLeftCtx && freqLeftCanvas) {
            freqLeftCtx.clearRect(0, 0, freqLeftCanvas.width, freqLeftCanvas.height);
        }
        if (freqRightCtx && freqRightCanvas) {
            freqRightCtx.clearRect(0, 0, freqRightCanvas.width, freqRightCanvas.height);
        }
        return;
    }
    
    // Get frequency data
    analyser.getByteFrequencyData(dataArray);
    
    // Draw left frequency visualizer (use first half of frequency data)
    if (freqLeftCtx && freqLeftCanvas) {
        drawFrequencyBars(freqLeftCtx, freqLeftCanvas, dataArray, 0, Math.floor(dataArray.length / 2));
    }
    
    // Draw right frequency visualizer (use second half of frequency data)
    if (freqRightCtx && freqRightCanvas) {
        drawFrequencyBars(freqRightCtx, freqRightCanvas, dataArray, Math.floor(dataArray.length / 2), dataArray.length);
    }
}

function drawFrequencyBars(ctx, canvas, dataArray, startIndex, endIndex) {
    const w = canvas.width;
    const h = canvas.height;
    const barCount = 32; // Number of frequency bars
    const barWidth = w / barCount;
    const dataLength = endIndex - startIndex;
    const binSize = Math.floor(dataLength / barCount);
    
    ctx.clearRect(0, 0, w, h);
    
    for (let i = 0; i < barCount; i++) {
        // Calculate average frequency for this bar
        let sum = 0;
        const binStart = startIndex + (i * binSize);
        const binEnd = Math.min(binStart + binSize, endIndex);
        
        for (let j = binStart; j < binEnd; j++) {
            sum += dataArray[j];
        }
        
        const avg = sum / (binEnd - binStart);
        const normalized = avg / 255; // 0-1 range
        
        // Calculate bar height (from bottom, going up)
        const barHeight = normalized * h * 0.9; // Use 90% of height
        const x = i * barWidth;
        const y = h - barHeight; // Start from bottom
        
        // Color gradient from green (low) to red (high)
        const r = Math.min(255, normalized * 255 * 2);
        const g = Math.min(255, (1 - normalized) * 255 * 2);
        const b = 0;
        
        ctx.fillStyle = `rgb(${Math.floor(r)}, ${Math.floor(g)}, ${Math.floor(b)})`;
        ctx.fillRect(x, y, barWidth - 1, barHeight);
    }
}

function toggleMenu() {
    document.getElementById('controls').classList.toggle('collapsed');
}