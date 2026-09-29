import RAPIER from "./vendor/rapier.mjs";

const FIXED_STEP = 1 / 120;
const MAX_FRAME_DT = 0.05;
const mobileQuery = window.matchMedia("(max-width: 760px)");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const state = {
  ready: false,
  active: false,
  barba: false,
  collisionImpulse: 0,
  lastSpeed: 0,
  physicsSteps: 0
};

const dom = {
  canvas: document.getElementById("npc-world"),
  hud: document.getElementById("world-hud"),
  speed: document.getElementById("world-speed"),
  gear: document.getElementById("world-gear"),
  splash: document.getElementById("splash")
};

if (!dom.canvas) throw new Error("Missing #npc-world canvas");

document.head.appendChild(Object.assign(document.createElement("style"), {
  textContent: `
    #npc-world{position:fixed;inset:0;width:100%;height:100%;z-index:-1;display:block;opacity:0;
      pointer-events:none;transition:opacity .9s ease,filter .9s ease;filter:brightness(.52) saturate(.68)}
    body.npc-world-active #npc-world{opacity:1;filter:brightness(.72) saturate(.86)}
    body.npc-world-active .bg{opacity:.18;transition:opacity .9s ease}
    body.npc-world-active .layout{background:
      linear-gradient(90deg,rgba(247,250,245,.92) 0%,rgba(240,248,246,.78) 48%,rgba(7,18,27,.1) 100%),
      radial-gradient(circle at 82% 46%,rgba(33,117,139,.08),transparent 42%)}
    #world-hud{position:fixed;left:18px;bottom:22px;z-index:9986;display:grid;
      grid-template-columns:auto auto;align-items:baseline;min-width:112px;padding:9px 13px 8px;
      border:1px solid rgba(126,213,235,.36);border-radius:10px;background:rgba(4,13,24,.72);
      color:#e8fbff;box-shadow:0 12px 36px rgba(0,0,0,.32);backdrop-filter:blur(10px);
      opacity:0;transform:translateY(12px);pointer-events:none;transition:opacity .3s,transform .3s;
      font-family:var(--mono)}
    body.npc-world-active #world-hud{opacity:1;transform:none}
    #world-hud b{min-width:52px;font-size:24px;line-height:1;text-align:right;font-weight:600}
    #world-hud span{margin-left:6px;color:#8fd7ea;font-size:9px;letter-spacing:.16em}
    #world-hud i{grid-column:1/-1;margin-top:4px;color:#79e6c2;font-size:9px;font-style:normal;
      letter-spacing:.2em;text-align:right;text-transform:uppercase}
    body.world-drift #world-hud{border-color:rgba(255,192,91,.55)}
    body.world-drift #world-hud i{color:#ffc35b}
    @media(max-width:760px){
      #world-hud{left:12px;bottom:12px;transform:translateY(8px) scale(.92);transform-origin:left bottom}
      body.npc-world-active .bg{opacity:.1}
      body.npc-world-active .layout{background:linear-gradient(180deg,rgba(247,250,245,.9),rgba(238,247,245,.8))}
    }
    @media(prefers-reduced-motion:reduce){
      #npc-world,#world-hud,.bg{transition:none!important}
    }
  `
}));

function waitFor(check, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const tick = () => {
      if (check()) {
        resolve();
        return;
      }
      if (performance.now() - started > timeout) {
        reject(new Error("Timed out waiting for Three.js"));
        return;
      }
      requestAnimationFrame(tick);
    };
    tick();
  });
}

function setPressed(keys, key, pressed) {
  keys[key] = Boolean(pressed);
  const shared = window.__driveDbg?.keys;
  if (shared) shared[key] = Boolean(pressed);
}

function isEditableTarget(target) {
  return target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

await RAPIER.init();
await waitFor(() => window.THREE);

const THREE = window.THREE;
const renderer = new THREE.WebGLRenderer({
  canvas: dom.canvas,
  antialias: !mobileQuery.matches,
  alpha: true,
  powerPreference: "high-performance"
});
const gl = renderer.getContext();
const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
const rendererName = debugInfo
  ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || "")
  : "";
const softwareRenderer = /swiftshader|llvmpipe|software/i.test(rendererName);
const lowPower = softwareRenderer || mobileQuery.matches;
const renderScale = softwareRenderer ? 0.22 : mobileQuery.matches ? 0.72 : 1;
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowPower ? 1 : 1.25));
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.shadowMap.enabled = !lowPower;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x050508, mobileQuery.matches ? 0.027 : 0.021);

