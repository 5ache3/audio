import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

let scene, camera, renderer, composer;
let analyser, audioCtx, dataArray;
let particles = [];
let time = 0;
let smoothedAudio = new Array(10).fill(0); 
let currentShape = 'sphere'; 

// Config
const PARTICLE_COUNT_PER_GROUP = 8000;
const TOTAL_GROUPS = 10;
const COLORS = [
    0xff0044, 0xff4400, 0xffcc00, 0x88ff00, 0x00ff88, 
    0x00d4ff, 0x0066ff, 0x4400ff, 0x8800ff, 0xff00cc  
];

init();
animate();

// ==========================================
// INITIALISATION
// ==========================================
function init() {
    // Scene
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x000000, 0.02); 

    // Camera
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 12;

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ReinhardToneMapping;
    document.getElementById('container').appendChild(renderer.domElement);

    // POST PROCESSING (The Glow Effect)
    const renderScene = new RenderPass(scene, camera);
    
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
    bloomPass.strength = 1.4; 
    bloomPass.radius = 0.5;  
    bloomPass.threshold = 4; 

    composer = new EffectComposer(renderer);
    composer.addPass(renderScene);
    composer.addPass(bloomPass);
    window.bloomPass = bloomPass;

    // Generate Particles
    createParticles(currentShape);

    // Lights (INTENSITÉ TRÈS DIMINUÉE)
    const ambient = new THREE.AmbientLight(0x030303); // NOUVELLE BASE TRES SOMBRE
    scene.add(ambient);
    window.ambientLight = ambient; 

    // Event Listeners
    document.getElementById('playBtn').onclick = loadLocalFile;
    document.getElementById('micBtn').onclick = useMicrophone;
    document.getElementById('toggleBtn').onclick = toggleMenu;
    document.getElementById('shapeSelect').onchange = changeShape;
    window.addEventListener('resize', onWindowResize);
}

// ==========================================
// GESTION DES FORMES
// ==========================================
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

function changeShape() {
    const newShape = document.getElementById('shapeSelect').value;
    createParticles(newShape);
}

// --- Forme 1: Sphère (Nébuleuse) ---
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
        
        const material = new THREE.PointsMaterial({
            color: COLORS[s],
            size: 0.05,
            transparent: true,
            opacity: 0.6,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        const points = new THREE.Points(geometry, material);
        points.userData = { originalPos, randoms, radius: baseRadius, type: 'sphere', rotationSpeed: { x: (Math.random() - 0.5) * 0.01, y: (Math.random() - 0.5) * 0.01, z: (Math.random() - 0.5) * 0.01 } };
        scene.add(points);
        particles.push(points);
    }
}

// --- Forme 2: Tétraèdre (Cristal) --- 
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
            size: 0.03, // TAILLE RÉDUITE
            transparent: true,
            opacity: 0.4, // OPACITÉ RÉDUITE
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        const points = new THREE.Points(geometry, material);
        points.userData = { originalPos, randoms, radius: radius, type: 'octahedron', rotationSpeed: { x: (Math.random() - 0.5) * 0.01, y: (Math.random() - 0.5) * 0.01, z: (Math.random() - 0.5) * 0.01 } };
        scene.add(points);
        particles.push(points);
    }
}

// --- Forme 3: Cylindre (Tube) --- 
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
            size: 0.04,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        const points = new THREE.Points(geometry, material);
        points.userData = { originalPos, randoms, radius: groupRadius, type: 'cylinder', rotationSpeed: { x: (Math.random() - 0.5) * 0.01, y: (Math.random() - 0.5) * 0.01, z: (Math.random() - 0.5) * 0.01 } };
        scene.add(points);
        particles.push(points);
    }
}

// --- Forme 4: Tore (Anneau) ---
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
            size: 0.04,
            transparent: true,
            opacity: 0.5,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        const points = new THREE.Points(geometry, material);
        points.userData = { originalPos, randoms, radius: innerRadius, type: 'torus', rotationSpeed: { x: (Math.random() - 0.5) * 0.01, y: (Math.random() - 0.5) * 0.01, z: (Math.random() - 0.5) * 0.01 } };
        scene.add(points);
        particles.push(points);
    }
}

// --- Forme 5: Spirale (Hélice) ---
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
            size: 0.03, // TAILLE RÉDUITE
            transparent: true,
            opacity: 0.4, // OPACITÉ RÉDUITE
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        const points = new THREE.Points(geometry, material);
        points.userData = { originalPos, randoms, radius: groupRadius, type: 'spiral', rotationSpeed: { x: (Math.random() - 0.5) * 0.01, y: (Math.random() - 0.5) * 0.01, z: (Math.random() - 0.5) * 0.01 } };
        scene.add(points);
        particles.push(points);
    }
}


