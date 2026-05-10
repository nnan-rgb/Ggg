import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import * as CANNON from 'cannon-es';

// ============================================
// GLOBAL VARIABLES & CONFIGURATION
// ============================================
const CONFIG = {
    // Physics
    gravity: -9.82,
    physicsStep: 1 / 60,

    // Car Physics
    carMass: 1500,
    wheelMass: 20,
    maxSteerVal: 0.5,
    maxForce: 2000,
    brakeForce: 100,
    handBrakeForce: 500,

    // Gear ratios (BMW M3 style)
    gears: {
        'R': -3.5,
        '1': 3.8,
        '2': 2.2,
        '3': 1.5,
        '4': 1.1,
        '5': 0.8,
        '6': 0.6
    },
    finalDrive: 3.46,

    // Engine
    maxRPM: 8000,
    idleRPM: 800,
    redlineRPM: 7500,

    // Camera
    cameraDistance: 8,
    cameraHeight: 3,
    cameraSmoothness: 0.1,

    // Audio
    audioEnabled: true,
    masterVolume: 0.7,

    // Visual
    shadowMapSize: 2048,
    fogDensity: 0.002,

    // Performance
    maxParticles: 100,
    cullingDistance: 200
};

// Game State
const state = {
    isPlaying: false,
    isMobile: false,
    cameraMode: 'chase', // chase, hood, cockpit, orbit

    // Car State
    speed: 0,
    rpm: CONFIG.idleRPM,
    gear: 'N',
    gearIndex: 0, // -1=R, 0=N, 1-6=gears
    steering: 0,
    throttle: 0,
    brake: 0,
    handbrake: false,

    // Physics State
    isDrifting: false,
    driftAngle: 0,
    wheelSpin: [0, 0, 0, 0], // FL, FR, RL, RR

    // World
    time: 0,
    fps: 60,
    frameCount: 0
};

// Input State
const input = {
    up: false,
    down: false,
    left: false,
    right: false,
    shiftUp: false,
    shiftDown: false,
    handbrake: false,
    camera: false
};

// Three.js Objects
let scene, camera, renderer, composer;
let carMesh, cityMesh, wheels = [];
let particleSystem;

// Cannon.js Objects
let world, carBody, vehicle;
let physicsMaterial, wheelMaterial;

// Audio
let audioContext, engineSource, engineGain;
let buffers = {};

// Minimap
let minimapCanvas, minimapCtx;

// ============================================
// DEVICE DETECTION
// ============================================
function detectDevice() {
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    state.isMobile = isTouchDevice || isMobileUA || window.innerWidth < 768;

    const deviceInfo = document.getElementById('deviceInfo');
    if (state.isMobile) {
        deviceInfo.textContent = 'تم اكتشاف: هاتف/تابلت - ستظهر أزرار التحكم على الشاشة';
        deviceInfo.style.background = 'rgba(46, 204, 113, 0.2)';
    } else {
        deviceInfo.textContent = 'تم اكتشاف: كمبيوتر - استخدم لوحة المفاتيح للتحكم';
        deviceInfo.style.background = 'rgba(52, 152, 219, 0.2)';
    }
}

// ============================================
// INITIALIZATION
// ============================================
function init() {
    detectDevice();

    // Setup loading
    updateLoading(10, 'جاري تهيئة المحرك ثلاثي الأبعاد...');

    // Initialize Three.js
    initThreeJS();

    // Initialize Physics
    updateLoading(30, 'جاري تهيئة محرك الفيزياء...');
    initPhysics();

    // Initialize Audio
    updateLoading(50, 'جاري تحميل الأصوات...');
    initAudio();

    // Load Assets
    updateLoading(70, 'جاري تحميل النماذج ثلاثية الأبعاد...');
    loadAssets().then(() => {
        updateLoading(90, 'جاري إعداد العالم...');
        setupWorld();
        setupCar();
        setupPostProcessing();
        setupMinimap();
        setupEventListeners();

        updateLoading(100, 'جاهز!');
        setTimeout(() => {
            document.getElementById('loading').style.display = 'none';
        }, 500);
    });
}

function updateLoading(percent, text) {
    document.getElementById('loadingBar').style.width = percent + '%';
    document.querySelector('.loading-text').textContent = text;
}