const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 240);
camera.position.set(0, 4.6, -10);

const hemiLight = new THREE.HemisphereLight(0x9de8ff, 0x061015, 0.75);
scene.add(hemiLight);
const keyLight = new THREE.DirectionalLight(0x7de5ff, 1.45);
keyLight.position.set(-8, 14, -6);
keyLight.castShadow = !lowPower;
keyLight.shadow.mapSize.set(1024, 1024);
keyLight.shadow.camera.near = 1;
keyLight.shadow.camera.far = 45;
keyLight.shadow.camera.left = -14;
keyLight.shadow.camera.right = 14;
keyLight.shadow.camera.top = 14;
keyLight.shadow.camera.bottom = -14;
scene.add(keyLight);
const rimLight = new THREE.PointLight(0xb777ff, 1.15, 35, 2);
rimLight.position.set(7, 5, 9);
scene.add(rimLight);

const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
world.timestep = FIXED_STEP;

function addStaticBox(x, y, z, hx, hy, hz, color, options = {}) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2),
    new THREE.MeshStandardMaterial({
      color,
      emissive: options.emissive || 0x000000,
      emissiveIntensity: options.emissiveIntensity || 0,
      metalness: options.metalness ?? 0.4,
      roughness: options.roughness ?? 0.58
    })
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = !lowPower;
  mesh.receiveShadow = true;
  scene.add(mesh);

  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
  world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setFriction(0.9), body);
  return mesh;
}

addStaticBox(0, -0.55, 0, 90, 0.5, 90, 0x07141b, { metalness: 0.15, roughness: 0.92 });

const road = new THREE.Mesh(
  new THREE.PlaneGeometry(20, 150),
  new THREE.MeshStandardMaterial({ color: 0x0a2029, metalness: 0.42, roughness: 0.66 })
);
road.rotation.x = -Math.PI / 2;
road.position.y = 0.002;
road.receiveShadow = true;
scene.add(road);

const roadLineMaterial = new THREE.MeshBasicMaterial({ color: 0x76e9f0, transparent: true, opacity: 0.72 });
for (const x of [-9.7, 9.7]) {
  const line = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.015, 145), roadLineMaterial);
  line.position.set(x, 0.02, 0);
  scene.add(line);
}

for (let z = -68; z <= 68; z += 8) {
  const marker = new THREE.Mesh(
    new THREE.BoxGeometry(0.24, 0.02, 3.8),
    new THREE.MeshBasicMaterial({ color: 0xa46dff, transparent: true, opacity: 0.42 })
  );
  marker.position.set(0, 0.02, z);
  scene.add(marker);
}

const grid = new THREE.GridHelper(120, 60, 0x244e61, 0x102a36);
grid.position.y = 0.012;
grid.material.transparent = true;
grid.material.opacity = 0.28;
scene.add(grid);

for (const [x, z, w, h, d, color] of [
  [-18, -22, 7, 10, 9, 0x0e2635],
  [18, -24, 6, 14, 8, 0x14233a],
  [-17, 17, 8, 7, 7, 0x102c31],
  [18, 21, 7, 11, 10, 0x251b3b],
  [-29, 2, 5, 18, 5, 0x0b1d2f],
  [29, -2, 5, 16, 5, 0x1d1631],
  [-15, 49, 9, 8, 8, 0x15323b],
  [15, 50, 7, 12, 7, 0x1a1d37]
]) {
  addStaticBox(x, h / 2, z, w / 2, h / 2, d / 2, color, { emissive: color, emissiveIntensity: 0.08 });
}

const colliders = [
  [-5, 1.1, -8, 1.0, 1.1, 1.0, 0x0a5263],
  [5.2, 0.8, 16, 0.9, 0.8, 1.8, 0x287d85],
  [-5.6, 0.65, 36, 1.7, 0.65, 0.8, 0x7550a8],
  [0, 0.45, 58, 5.2, 0.45, 0.42, 0x0e6176]
];
for (const [x, y, z, hx, hy, hz, color] of colliders) {
  addStaticBox(x, y, z, hx, hy, hz, color, { emissive: color, emissiveIntensity: 0.2 });
}

