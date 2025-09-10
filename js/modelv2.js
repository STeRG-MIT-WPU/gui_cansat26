// ----------------------------
// Three.js Rocket Visualization with Calibration
// ----------------------------

let scene, camera, renderer, rocket, controls, container;
const targetQuaternion = new THREE.Quaternion();
const timer = 250;

// CSV headers for gyro and accelerometer values
const HEADERS = { ROLL: 'GX', PITCH: 'GY', YAW: 'GZ', AX: 'AX', AY: 'AY', AZ: 'AZ' };

// Default camera settings
const defaultCameraPosition = new THREE.Vector3(5, 5, 5);
const defaultTarget = new THREE.Vector3(0, 0, 0);

// Slerp smoothing factor (lower = smoother)
const SLERP_FACTOR = 0.05;

// Calibration variables
let calibRoll = 0, calibPitch = 0, calibYaw = 0;
let isCalibrated = false;

// ----------------------------
// Initialization
// ----------------------------
function init() {
    container = document.getElementById('rocket-container');

    initScene();
    initCamera();
    initRenderer();
    initLights();
    initControls();
    initHelpers();
    loadRocketModel();
    setupCSVPolling();
    setupEventListeners();

    animate();
}

// ----------------------------
// Scene, Camera, Renderer
// ----------------------------
function initScene() {
    scene = new THREE.Scene();
}

function initCamera() {
    camera = new THREE.PerspectiveCamera(
        75,
        container.clientWidth / container.clientHeight,
        0.1,
        100
    );
    camera.position.copy(defaultCameraPosition);
}

function initRenderer() {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);
}

// ----------------------------
// Lights & Helpers
// ----------------------------
function initLights() {
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(5, 5, 5);
    scene.add(directionalLight);
}

function initHelpers() {
    scene.add(new THREE.AxesHelper(5));
}

// ----------------------------
// Controls
// ----------------------------
function initControls() {
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.target.copy(defaultTarget);
    controls.update();
}

// ----------------------------
// Load Rocket Model
// ----------------------------
function loadRocketModel() {
    const loader = new THREE.GLTFLoader();
    loader.load(
        'model.glb',
        (gltf) => {
            rocket = gltf.scene;

            // Auto-scale and center
            const box = new THREE.Box3().setFromObject(rocket);
            const size = new THREE.Vector3();
            box.getSize(size);
            const maxDim = Math.max(size.x, size.y, size.z);
            const desiredSize = 8; // Desired size in scene units
            rocket.scale.setScalar(desiredSize / maxDim);

            box.setFromObject(rocket);
            const center = new THREE.Vector3();
            box.getCenter(center);
            rocket.position.sub(center);

            // Align up (optional)
            rocket.rotation.x = Math.PI / 2;

            scene.add(rocket);
        },
        undefined,
        (error) => console.error("Failed to load GLB model:", error)
    );
}

// ----------------------------
// CSV Data Handling
// ----------------------------
function setupCSVPolling() {
    loadCSVData();
    setInterval(loadCSVData, timer);
}

function loadCSVData() {
    Papa.parse('telemetry.csv', {
        download: true,
        header: true,
        skipEmptyLines: true,
        complete: ({ data }) => {
            if (!data.length) return;
            const latest = data[data.length - 1];
            if (latest[HEADERS.AX] && latest[HEADERS.AY] && latest[HEADERS.AZ] && latest[HEADERS.YAW]) {
                updateRocketOrientation(latest);
                displayEulerAngles(latest);
            }
        },
        error: (err) => console.error("Failed to load CSV:", err)
    });
}

// ----------------------------
// Orientation Calculations
// ----------------------------
function calculateAccelOrientation(data) {
    const ax = parseFloat(data[HEADERS.AX]);
    const ay = parseFloat(data[HEADERS.AY]);
    const az = parseFloat(data[HEADERS.AZ]);

    if ([ax, ay, az].some(isNaN)) return null;

    // Roll (X-axis)
    const roll = Math.atan2(ay, az) * (180 / Math.PI);
    // Pitch (Y-axis)
    const pitch = Math.atan2(-ax, Math.sqrt(ay * ay + az * az)) * (180 / Math.PI);

    return { roll, pitch };
}