// ============================================
// THREE.JS SETUP
// ============================================
function initThreeJS() {
    const container = document.getElementById('gameContainer');

    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111111);
    scene.fog = new THREE.FogExp2(0x111111, CONFIG.fogDensity);

    // Camera
    camera = new THREE.PerspectiveCamera(
        60,
        window.innerWidth / window.innerHeight,
        0.1,
        1000
    );
    camera.position.set(0, 5, 10);

    // Renderer
    renderer = new THREE.WebGLRenderer({ 
        antialias: true,
        powerPreference: 'high-performance'
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    container.appendChild(renderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xffffff, 1.5);
    sunLight.position.set(50, 100, 50);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = CONFIG.shadowMapSize;
    sunLight.shadow.mapSize.height = CONFIG.shadowMapSize;
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far = 500;
    sunLight.shadow.camera.left = -100;
    sunLight.shadow.camera.right = 100;
    sunLight.shadow.camera.top = 100;
    sunLight.shadow.camera.bottom = -100;
    scene.add(sunLight);

    // Hemisphere light for better ambient
    const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x362d1d, 0.4);
    scene.add(hemiLight);

    // Street lights (point lights)
    const streetLightPositions = [
        [20, 8, 20], [-20, 8, 20], [20, 8, -20], [-20, 8, -20],
        [60, 8, 60], [-60, 8, 60], [60, 8, -60], [-60, 8, -60]
    ];

    streetLightPositions.forEach(pos => {
        const light = new THREE.PointLight(0xffaa00, 0.5, 50);
        light.position.set(...pos);
        scene.add(light);
    });
}

// ============================================
// PHYSICS SETUP (Cannon-es)
// ============================================
function initPhysics() {
    world = new CANNON.World();
    world.gravity.set(0, CONFIG.gravity, 0);
    world.broadphase = new CANNON.SAPBroadphase(world);
    world.allowSleep = true;

    // Materials
    physicsMaterial = new CANNON.Material('physics');
    wheelMaterial = new CANNON.Material('wheel');

    const physicsWheelContact = new CANNON.ContactMaterial(
        physicsMaterial,
        wheelMaterial,
        {
            friction: 0.3,
            restitution: 0,
            contactEquationStiffness: 1000
        }
    );
    world.addContactMaterial(physicsWheelContact);
}

// ============================================
// AUDIO SETUP
// ============================================
function initAudio() {
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();

        // Create engine sound using oscillator (procedural audio)
        engineGain = audioContext.createGain();
        engineGain.gain.value = 0;
        engineGain.connect(audioContext.destination);

        // We'll create dynamic engine sound in the game loop
    } catch (e) {
        console.warn('Web Audio API not supported');
        CONFIG.audioEnabled = false;
    }
}

function updateEngineSound() {
    if (!CONFIG.audioEnabled || !audioContext) return;

    const rpm = state.rpm;
    const rpmRatio = (rpm - CONFIG.idleRPM) / (CONFIG.maxRPM - CONFIG.idleRPM);

    // Dynamic volume based on throttle
    const targetVolume = state.throttle > 0 ? 0.3 + (rpmRatio * 0.4) : 0.1;
    engineGain.gain.setTargetAtTime(targetVolume, audioContext.currentTime, 0.1);

    // Pitch based on RPM
    if (engineSource) {
        const baseFreq = 50; // Base frequency
        const targetFreq = baseFreq + (rpmRatio * 150);
        engineSource.frequency.setTargetAtTime(targetFreq, audioContext.currentTime, 0.05);
    }
}

function startEngineSound() {
    if (!CONFIG.audioEnabled || !audioContext || engineSource) return;

    engineSource = audioContext.createOscillator();
    engineSource.type = 'sawtooth';
    engineSource.frequency.value = 50;
    engineSource.connect(engineGain);
    engineSource.start();

    // Add noise for realism
    const bufferSize = audioContext.sampleRate * 2;
    const noiseBuffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
    }

    const noise = audioContext.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;

    const noiseGain = audioContext.createGain();
    noiseGain.gain.value = 0.05;

    noise.connect(noiseGain);
    noiseGain.connect(audioContext.destination);
    noise.start();
}

// ============================================
// ASSET LOADING
// ============================================
async function loadAssets() {
    const loader = new GLTFLoader();

    // Try to load BMW model
    try {
        const carGltf = await new Promise((resolve, reject) => {
            loader.load('assets/BMW.glb', resolve, undefined, reject);
        });
        carMesh = carGltf.scene;
        carMesh.scale.set(1, 1, 1);
    } catch (e) {
        console.warn('BMW.glb not found, using procedural car');
        carMesh = createProceduralCar();
    }

    // Try to load city map
    try {
        const cityGltf = await new Promise((resolve, reject) => {
            loader.load('assets/map.glb', resolve, undefined, reject);
        });
        cityMesh = cityGltf.scene;
        scene.add(cityMesh);

        // Add physics bodies for city objects
        cityMesh.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;

                // Create static physics body
                const shape = createTrimeshShape(child.geometry);
                if (shape) {
                    const body = new CANNON.Body({ mass: 0, material: physicsMaterial });
                    body.addShape(shape, child.position, child.quaternion);
                    world.addBody(body);
                }
            }
        });
    } catch (e) {
        console.warn('map.glb not found, using procedural city');
        createProceduralCity();
    }

    // Load audio files if they exist
    const audioFiles = ['car.mp3', 'back.mp3', 'zero.mp3'];
    for (const file of audioFiles) {
        try {
            const response = await fetch(`assets/${file}`);
            if (response.ok) {
                const arrayBuffer = await response.arrayBuffer();
                buffers[file.replace('.mp3', '')] = await audioContext.decodeAudioData(arrayBuffer);
            }
        } catch (e) {
            console.warn(`Could not load ${file}`);
        }
    }
}