const trunkGeometry = new THREE.CylinderGeometry(0.12, 0.2, 1.5, 6);
const crownGeometry = new THREE.ConeGeometry(0.75, 2.4, 7);
const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x203a38, roughness: 0.9 });
const crownMaterial = new THREE.MeshStandardMaterial({
  color: 0x1a7f76,
  emissive: 0x063b40,
  emissiveIntensity: 0.45,
  roughness: 0.72
});
const treeCount = mobileQuery.matches ? 24 : 48;
const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, treeCount);
const crowns = new THREE.InstancedMesh(crownGeometry, crownMaterial, treeCount);
const matrix = new THREE.Matrix4();
for (let i = 0; i < treeCount; i++) {
  const side = i % 2 ? -1 : 1;
  const x = side * (15 + (i % 5) * 2.4);
  const z = -62 + ((i * 13) % 124);
  const scale = 0.75 + (i % 7) * 0.08;
  matrix.compose(
    new THREE.Vector3(x, 0.75 * scale, z),
    new THREE.Quaternion(),
    new THREE.Vector3(scale, scale, scale)
  );
  trunks.setMatrixAt(i, matrix);
  matrix.compose(
    new THREE.Vector3(x, 2.15 * scale, z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), i),
    new THREE.Vector3(scale, scale, scale)
  );
  crowns.setMatrixAt(i, matrix);
}
scene.add(trunks, crowns);

const rings = [];
for (let i = 0; i < 5; i++) {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(2.6 + i * 0.12, 0.045, 8, 64),
    new THREE.MeshBasicMaterial({ color: i % 2 ? 0xb67cff : 0x51d9df, transparent: true, opacity: 0.72 })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.set(0, 2.6, -10 - i * 16);
  scene.add(ring);
  rings.push(ring);
}

const chassis = new THREE.Group();
chassis.scale.setScalar(1.16);
scene.add(chassis);
const carMaterial = new THREE.MeshStandardMaterial({
  color: 0x102633,
  emissive: 0x0a5263,
  emissiveIntensity: 0.24,
  metalness: 0.72,
  roughness: 0.3
});
const bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.62, 3.35), carMaterial);
bodyMesh.position.y = 0.08;
bodyMesh.castShadow = !lowPower;
chassis.add(bodyMesh);

const cabin = new THREE.Mesh(
  new THREE.BoxGeometry(1.42, 0.62, 1.45),
  new THREE.MeshStandardMaterial({
    color: 0x7ad9e3,
    emissive: 0x39c7d2,
    emissiveIntensity: 0.4,
    metalness: 0.15,
    roughness: 0.18,
    transparent: true,
    opacity: 0.84
  })
);
cabin.position.set(0, 0.56, -0.15);
cabin.castShadow = !lowPower;
chassis.add(cabin);

const nose = new THREE.Mesh(
  new THREE.BoxGeometry(1.45, 0.18, 0.5),
  new THREE.MeshStandardMaterial({ color: 0xa46dff, emissive: 0x7b3cff, emissiveIntensity: 1.1 })
);
nose.position.set(0, 0.14, 1.7);
chassis.add(nose);

const driver = new THREE.Group();
driver.position.set(0, 0.92, -0.18);
const driverBody = new THREE.Mesh(
  new THREE.CylinderGeometry(0.2, 0.2, 0.46, 10),
  new THREE.MeshStandardMaterial({ color: 0x8bddff, emissive: 0x197fa8, emissiveIntensity: 0.5 })
);
const driverHead = new THREE.Mesh(
  new THREE.SphereGeometry(0.24, 14, 12),
  new THREE.MeshStandardMaterial({ color: 0xdff8ff, emissive: 0x57cde0, emissiveIntensity: 0.35 })
);
driverHead.position.y = 0.48;
driver.add(driverBody, driverHead);
chassis.add(driver);

const wheelMaterial = new THREE.MeshStandardMaterial({
  color: 0x071016,
  emissive: 0x123b45,
  emissiveIntensity: 0.35,
  roughness: 0.72,
  metalness: 0.42
});
const wheelGeometry = new THREE.CylinderGeometry(0.29, 0.29, 0.24, 18);
wheelGeometry.rotateZ(Math.PI / 2);
const wheelVisuals = [];