function updateRocketOrientation(data) {
    const yaw = parseFloat(data[HEADERS.YAW]);
    const accelAngles = calculateAccelOrientation(data);

    if (rocket && accelAngles && !isNaN(yaw)) {
        // Apply calibration
        const rollCorrected = accelAngles.roll - (isCalibrated ? calibRoll : 0);
        const pitchCorrected = accelAngles.pitch - (isCalibrated ? calibPitch : 0);
        const yawCorrected = yaw - (isCalibrated ? calibYaw : 0);

        const rollRad = THREE.MathUtils.degToRad(-pitchCorrected);
        const pitchRad = THREE.MathUtils.degToRad(rollCorrected);
        const yawRad = THREE.MathUtils.degToRad(yawCorrected);

        const euler = new THREE.Euler(pitchRad, yawRad, rollRad, 'ZXY');
        targetQuaternion.setFromEuler(euler);
    }
}

function displayEulerAngles(data) {
    const accelAngles = calculateAccelOrientation(data);
    const yaw = parseFloat(data[HEADERS.YAW]);

    if (accelAngles) {
        const rollCorrected = accelAngles.roll - (isCalibrated ? calibRoll : 0);
        const pitchCorrected = accelAngles.pitch - (isCalibrated ? calibPitch : 0);

        document.getElementById('roll-value').textContent = `${rollCorrected.toFixed(2)}°`;
        document.getElementById('pitch-value').textContent = `${pitchCorrected.toFixed(2)}°`;
    }
    if (!isNaN(yaw)) {
        const yawCorrected = yaw - (isCalibrated ? calibYaw : 0);
        document.getElementById('yaw-value').textContent = `${yawCorrected.toFixed(2)}°`;
    }
}

// ----------------------------
// Calibration
// ----------------------------
function calibrateRocket(data) {
    const accelAngles = calculateAccelOrientation(data);
    const yaw = parseFloat(data[HEADERS.YAW]);

    if (accelAngles && !isNaN(yaw)) {
        calibRoll = accelAngles.roll;
        calibPitch = accelAngles.pitch - 10;
        calibYaw = yaw;
        isCalibrated = true;
        console.log("Calibration complete:", { calibRoll, calibPitch, calibYaw });
    }
}

// ----------------------------
// Camera & Window Controls
// ----------------------------
function resetCameraView() {
    gsap.to(camera.position, {
        x: defaultCameraPosition.x,
        y: defaultCameraPosition.y,
        z: defaultCameraPosition.z,
        duration: 2,
        ease: "power2.inOut",
        onUpdate: () => { camera.lookAt(defaultTarget); controls.update(); }
    });

    gsap.to(controls.target, {
        x: defaultTarget.x,
        y: defaultTarget.y,
        z: defaultTarget.z,
        duration: 2,
        ease: "power2.inOut",
        onUpdate: () => controls.update()
    });
}

function onWindowResize() {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}

function setupEventListeners() {
    window.addEventListener('resize', onWindowResize);
    document.getElementById('reset-btn')?.addEventListener('click', resetCameraView);

    // Calibration button
    document.getElementById('calib')?.addEventListener('click', () => {
        Papa.parse('telemetry.csv', {
            download: true,
            header: true,
            skipEmptyLines: true,
            complete: ({ data }) => {
                if (!data.length) return;
                const latest = data[data.length - 1];
                calibrateRocket(latest);
            }
        });
    });
}

// ----------------------------
// Animation Loop
// ----------------------------
function animate() {
    requestAnimationFrame(animate);

    if (rocket) rocket.quaternion.slerp(targetQuaternion, SLERP_FACTOR);

    controls?.update();
    renderer.render(scene, camera);
}

// ----------------------------
// Auto-init
// ----------------------------
document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init)
    : init();