// ============================================
// PROCEDURAL CAR (Fallback)
// ============================================
function createProceduralCar() {
    const carGroup = new THREE.Group();

    // Car body
    const bodyGeometry = new THREE.BoxGeometry(2, 0.8, 4.5);
    const bodyMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x1a1a1a,
        metalness: 0.8,
        roughness: 0.2
    });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.y = 0.6;
    body.castShadow = true;
    carGroup.add(body);

    // Car top
    const topGeometry = new THREE.BoxGeometry(1.8, 0.6, 2.5);
    const top = new THREE.Mesh(topGeometry, bodyMaterial);
    top.position.y = 1.3;
    top.position.z = -0.3;
    top.castShadow = true;
    carGroup.add(top);

    // Windows
    const windowMaterial = new THREE.MeshStandardMaterial({
        color: 0x111111,
        metalness: 0.9,
        roughness: 0.1,
        transparent: true,
        opacity: 0.7
    });
    const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.5, 0.1), windowMaterial);
    windshield.position.set(0, 1.3, 0.95);
    windshield.rotation.x = -0.2;
    carGroup.add(windshield);

    // Wheels
    const wheelGeometry = new THREE.CylinderGeometry(0.4, 0.4, 0.3, 32);
    const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x111111 });

    const wheelPositions = [
        [-1, 0.4, 1.5],   // Front Left
        [1, 0.4, 1.5],    // Front Right
        [-1, 0.4, -1.5],  // Rear Left
        [1, 0.4, -1.5]    // Rear Right
    ];

    wheelPositions.forEach((pos, i) => {
        const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(...pos);
        wheel.castShadow = true;
        wheels.push(wheel);
        carGroup.add(wheel);
    });

    // Headlights
    const headlightGeometry = new THREE.BoxGeometry(0.3, 0.2, 0.1);
    const headlightMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffcc,
        emissive: 0xffffcc,
        emissiveIntensity: 2
    });

    const hl1 = new THREE.Mesh(headlightGeometry, headlightMaterial);
    hl1.position.set(-0.6, 0.7, 2.25);
    carGroup.add(hl1);

    const hl2 = new THREE.Mesh(headlightGeometry, headlightMaterial);
    hl2.position.set(0.6, 0.7, 2.25);
    carGroup.add(hl2);

    // Taillights
    const taillightMaterial = new THREE.MeshStandardMaterial({
        color: 0xff0000,
        emissive: 0xff0000,
        emissiveIntensity: 1
    });

    const tl1 = new THREE.Mesh(headlightGeometry, taillightMaterial);
    tl1.position.set(-0.6, 0.7, -2.25);
    carGroup.add(tl1);

    const tl2 = new THREE.Mesh(headlightGeometry, taillightMaterial);
    tl2.position.set(0.6, 0.7, -2.25);
    carGroup.add(tl2);

    // BMW Logo (simplified)
    const logoGeometry = new THREE.CircleGeometry(0.15, 32);
    const logoMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        metalness: 1,
        roughness: 0
    });
    const logo = new THREE.Mesh(logoGeometry, logoMaterial);
    logo.position.set(0, 0.8, 2.26);
    carGroup.add(logo);

    return carGroup;
}