const vehicleBody = world.createRigidBody(
  RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(0, 1.2, -58)
    .setLinearDamping(0.08)
    .setAngularDamping(0.7)
    .setCanSleep(false)
    .setCcdEnabled(true)
);
world.createCollider(
  RAPIER.ColliderDesc.cuboid(0.95, 0.38, 1.75)
    .setDensity(115)
    .setFriction(1.15)
    .setRestitution(0.08),
  vehicleBody
);
const vehicle = world.createVehicleController(vehicleBody);
vehicle.indexUpAxis = 1;
vehicle.setIndexForwardAxis = 2;

const wheelLayout = [
  { x: -0.88, y: -0.28, z: 1.18, front: true },
  { x: 0.88, y: -0.28, z: 1.18, front: true },
  { x: -0.88, y: -0.28, z: -1.18, front: false },
  { x: 0.88, y: -0.28, z: -1.18, front: false }
];

for (const wheel of wheelLayout) {
  vehicle.addWheel(
    { x: wheel.x, y: wheel.y, z: wheel.z },
    { x: 0, y: -1, z: 0 },
    { x: -1, y: 0, z: 0 },
    0.42,
    0.29
  );
  const index = vehicle.numWheels() - 1;
  vehicle.setWheelSuspensionStiffness(index, 52);
  vehicle.setWheelSuspensionCompression(index, 3.4);
  vehicle.setWheelSuspensionRelaxation(index, 2.45);
  vehicle.setWheelMaxSuspensionTravel(index, 0.42);
  vehicle.setWheelMaxSuspensionForce(index, 15000);
  vehicle.setWheelFrictionSlip(index, 3.15);
  vehicle.setWheelSideFrictionStiffness(index, 1.85);
  const pivot = new THREE.Group();
  const spin = new THREE.Group();
  const mesh = new THREE.Mesh(wheelGeometry, wheelMaterial);
  mesh.castShadow = !lowPower;
  spin.add(mesh);
  pivot.add(spin);
  scene.add(pivot);
  wheelVisuals.push({ pivot, spin, front: wheel.front });
}

const keys = Object.create(null);
const inputKeys = new Set([
  "arrowup", "arrowdown", "arrowleft", "arrowright",
  "w", "a", "s", "d", "shift", "h", "r", " "
]);

function resetVehicle() {
  keys.r = keys.arrowup = keys.arrowdown = keys.arrowleft = keys.arrowright =
    keys.w = keys.a = keys.s = keys.d = keys.shift = keys.h = false;
  vehicleBody.setTranslation({ x: 0, y: 1.2, z: -58 }, true);
  vehicleBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
  vehicleBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
  vehicleBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
  camera.position.set(0, 4.6, -68);
}

function jumpVehicle() {
  const velocity = vehicleBody.linvel();
  if (velocity.y > 1.5) return;
  vehicleBody.setLinvel({ x: velocity.x, y: 6.7, z: velocity.z }, true);
}

function speak(message) {
  const bubble = document.getElementById("sp-npc-talk");
  if (!bubble) return;
  bubble.textContent = message;
  bubble.classList.add("show");
  clearTimeout(speak.timer);
  speak.timer = setTimeout(() => bubble.classList.remove("show"), 2200);
}

document.addEventListener("keydown", (event) => {
  if (!state.active || isEditableTarget(event.target)) return;
  const key = event.key.toLowerCase();
  if (!inputKeys.has(key)) return;
  event.preventDefault();
  if (key === "r") {
    resetVehicle();
    speak(document.documentElement.lang === "en" ? "Vehicle reset." : "车辆已重置。");
    return;
  }
  if (key === " ") {
    jumpVehicle();
    return;
  }
  setPressed(keys, key, true);
});

document.addEventListener("keyup", (event) => {
  const key = event.key.toLowerCase();
  if (!inputKeys.has(key)) return;
  setPressed(keys, key, false);
});

window.addEventListener("blur", () => {
  for (const key of inputKeys) setPressed(keys, key, false);
});

function currentInput() {
  const forward = (keys.arrowup || keys.w ? 1 : 0) - (keys.arrowdown || keys.s ? 1 : 0);
  const steering = (keys.arrowright || keys.d ? 1 : 0) - (keys.arrowleft || keys.a ? 1 : 0);
  return {
    forward,
    steering,
    drift: Boolean(keys.shift),
    honk: Boolean(keys.h)
  };
}