// ==========================================
// ANIMATION LOOP (Avatar Denseur)
// ==========================================
function animate() {
    requestAnimationFrame(animate);
    time += 0.005;

    // 1. Get Audio Data
    let bands = new Array(10).fill(0);
    if (analyser && dataArray) {
        analyser.getByteFrequencyData(dataArray);
        const binSize = Math.floor(dataArray.length / 10);
        for (let i = 0; i < 10; i++) {
            let sum = 0;
            for (let j = 0; j < binSize; j++) {
                sum += dataArray[i * binSize + j];
            }
            bands[i] = (sum / binSize) / 255; 
        }
    }

    // 2. Smooth the Audio 
    for(let i=0; i<10; i++) {
        smoothedAudio[i] += (bands[i] - smoothedAudio[i]) * 0.15; 
    }
    const bassIntensity = smoothedAudio[0]; 
    const trebleIntensity = smoothedAudio[9]; 
    const emotionFactor = bassIntensity * 0.5 + trebleIntensity * 0.5;

    // --- Facteur de Densité (Avatar Denseur) ---
    const densityRaw = (smoothedAudio[0] * 5 + smoothedAudio[1] + smoothedAudio[2] + smoothedAudio[3] + smoothedAudio[4]) / 6; 
    const densityFactor = densityRaw * 0.6 + 0.4; 

    // 3. Update Global Scene (Intensité Diminuée)
    if (window.ambientLight) {
        window.ambientLight.intensity = 0.01 + densityFactor * 0.03; 
    }
    if (window.bloomPass) {
        window.bloomPass.strength = 5 + densityFactor * 2.5; 
    }


    // 4. Update Particles
    particles.forEach((p, idx) => {
        const positions = p.geometry.attributes.position.array;
        const originals = p.userData.originalPos;
        const rand = p.userData.randoms;
        const particleType = p.userData.type;

        const audioBandIndex = idx; 
        const intensity = smoothedAudio[audioBandIndex]; 
        
        // Rotation de la structure entière
        p.rotation.x += p.userData.rotationSpeed.x + (densityFactor * 0.02); 
        p.rotation.y += p.userData.rotationSpeed.y + (densityFactor * 0.03);

        // Morph particles
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
        
        // Pulse size and opacity 
        p.material.size = 0.04 + (intensity * 0.15);
        p.material.opacity = 0.2 + (intensity * 0.8);
    });

    // 5. Camera movement
    const cameraDistance = 12 - (emotionFactor * 3); 
    
    camera.position.x = Math.sin(time * 0.5 * densityFactor) * cameraDistance;
    camera.position.z = Math.cos(time * 0.5 * densityFactor) * cameraDistance;

    const shake = bassIntensity * 2; 

    camera.position.y = Math.sin(time * 15) * shake * 0.1; 
    camera.position.z += Math.cos(time * 7) * shake * 0.1;

    camera.lookAt(0,0,0);

    // 6. Render
    composer.render();
}


// ==========================================
// AUDIO HANDLING (Local FileReader)
// ==========================================
function loadLocalFile() {
    const fileInput = document.getElementById('audioFile');
    const file = fileInput.files[0];
    if (!file) return alert('Please select a file');

    const reader = new FileReader();
    reader.onload = function(e) {
        const arrayBuffer = e.target.result;
        setupAudioContext(arrayBuffer);
    };
    reader.readAsArrayBuffer(file);
}

function useMicrophone() {
    navigator.mediaDevices.getUserMedia({ audio: true })
    .then(stream => {
        setupAudioStream(stream);
    }).catch(e => alert('Mic denied or access blocked.'));
}

function setupAudioContext(buffer) {
    if (audioCtx) audioCtx.close();
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    audioCtx.decodeAudioData(buffer, function(decoded) {
        const source = audioCtx.createBufferSource();
        source.buffer = decoded;
        source.loop = true; 
        connectAnalyser(source);
        source.start(0);
    }, function(e){ alert('Error decoding audio'); });
}

function setupAudioStream(stream) {
    if (audioCtx) audioCtx.close();
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(stream);
    connectAnalyser(source);
}

function connectAnalyser(source) {
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024; 
    analyser.smoothingTimeConstant = 0.5; 
    dataArray = new Uint8Array(analyser.frequencyBinCount);
    source.connect(analyser);
    analyser.connect(audioCtx.destination);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
}

function toggleMenu() {
    document.getElementById('controls').classList.toggle('collapsed');
}