// ============================================
// PROCEDURAL CITY (Fallback)
// ============================================
function createProceduralCity() {
    const cityGroup = new THREE.Group();

    // Ground
    const groundGeometry = new THREE.PlaneGeometry(500, 500);
    const groundMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x333333,
        roughness: 0.8
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    cityGroup.add(ground);

    // Road markings
    const roadMarkingGeometry = new THREE.PlaneGeometry(0.3, 500);
    const roadMarkingMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0xffffff,
        emissiveIntensity: 0.3
    });

    const centerLine = new THREE.Mesh(roadMarkingGeometry, roadMarkingMaterial);
    centerLine.rotation.x = -Math.PI / 2;
    centerLine.position.y = 0.01;
    cityGroup.add(centerLine);

    // Buildings
    const buildingColors = [0x444444, 0x555555, 0x666666, 0x333333];
    for (let i = 0; i < 50; i++) {
        const width = 5 + Math.random() * 10;
        const height = 10 + Math.random() * 30;
        const depth = 5 + Math.random() * 10;

        const buildingGeometry = new THREE.BoxGeometry(width, height, depth);
        const buildingMaterial = new THREE.MeshStandardMaterial({
            color: buildingColors[Math.floor(Math.random() * buildingColors.length)],
            roughness: 0.7
        });

        const building = new THREE.Mesh(buildingGeometry, buildingMaterial);

        // Position buildings away from center road
        const side = Math.random() > 0.5 ? 1 : -1;
        const x = side * (15 + Math.random() * 80);
        const z = (Math.random() - 0.5) * 200;

        building.position.set(x, height / 2, z);
        building.castShadow = true;
        building.receiveShadow = true;
        cityGroup.add(building);

        // Add physics body
        const shape = new CANNON.Box(new CANNON.Vec3(width/2, height/2, depth/2));
        const body = new CANNON.Body({ mass: 0, material: physicsMaterial });
        body.addShape(shape);
        body.position.set(x, height / 2, z);
        world.addBody(body);
    }

    // Street lights
    for (let i = -100; i <= 100; i += 30) {
        const poleGeometry = new THREE.CylinderGeometry(0.1, 0.1, 8);
        const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x888888 });

        [-1, 1].forEach(side => {
            const pole = new THREE.Mesh(poleGeometry, poleMaterial);
            pole.position.set(side * 8, 4, i);
            pole.castShadow = true;
            cityGroup.add(pole);

            const lightGeometry = new THREE.SphereGeometry(0.3);
            const lightMaterial = new THREE.MeshStandardMaterial({
                color: 0xffaa00,
                emissive: 0xffaa00,
                emissiveIntensity: 2
            });
            const bulb = new THREE.Mesh(lightGeometry, lightMaterial);
            bulb.position.set(side * 8, 8, i);
            cityGroup.add(bulb);

            const pointLight = new THREE.PointLight(0xffaa00, 1, 30);
            pointLight.position.set(side * 8, 8, i);
            cityGroup.add(pointLight);
        });
    }

    scene.add(cityGroup);

    // Ground physics
    const groundShape = new CANNON.Plane();
    const groundBody = new CANNON.Body({ mass: 0, material: physicsMaterial });
    groundBody.addShape(groundShape);
    groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    world.addBody(groundBody);
}

// ============================================
// CREATE TRIMESH SHAPE FOR PHYSICS
// ============================================
function createTrimeshShape(geometry) {
    if (!geometry.attributes.position) return null;

    const vertices = geometry.attributes.position.array;
    const indices = geometry.index ? geometry.index.array : [];

    if (indices.length === 0) {
        // Generate indices for non-indexed geometry
        const newIndices = [];
        for (let i = 0; i < vertices.length / 3; i += 3) {
            newIndices.push(i, i + 1, i + 2);
        }
        return new CANNON.Trimesh(vertices, newIndices);
    }

    return new CANNON.Trimesh(vertices, indices);
}

// ============================================
// SETUP WORLD
// ============================================
function setupWorld() {
    // Add car mesh to scene
    scene.add(carMesh);
}

// ============================================
// SETUP CAR PHYSICS (Raycast Vehicle)
// ============================================
function setupCar() {
    // Car chassis
    const chassisShape = new CANNON.Box(new CANNON.Vec3(1, 0.5, 2.25));
    carBody = new CANNON.Body({ 
        mass: CONFIG.carMass,
        material: physicsMaterial
    });
    carBody.addShape(chassisShape);
    carBody.position.set(0, 2, 0);
    carBody.angularDamping = 0.5;
    world.addBody(carBody);

    // Create raycast vehicle
    vehicle = new CANNON.RaycastVehicle({
        chassisBody: carBody,
        indexRightAxis: 0,
        indexUpAxis: 1,
        indexForwardAxis: 2
    });

    // Wheel options
    const wheelOptions = {
        radius: 0.4,
        directionLocal: new CANNON.Vec3(0, -1, 0),
        suspensionStiffness: 30,
        suspensionRestLength: 0.3,
        frictionSlip: 1.4,
        dampingRelaxation: 2.3,
        dampingCompression: 4.4,
        maxSuspensionForce: 100000,
        rollInfluence: 0.01,
        axleLocal: new CANNON.Vec3(-1, 0, 0),
        chassisConnectionPointLocal: new CANNON.Vec3(1, 1, 0),
        maxSuspensionTravel: 0.3,
        customSlidingRotationalSpeed: -30,
        useCustomSlidingRotationalSpeed: true
    };

    // Add wheels
    const wheelPositions = [
        [-1, 0, 1.5],   // Front Left
        [1, 0, 1.5],    // Front Right
        [-1, 0, -1.5],  // Rear Left
        [1, 0, -1.5]    // Rear Right
    ];

    wheelPositions.forEach((pos) => {
        wheelOptions.chassisConnectionPointLocal.set(...pos);
        vehicle.addWheel(wheelOptions);
    });

    vehicle.addToWorld(world);

    // Wheel visuals
    vehicle.wheelInfos.forEach((wheel, i) => {
        const wheelGeometry = new THREE.CylinderGeometry(0.4, 0.4, 0.25, 32);
        const wheelMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x111111,
            roughness: 0.9
        });
        const wheelMesh = new THREE.Mesh(wheelGeometry, wheelMaterial);
        wheelMesh.rotation.z = Math.PI / 2;
        wheelMesh.castShadow = true;
        scene.add(wheelMesh);
        wheels.push(wheelMesh);
    });
}