let steerAngle = 0;
function simulate(dt) {
  if (!state.active) return;
  const input = currentInput();
  const speed = vehicle.currentVehicleSpeed();
  const targetSteer = input.steering * 0.52;
  steerAngle += (targetSteer - steerAngle) * Math.min(1, dt * 8.5);

  const engineForce = input.forward >= 0 ? input.forward * 1850 : input.forward * 1350;
  const braking = input.forward === 0 ? 1.2 : 0;
  for (let i = 0; i < vehicle.numWheels(); i++) {
    const front = wheelLayout[i].front;
    const rear = !front;
    vehicle.setWheelSteering(i, front ? steerAngle : 0);
    vehicle.setWheelEngineForce(i, rear ? engineForce : engineForce * 0.22);
    vehicle.setWheelBrake(i, braking);
    vehicle.setWheelSideFrictionStiffness(i, input.drift && rear ? 0.62 : 1.85);
    vehicle.setWheelFrictionSlip(i, input.drift ? 2.05 : 3.15);
  }

  const before = { x: vehicleBody.linvel().x, y: vehicleBody.linvel().y, z: vehicleBody.linvel().z };
  vehicle.updateVehicle(dt);
  world.step();
  state.physicsSteps++;

  const after = vehicleBody.linvel();
  const impulse = Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z);
  if (impulse > 5.4) state.collisionImpulse = Math.min(1, impulse / 16);
  state.lastSpeed = Math.abs(speed) * 3.6;
}

function updateVisuals(dt, now) {
  const position = vehicleBody.translation();
  const rotation = vehicleBody.rotation();
  chassis.position.set(position.x, position.y, position.z);
  chassis.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);

  for (let i = 0; i < wheelVisuals.length; i++) {
    const visual = wheelVisuals[i];
    const hardPoint = vehicle.wheelHardPoint(i) || wheelLayout[i];
    const suspension = Math.max(0.05, vehicle.wheelSuspensionLength(i) || 0.42);
    visual.pivot.position.set(
      hardPoint.x,
      hardPoint.y - suspension - 0.25,
      hardPoint.z
    );
    visual.pivot.rotation.y = visual.front ? steerAngle : 0;
    visual.spin.rotation.x = -(vehicle.wheelRotation(i) || 0);
  }

  for (let i = 0; i < rings.length; i++) {
    const ring = rings[i];
    ring.rotation.z = now * 0.00022 * (i % 2 ? -1 : 1);
    ring.material.opacity = 0.42 + 0.3 * Math.sin(now * 0.0017 + i);
  }

  const speed = Math.abs(vehicle.currentVehicleSpeed()) * 3.6;
  state.lastSpeed = speed;
  if (dom.speed) dom.speed.textContent = String(Math.min(199, Math.round(speed))).padStart(3, "0");
  if (dom.gear) {
    const input = currentInput();
    dom.gear.textContent = input.forward < 0 ? "R" : input.forward > 0 ? "D" : "N";
  }
  document.body.classList.toggle("world-drift", Boolean(keys.shift) && speed > 24);

  const cameraOffset = new THREE.Vector3(
    0,
    mobileQuery.matches ? 4.1 : 3.15,
    mobileQuery.matches ? -8.6 : -6.4
  ).applyQuaternion(chassis.quaternion);
  const desired = new THREE.Vector3(position.x, position.y, position.z).add(cameraOffset);
  const blend = reducedMotion ? 1 : 1 - Math.exp(-dt * 4.4);
  camera.position.lerp(desired, blend);
  if (state.collisionImpulse > 0) {
    camera.position.x += (Math.random() - 0.5) * state.collisionImpulse * 0.34;
    camera.position.y += (Math.random() - 0.5) * state.collisionImpulse * 0.22;
    state.collisionImpulse *= Math.exp(-dt * 5.5);
  }
  const lookAhead = new THREE.Vector3(0, 0.7, 3.2).applyQuaternion(chassis.quaternion);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(chassis.quaternion);
  const compositionOffset = mobileQuery.matches ? 0 : 1.75;
  camera.lookAt(
    position.x + lookAhead.x - right.x * compositionOffset,
    position.y + lookAhead.y - right.y * compositionOffset,
    position.z + lookAhead.z - right.z * compositionOffset
  );
}

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(Math.round(width * renderScale), Math.round(height * renderScale), false);
  camera.aspect = width / Math.max(1, height);
  if (!mobileQuery.matches) {
    camera.setViewOffset(width, height, -Math.round(width * 0.24), 0, width, height);
  } else {
    camera.clearViewOffset();
  }
  camera.updateProjectionMatrix();
}

