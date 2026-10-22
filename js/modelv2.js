// ----------------------------
// Three.js Rocket Visualization with Calibration
// ----------------------------

let scene, camera, renderer, rocket, controls, container;
const targetQuaternion = new THREE.Quaternion();
const timer = 250;

// CSV columns: EUL(r|p|y) from the FC packet (BNO055 fusion), see server.py HEADERS
const HEADERS = { ROLL: 'ROLL', PITCH: 'PITCH', YAW: 'YAW' };

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
        'CanSat.glb',
        (gltf) => {
            rocket = gltf.scene;
            // Outer can (node names from the CAD export: 'lower shell', 'lower shell 2', top-shell segments
            // 'ts 1'/'ts2'/'ts3', 'bottom plate', 'cover op tplate') in pink; boards, rods, arms, propellers black.
            const SHELL = /shell|plate|^ts/i;
            rocket.traverse((o) => {
                if (o.isMesh) o.material = new THREE.MeshStandardMaterial({
                    color: SHELL.test(o.name) ? 0xFF1493 : 0x111111, metalness: 0.2, roughness: 0.55 });
            });

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

            // CanSat.glb is baked upright (+Y up, propellers on top); telemetry attitude is slerped onto it

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
    Papa.parse(CSV_PATH, {
        download: true,
        header: true,
        skipEmptyLines: true,
        complete: ({ data }) => {
            if (!data.length) return;
            const latest = data[data.length - 1];
            if (latest[HEADERS.ROLL] && latest[HEADERS.PITCH] && latest[HEADERS.YAW]) {
                updateRocketOrientation(latest);
                displayEulerAngles(latest);
            }
        },
        error: (err) => console.error("Failed to load CSV:", err)
    });
}

// ----------------------------
// Orientation: straight from the packet's ROLL / PITCH / YAW (degrees)
// ----------------------------
// CanSat.glb is baked with its body axis on +Y. Yaw turns the can about that vertical axis
// (BNO055 heading is clockwise-positive, three.js Y rotation is counter-clockwise, hence -yaw),
// pitch tilts it about X, roll about Z. Applied yaw -> pitch -> roll ('YXZ').
function readAngles(data) {
    const roll = parseFloat(data[HEADERS.ROLL]);
    const pitch = parseFloat(data[HEADERS.PITCH]);
    const yaw = parseFloat(data[HEADERS.YAW]);
    if ([roll, pitch, yaw].some(isNaN)) return null;
    return {
        roll: roll - (isCalibrated ? calibRoll : 0),
        pitch: pitch - (isCalibrated ? calibPitch : 0),
        yaw: yaw - (isCalibrated ? calibYaw : 0)
    };
}

function updateRocketOrientation(data) {
    const a = readAngles(data);
    if (!rocket || !a) return;
    const d = THREE.MathUtils.degToRad;
    targetQuaternion.setFromEuler(new THREE.Euler(d(a.pitch), d(-a.yaw), d(a.roll), 'YXZ'));
}

function displayEulerAngles(data) {
    const a = readAngles(data);
    if (!a) return;
    document.getElementById('roll-value').textContent = `${a.roll.toFixed(2)}°`;
    document.getElementById('pitch-value').textContent = `${a.pitch.toFixed(2)}°`;
    document.getElementById('yaw-value').textContent = `${a.yaw.toFixed(2)}°`;
}

// ----------------------------
// Calibration: take the current attitude (can standing upright) as zero
// ----------------------------
function calibrateRocket(data) {
    const roll = parseFloat(data[HEADERS.ROLL]);
    const pitch = parseFloat(data[HEADERS.PITCH]);
    const yaw = parseFloat(data[HEADERS.YAW]);
    if ([roll, pitch, yaw].some(isNaN)) return;
    calibRoll = roll; calibPitch = pitch; calibYaw = yaw;
    isCalibrated = true;
    console.log("Calibration complete:", { calibRoll, calibPitch, calibYaw });
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
        Papa.parse(CSV_PATH, {
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