// ============================================
// POST PROCESSING
// ============================================
function setupPostProcessing() {
    composer = new EffectComposer(renderer);

    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    const bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        0.5,  // strength
        0.4,  // radius
        0.85  // threshold
    );
    composer.addPass(bloomPass);
}

// ============================================
// MINIMAP
// ============================================
function setupMinimap() {
    minimapCanvas = document.getElementById('minimapCanvas');
    minimapCtx = minimapCanvas.getContext('2d');
}

function updateMinimap() {
    if (!minimapCtx || !carBody) return;

    const ctx = minimapCtx;
    const w = minimapCanvas.width;
    const h = minimapCanvas.height;

    // Clear
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, w, h);

    // Draw grid
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 1;
    for (let i = 0; i < w; i += 20) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, h);
        ctx.stroke();
    }
    for (let i = 0; i < h; i += 20) {
        ctx.beginPath();
        ctx.moveTo(0, i);
        ctx.lineTo(w, i);
        ctx.stroke();
    }

    // Draw car
    const carX = w / 2;
    const carY = h / 2;

    // Car direction
    const forward = new THREE.Vector3(0, 0, 1);
    forward.applyQuaternion(new THREE.Quaternion(
        carBody.quaternion.x,
        carBody.quaternion.y,
        carBody.quaternion.z,
        carBody.quaternion.w
    ));
    const angle = Math.atan2(forward.x, forward.z);

    ctx.save();
    ctx.translate(carX, carY);
    ctx.rotate(angle);

    // Car triangle
    ctx.fillStyle = '#0ff';
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(-5, 6);
    ctx.lineTo(5, 6);
    ctx.closePath();
    ctx.fill();

    ctx.restore();

    // Draw compass
    ctx.fillStyle = '#888';
    ctx.font = '10px monospace';
    ctx.fillText('N', w/2 - 3, 12);
}