window.addEventListener("resize", resize, { passive: true });
resize();

let accumulator = 0;
let lastFrame = performance.now();
let lastRender = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const frameDt = Math.min(MAX_FRAME_DT, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  accumulator += frameDt;
  let steps = 0;
  while (accumulator >= FIXED_STEP && steps < 5) {
    simulate(FIXED_STEP);
    accumulator -= FIXED_STEP;
    steps++;
  }
  updateVisuals(frameDt, now);
  if (!softwareRenderer || now - lastRender >= 50) {
    renderer.render(scene, camera);
    lastRender = now;
  }
}

function activateWorld() {
  if (state.active) return;
  state.active = true;
  document.body.classList.add("npc-world-active");
  if (window.gsap && !reducedMotion) {
    window.gsap.timeline({ defaults: { ease: "power3.out" } })
      .to(camera.position, { y: 3.65, z: -8.2, duration: 1.15 }, 0)
      .fromTo("#world-hud", { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.45 }, 0.38)
      .to(".bg", { opacity: 0.18, duration: 0.9 }, 0);
  }
}

function setActiveAfterSplash() {
  if (dom.splash?.classList.contains("hide") || dom.splash?.classList.contains("leaving")) {
    activateWorld();
    return;
  }
  document.addEventListener("npc:adopt", activateWorld, { once: true });
  document.getElementById("sp-enter")?.addEventListener("click", activateWorld, { once: true });
  document.getElementById("sp-skip")?.addEventListener("click", activateWorld, { once: true });
}

function initBarba() {
  if (!window.barba || typeof window.barba.init !== "function") return;
  try {
    window.barba.init({
      transitions: [{
        name: "persistent-world",
        sync: true,
        leave(data) {
          if (!window.gsap) return;
          return window.gsap.to(data.current.container, {
            opacity: 0,
            y: -18,
            duration: 0.32,
            ease: "power2.in"
          });
        },
        enter(data) {
          if (!window.gsap) return;
          return window.gsap.fromTo(data.next.container,
            { opacity: 0, y: 18 },
            { opacity: 1, y: 0, duration: 0.42, ease: "power2.out" }
          );
        }
      }]
    });
    state.barba = true;
  } catch (error) {
    console.warn("Barba transition layer disabled:", error.message);
  }
}

document.addEventListener("click", (event) => {
  const link = event.target.closest?.(".sbnav a[href^='#']");
  if (!link || !state.active) return;
  const target = document.querySelector(link.getAttribute("href"));
  if (!target || !window.gsap || reducedMotion) return;
  event.preventDefault();
  history.pushState(null, "", link.getAttribute("href"));
  window.gsap.timeline()
    .to(["#sidebar", "#content"], { opacity: 0.28, y: 12, duration: 0.18, ease: "power2.in" })
    .call(() => target.scrollIntoView({ behavior: "smooth", block: "start" }))
    .to(["#sidebar", "#content"], { opacity: 1, y: 0, duration: 0.42, ease: "power2.out" });
});

resetVehicle();
requestAnimationFrame(frame);
setActiveAfterSplash();
initBarba();

state.ready = true;
window.__npcWorld = {
  get ready() { return state.ready; },
  get active() { return state.active; },
  get barba() { return state.barba; },
  softwareRenderer,
  lowPower,
  state,
  scene,
  camera,
  world,
  vehicle,
  body: vehicleBody,
  reset: resetVehicle,
  jump: jumpVehicle,
  activate: activateWorld,
  stats() {
    const position = vehicleBody.translation();
    const projected = new THREE.Vector3(position.x, position.y + 0.45, position.z).project(camera);
    return {
      speed: state.lastSpeed,
      physicsSteps: state.physicsSteps,
      colliders: world.colliders.len(),
      bodies: world.bodies.len(),
      callbacks: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      screen: {
        x: Math.round((projected.x + 1) * 0.5 * window.innerWidth),
        y: Math.round((1 - projected.y) * 0.5 * window.innerHeight)
      }
    };
  }
};