// ============================================
// PARTICLE SYSTEM (Tire Smoke)
// ============================================
function createParticleSystem() {
    const particleCount = CONFIG.maxParticles;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const sizes = new Float32Array(particleCount);
    const opacities = new Float32Array(particleCount);
    const lifetimes = new Float32Array(particleCount);

    for (let i = 0; i < particleCount; i++) {
        lifetimes[i] = -1; // Inactive
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('opacity', new THREE.BufferAttribute(opacities, 1));

    const material = new THREE.PointsMaterial({
        color: 0xaaaaaa,
        size: 2,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        blending: THREE.NormalBlending
    });

    const particles = new THREE.Points(geometry, material);
    scene.add(particles);

    return { mesh: particles, positions, sizes, opacities, lifetimes, count: particleCount };
}

let particleSystem;

function spawnSmoke(position, intensity = 1) {
    if (!particleSystem) return;

    const { positions, sizes, opacities, lifetimes, count } = particleSystem;

    for (let i = 0; i < count; i++) {
        if (lifetimes[i] < 0) {
            lifetimes[i] = 1.0; // Active
            positions[i * 3] = position.x + (Math.random() - 0.5) * 0.5;
            positions[i * 3 + 1] = position.y;
            positions[i * 3 + 2] = position.z + (Math.random() - 0.5) * 0.5;
            sizes[i] = 0.5 + Math.random() * 1.5;
            opacities[i] = 0.3 * intensity;
            break;
        }
    }
}

function updateParticles(delta) {
    if (!particleSystem) return;

    const { positions, sizes, opacities, lifetimes, count } = particleSystem;

    for (let i = 0; i < count; i++) {
        if (lifetimes[i] > 0) {
            lifetimes[i] -= delta * 0.5;
            positions[i * 3 + 1] += delta * 2; // Rise
            sizes[i] += delta * 2; // Expand
            opacities[i] = lifetimes[i] * 0.3;

            if (lifetimes[i] <= 0) {
                lifetimes[i] = -1;
                positions[i * 3] = 0;
                positions[i * 3 + 1] = -1000;
                positions[i * 3 + 2] = 0;
            }
        }
    }

    particleSystem.mesh.geometry.attributes.position.needsUpdate = true;
}

// ============================================
// OCCLUSION CULLING
// ============================================
function updateCulling() {
    if (!scene) return;

    const cameraPosition = camera.position;

    scene.traverse((object) => {
        if (object.isMesh && object !== carMesh) {
            const distance = object.position.distanceTo(cameraPosition);

            // Distance culling
            if (distance > CONFIG.cullingDistance) {
                object.visible = false;
                return;
            }

            // Frustum culling (handled by Three.js automatically)
            // Additional LOD logic could go here
            object.visible = true;
        }
    });
}

// ============================================
// INPUT HANDLING
// ============================================
function setupEventListeners() {
    // Keyboard
    document.addEventListener('keydown', (e) => {
        switch(e.key.toLowerCase()) {
            case 'arrowup':
            case 'w':
                input.up = true;
                break;
            case 'arrowdown':
            case 's':
                if (e.key === 's' && !e.ctrlKey && !e.metaKey) {
                    // Shift down
                    shiftGear(-1);
                } else {
                    input.down = true;
                }
                break;
            case 'arrowleft':
            case 'a':
                input.left = true;
                break;
            case 'arrowright':
            case 'd':
                input.right = true;
                break;
            case 'z':
                shiftGear(1);
                break;
            case 'r':
                setGear('R');
                break;
            case ' ':
                input.handbrake = true;
                e.preventDefault();
                break;
            case 'c':
                cycleCameraMode();
                break;
        }
    });

    document.addEventListener('keyup', (e) => {
        switch(e.key.toLowerCase()) {
            case 'arrowup':
            case 'w':
                input.up = false;
                break;
            case 'arrowdown':
            case 's':
                input.down = false;
                break;
            case 'arrowleft':
            case 'a':
                input.left = false;
                break;
            case 'arrowright':
            case 'd':
                input.right = false;
                break;
            case ' ':
                input.handbrake = false;
                break;
        }
    });

    // Mobile Controls
    if (state.isMobile) {
        setupMobileControls();
    }

    // Window resize
    window.addEventListener('resize', onWindowResize);

    // Start button
    document.getElementById('startBtn').addEventListener('click', startGame);
}

function setupMobileControls() {
    const gasBtn = document.getElementById('mobileGas');
    const brakeBtn = document.getElementById('mobileBrake');
    const shiftUpBtn = document.getElementById('mobileShiftUp');
    const shiftDownBtn = document.getElementById('mobileShiftDown');
    const leftBtn = document.getElementById('mobileLeft');
    const rightBtn = document.getElementById('mobileRight');

    // Gas
    gasBtn.addEventListener('touchstart', (e) => { e.preventDefault(); input.up = true; });
    gasBtn.addEventListener('touchend', (e) => { e.preventDefault(); input.up = false; });
    gasBtn.addEventListener('mousedown', () => input.up = true);
    gasBtn.addEventListener('mouseup', () => input.up = false);
    gasBtn.addEventListener('mouseleave', () => input.up = false);

    // Brake
    brakeBtn.addEventListener('touchstart', (e) => { e.preventDefault(); input.down = true; });
    brakeBtn.addEventListener('touchend', (e) => { e.preventDefault(); input.down = false; });
    brakeBtn.addEventListener('mousedown', () => input.down = true);
    brakeBtn.addEventListener('mouseup', () => input.down = false);
    brakeBtn.addEventListener('mouseleave', () => input.down = false);

    // Shift Up
    shiftUpBtn.addEventListener('touchstart', (e) => { e.preventDefault(); shiftGear(1); });
    shiftUpBtn.addEventListener('click', () => shiftGear(1));

    // Shift Down
    shiftDownBtn.addEventListener('touchstart', (e) => { e.preventDefault(); shiftGear(-1); });
    shiftDownBtn.addEventListener('click', () => shiftGear(-1));

    // Steering
    leftBtn.addEventListener('touchstart', (e) => { e.preventDefault(); input.left = true; });
    leftBtn.addEventListener('touchend', (e) => { e.preventDefault(); input.left = false; });
    leftBtn.addEventListener('mousedown', () => input.left = true);
    leftBtn.addEventListener('mouseup', () => input.left = false);
    leftBtn.addEventListener('mouseleave', () => input.left = false);

    rightBtn.addEventListener('touchstart', (e) => { e.preventDefault(); input.right = true; });
    rightBtn.addEventListener('touchend', (e) => { e.preventDefault(); input.right = false; });
    rightBtn.addEventListener('mousedown', () => input.right = true);
    rightBtn.addEventListener('mouseup', () => input.right = false);
    rightBtn.addEventListener('mouseleave', () => input.right = false);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (composer) {
        composer.setSize(window.innerWidth, window.innerHeight);
    }
}

// ============================================
// GEAR SYSTEM
// ============================================
const gearOrder = ['R', 'N', '1', '2', '3', '4', '5', '6'];

function shiftGear(direction) {
    const currentIndex = gearOrder.indexOf(state.gear);
    const newIndex = Math.max(0, Math.min(gearOrder.length - 1, currentIndex + direction));

    if (newIndex !== currentIndex) {
        setGear(gearOrder[newIndex]);
    }
}

function setGear(gear) {
    state.gear = gear;
    state.gearIndex = gearOrder.indexOf(gear);

    // Visual feedback
    const gearDisplay = document.getElementById('gearDisplay');
    gearDisplay.textContent = gear;
    gearDisplay.style.transform = 'scale(1.3)';
    setTimeout(() => {
        gearDisplay.style.transform = 'scale(1)';
    }, 200);

    // Update stats
    document.getElementById('gearStat').textContent = gear;
}

// ============================================
// CAMERA MODES
// ============================================
const cameraModes = ['chase', 'hood', 'cockpit', 'orbit'];
let currentCameraIndex = 0;

function cycleCameraMode() {
    currentCameraIndex = (currentCameraIndex + 1) % cameraModes.length;
    state.cameraMode = cameraModes[currentCameraIndex];
}

function updateCamera() {
    if (!carBody) return;

    const carPosition = new THREE.Vector3(carBody.position.x, carBody.position.y, carBody.position.z);
    const carQuaternion = new THREE.Quaternion(
        carBody.quaternion.x,
        carBody.quaternion.y,
        carBody.quaternion.z,
        carBody.quaternion.w
    );

    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(carQuaternion);
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(carQuaternion);

    let targetPosition, targetLookAt;

    switch(state.cameraMode) {
        case 'chase':
            // Chase camera behind car
            targetPosition = carPosition.clone()
                .add(forward.clone().multiplyScalar(-CONFIG.cameraDistance))
                .add(up.clone().multiplyScalar(CONFIG.cameraHeight))
                .add(right.clone().multiplyScalar(state.steering * 2));
            targetLookAt = carPosition.clone().add(forward.clone().multiplyScalar(5));
            break;

        case 'hood':
            // Hood camera
            targetPosition = carPosition.clone()
                .add(forward.clone().multiplyScalar(1.5))
                .add(up.clone().multiplyScalar(1.2));
            targetLookAt = carPosition.clone().add(forward.clone().multiplyScalar(20));
            break;

        case 'cockpit':
            // Cockpit view
            targetPosition = carPosition.clone()
                .add(up.clone().multiplyScalar(1.0))
                .add(forward.clone().multiplyScalar(0.3));
            targetLookAt = carPosition.clone().add(forward.clone().multiplyScalar(50));
            break;

        case 'orbit':
            // Orbit camera (manual control)
            return; // Handled by OrbitControls if enabled
    }

    // Smooth camera follow
    camera.position.lerp(targetPosition, CONFIG.cameraSmoothness);

    const lookAtTarget = targetLookAt || carPosition;
    camera.lookAt(lookAtTarget);
}

// ============================================
// GAME LOGIC
// ============================================
function startGame() {
    document.getElementById('instructions').style.display = 'none';
    document.getElementById('hud').style.display = 'block';

    state.isPlaying = true;

    // Start engine sound
    startEngineSound();

    // Initialize particle system
    particleSystem = createParticleSystem();

    // Start game loop
    gameLoop();
}

function updatePhysics() {
    if (!vehicle) return;

    // Steering
    const steerInput = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    state.steering = THREE.MathUtils.lerp(state.steering, steerInput * CONFIG.maxSteerVal, 0.1);

    vehicle.setSteeringValue(state.steering, 0); // Front Left
    vehicle.setSteeringValue(state.steering, 1); // Front Right

    // Throttle and Brake
    let engineForce = 0;
    let brakeForce = 0;

    if (state.gear === 'N') {
        // Neutral - no power to wheels
        state.throttle = 0;
        state.brake = input.down ? 1 : 0;
        brakeForce = state.brake * CONFIG.brakeForce;
    } else if (state.gear === 'R') {
        // Reverse
        if (input.up) {
            state.throttle = 1;
            state.brake = 0;
            engineForce = -CONFIG.maxForce * 0.5; // Reverse is weaker
        } else if (input.down) {
            state.throttle = 0;
            state.brake = 1;
            brakeForce = CONFIG.brakeForce;
        } else {
            state.throttle = 0;
            state.brake = 0;
        }
    } else {
        // Forward gears
        const gearRatio = CONFIG.gears[state.gear] || 1;

        if (input.up) {
            state.throttle = 1;
            state.brake = 0;
            engineForce = CONFIG.maxForce * gearRatio * CONFIG.finalDrive;
        } else if (input.down) {
            state.throttle = 0;
            state.brake = 1;
            brakeForce = CONFIG.brakeForce;
        } else {
            state.throttle = 0;
            state.brake = 0;
            // Engine braking
            brakeForce = 10;
        }
    }

    // Handbrake
    if (input.handbrake) {
        brakeForce = Math.max(brakeForce, CONFIG.handBrakeForce);
        // Handbrake affects rear wheels only
        vehicle.setBrake(brakeForce, 2);
        vehicle.setBrake(brakeForce, 3);
    } else {
        // Apply to all wheels
        vehicle.applyEngineForce(engineForce, 2); // Rear Left
        vehicle.applyEngineForce(engineForce, 3); // Rear Right

        vehicle.setBrake(brakeForce, 0);
        vehicle.setBrake(brakeForce, 1);
        vehicle.setBrake(brakeForce, 2);
        vehicle.setBrake(brakeForce, 3);
    }

    // Update wheel visuals
    for (let i = 0; i < vehicle.wheelInfos.length; i++) {
        vehicle.updateWheelTransform(i);
        const transform = vehicle.wheelInfos[i].worldTransform;

        if (wheels[i]) {
            wheels[i].position.copy(transform.position);
            wheels[i].quaternion.copy(transform.quaternion);
        }
    }

    // Calculate speed
    const velocity = carBody.velocity;
    state.speed = Math.sqrt(velocity.x ** 2 + velocity.z ** 2) * 3.6; // Convert to km/h

    // Update RPM
    updateRPM();

    // Detect drifting
    detectDrift();

    // Spawn smoke when drifting or burning out
    if (state.isDrifting || (state.throttle > 0 && state.speed < 5)) {
        const wheelPositions = [
            new THREE.Vector3(-1, 0.2, 1.5),
            new THREE.Vector3(1, 0.2, 1.5),
            new THREE.Vector3(-1, 0.2, -1.5),
            new THREE.Vector3(1, 0.2, -1.5)
        ];

        wheelPositions.forEach(pos => {
            pos.applyQuaternion(new THREE.Quaternion(
                carBody.quaternion.x,
                carBody.quaternion.y,
                carBody.quaternion.z,
                carBody.quaternion.w
            ));
            pos.add(new THREE.Vector3(carBody.position.x, carBody.position.y, carBody.position.z));
            spawnSmoke(pos, state.isDrifting ? 1 : 0.5);
        });
    }
}

function updateRPM() {
    const gearRatio = state.gear === 'N' ? 0 : (CONFIG.gears[state.gear] || 1);
    const speedRatio = Math.abs(state.speed) / 250; // Max speed ~250 km/h

    if (state.throttle > 0 && state.gear !== 'N') {
        // Accelerating
        const targetRPM = CONFIG.idleRPM + (speedRatio * (CONFIG.maxRPM - CONFIG.idleRPM));
        state.rpm = THREE.MathUtils.lerp(state.rpm, targetRPM, 0.05);

        // Rev limiter
        if (state.rpm > CONFIG.redlineRPM) {
            state.rpm = CONFIG.redlineRPM;
        }
    } else {
        // Decelerating
        state.rpm = THREE.MathUtils.lerp(state.rpm, CONFIG.idleRPM, 0.03);
    }

    // Update audio
    updateEngineSound();
}

function detectDrift() {
    if (!carBody) return;

    // Calculate drift angle (angle between velocity and car forward)
    const velocity = new THREE.Vector3(carBody.velocity.x, 0, carBody.velocity.z);
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion(
        carBody.quaternion.x,
        carBody.quaternion.y,
        carBody.quaternion.z,
        carBody.quaternion.w
    ));

    if (velocity.length() > 5) {
        const driftAngle = Math.abs(Math.atan2(
            velocity.x * forward.z - velocity.z * forward.x,
            velocity.x * forward.x + velocity.z * forward.z
        ));

        state.driftAngle = driftAngle;
        state.isDrifting = driftAngle > 0.3 && state.speed > 20;
    } else {
        state.isDrifting = false;
    }

    // Update drift indicator
    const indicator = document.getElementById('driftIndicator');
    if (state.isDrifting) {
        indicator.classList.add('active');
    } else {
        indicator.classList.remove('active');
    }
}

function updateHUD() {
    // Speed
    document.getElementById('speedDisplay').textContent = Math.floor(state.speed);
    document.getElementById('speedStat').textContent = Math.floor(state.speed);

    // RPM bar
    const rpmPercent = (state.rpm / CONFIG.maxRPM) * 100;
    document.getElementById('rpmBar').style.width = rpmPercent + '%';
    document.getElementById('rpmStat').textContent = Math.floor(state.rpm);

    // Position
    if (carBody) {
        document.getElementById('posX').textContent = Math.floor(carBody.position.x);
        document.getElementById('posZ').textContent = Math.floor(carBody.position.z);
    }

    // FPS
    document.getElementById('fps').textContent = Math.floor(state.fps);
}

// ============================================
// GAME LOOP
// ============================================
let lastTime = 0;
let frameCount = 0;
let lastFpsTime = 0;

function gameLoop(time = 0) {
    if (!state.isPlaying) return;

    requestAnimationFrame(gameLoop);

    const delta = Math.min((time - lastTime) / 1000, 0.1); // Cap delta
    lastTime = time;

    // FPS Counter
    frameCount++;
    if (time - lastFpsTime >= 1000) {
        state.fps = frameCount;
        frameCount = 0;
        lastFpsTime = time;
    }

    // Step physics
    world.step(CONFIG.physicsStep);

    // Update car physics
    updatePhysics();

    // Sync visual car with physics
    if (carMesh && carBody) {
        carMesh.position.copy(carBody.position);
        carMesh.position.y -= 0.3; // Adjust for chassis center
        carMesh.quaternion.copy(carBody.quaternion);
    }

    // Update camera
    updateCamera();

    // Update particles
    updateParticles(delta);

    // Update culling
    updateCulling();

    // Update minimap
    updateMinimap();

    // Update HUD
    updateHUD();

    // Update time
    state.time += delta;

    // Render
    if (composer) {
        composer.render();
    } else {
        renderer.render(scene, camera);
    }
}

// ============================================
// START
// ============================================
init();
