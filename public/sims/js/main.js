import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { createWorld, updateWorld, LOCATIONS, pulseLocation, updateStructures, updateTerritories, updateLocationHeat, updateBuildingTransparency } from './world.js';
import { CharacterManager } from './characters.js';
import { setupCamera, flyTo } from './camera.js';
import { UI } from './ui.js';
import { SimsWebSocket } from './websocket.js';
import { Minimap } from './minimap.js';

// --- Scene Setup ---
const canvas = document.getElementById('world-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(0x050510);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x0a0a1e, 0.004);

// --- Bloom Post-Processing ---
const composer = new EffectComposer(renderer);
// RenderPass and BloomPass added after camera setup below

// Lights — atmospheric setup
const ambientLight = new THREE.AmbientLight(0x303050, 0.4);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xffeedd, 1.0);
sunLight.position.set(50, 80, 30);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 2048;
sunLight.shadow.mapSize.height = 2048;
sunLight.shadow.camera.near = 0.5;
sunLight.shadow.camera.far = 200;
sunLight.shadow.camera.left = -100;
sunLight.shadow.camera.right = 100;
sunLight.shadow.camera.top = 100;
sunLight.shadow.camera.bottom = -100;
scene.add(sunLight);

const rimLight = new THREE.DirectionalLight(0x4444ff, 0.3);
rimLight.position.set(-50, 30, -50);
scene.add(rimLight);

const pointLight = new THREE.PointLight(0xff6b35, 0.4, 100);
pointLight.position.set(0, 20, 0);
scene.add(pointLight);

// Camera
const { camera, controls } = setupCamera(renderer);

// Bloom pipeline
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.4,  // strength
  0.6,  // radius
  0.85  // threshold
);
composer.addPass(bloomPass);

// World
createWorld(scene);

// Characters
const characterManager = new CharacterManager(scene);

// UI
const ui = new UI();

// Minimap
const minimap = new Minimap();
minimap.setupClickHandler((x, z) => flyTo(controls, x, z));

// --- Location lookup ---
const LOCATION_COORDS = {
  arena:  { x: 0,   z: 0 },
  shop:   { x: 40,  z: 0 },
  social: { x: -40, z: 0 },
  cafe:   { x: 20,  z: 30 },
  gym:    { x: -20, z: 30 },
};

// --- Screen Flash ---
const flashEl = document.getElementById('screen-flash');
function flashScreen(color, duration = 400) {
  if (!flashEl) return;
  flashEl.style.backgroundColor = color;
  flashEl.style.opacity = '0.3';
  flashEl.style.transition = `opacity ${duration}ms ease-out`;
  requestAnimationFrame(() => { flashEl.style.opacity = '0'; });
}

// --- Camera Shake ---
let shakeIntensity = 0;
let shakeEnd = 0;
function shakeCamera(intensity = 0.5, duration = 300) {
  shakeIntensity = intensity;
  shakeEnd = performance.now() + duration;
}

// --- State ---
let currentAgents = [];
let followingAgent = null;
let autoCameraEnabled = false;
let lastAutoCameraSwitch = 0;

// --- Raycaster ---
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

canvas.addEventListener('click', (e) => {
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(characterManager.getClickableObjects(), true);

  if (intersects.length > 0) {
    let obj = intersects[0].object;
    while (obj.parent && !obj.userData.agentId) obj = obj.parent;
    if (obj.userData.agentId) {
      const agent = characterManager.getAgent(obj.userData.agentId);
      if (agent) ui.showAgentPanel(agent);
    }
  }
});

// Double-click to follow agent
canvas.addEventListener('dblclick', (e) => {
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(characterManager.getClickableObjects(), true);

  if (intersects.length > 0) {
    let obj = intersects[0].object;
    while (obj.parent && !obj.userData.agentId) obj = obj.parent;
    if (obj.userData.agentId) {
      followingAgent = obj.userData.agentId;
      autoCameraEnabled = false;
      updateAutoCamIndicator();
      const agent = characterManager.getAgent(followingAgent);
      if (agent) ui.showAgentPanel(agent);
    }
  }
});

// --- Keyboard Shortcuts ---
const LOCATION_KEYS = { '1': 'arena', '2': 'shop', '3': 'social', '4': 'cafe', '5': 'gym' };

document.addEventListener('keydown', (e) => {
  // Don't capture if typing in an input
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  if (LOCATION_KEYS[e.key]) {
    const loc = LOCATION_COORDS[LOCATION_KEYS[e.key]];
    if (loc) {
      flyTo(controls, loc.x, loc.z);
      followingAgent = null;
    }
    return;
  }

  switch (e.key) {
    case ' ':
      e.preventDefault();
      controls.target.set(0, 0, 0);
      followingAgent = null;
      break;
    case 'f':
    case 'F':
      autoCameraEnabled = !autoCameraEnabled;
      if (autoCameraEnabled) followingAgent = null;
      updateAutoCamIndicator();
      break;
    case 'Escape':
      followingAgent = null;
      autoCameraEnabled = false;
      updateAutoCamIndicator();
      break;
    // Keyboard zoom (for users without scroll wheel)
    case 'z':
    case 'Z':
    case '=':
    case '+':
      e.preventDefault();
      camera.zoom = Math.min(camera.zoom * 1.15, 8);
      camera.updateProjectionMatrix();
      break;
    case 'x':
    case 'X':
    case '-':
    case '_':
      e.preventDefault();
      camera.zoom = Math.max(camera.zoom / 1.15, 0.3);
      camera.updateProjectionMatrix();
      break;
  }
});

function updateAutoCamIndicator() {
  const el = document.getElementById('autocam-indicator');
  if (el) {
    el.style.display = autoCameraEnabled ? 'block' : 'none';
  }
}

// --- WebSocket ---
const ws = new SimsWebSocket();

ws.on('world_state', (data) => {
  currentAgents = data.agents || [];
  characterManager.updateAgents(currentAgents);

  // Pass initiative data before agent list (so crew badges render)
  ui.updateCrews(data.crews || []);
  ui.updateHeadlines(data.headlines || []);

  ui.updateAgentList(currentAgents);
  ui.updateKing(data.hill);
  ui.updateAgentCount(currentAgents.length);
  minimap.update(currentAgents);

  // Update crew rings on characters
  if (data.crews) {
    characterManager.updateCrewData(data.crews);
  }

  // Update agent-built structures and territory overlays
  updateStructures(data.structures || []);
  updateTerritories(data.territories || []);
  updateLocationHeat(currentAgents);
});

ws.on('event', (data) => {
  // Route to activity stream based on type
  const type = data.type || data.event_type || 'event';
  ui.addStreamItem(type, data);

  // Visual status effect on the agent
  if (data.agent_id) {
    const effectMap = {
      viral_tweet: { text: 'VIRAL!', color: '#00ff88' },
      beef:        { text: 'BEEF!', color: '#ff4444' },
      drama:       { text: 'DRAMA!', color: '#ff4444' },
      windfall:    { text: '+$$$', color: '#ffdd00' },
      burnout:     { text: 'BURNOUT', color: '#ff8800' },
      prank:       { text: 'PRANKED!', color: '#ff44aa' },
      mentorship:  { text: 'LEVEL UP!', color: '#44ffaa' },
      collab:      { text: 'COLLAB!', color: '#44aaff' },
      // Initiative events
      challenge_issued:  { text: 'CHALLENGE!', color: '#ff4444' },
      challenge_resolved:{ text: 'WINNER!', color: '#ffd700' },
      crew_formed:       { text: 'CREW UP!', color: '#44ffdd' },
      crew_leadership:   { text: 'NEW LEADER!', color: '#ff44aa' },
      event_hosted:      { text: 'EVENT!', color: '#ffdd44' },
      goal_completed:    { text: 'ACHIEVED!', color: '#44ff88' },
      goal_set:          { text: 'NEW GOAL', color: '#88aaff' },
      structure_built:   { text: 'BUILT!', color: '#44aaff' },
      structure_destroyed: { text: 'CRUMBLED', color: '#888888' },
      territory_claimed: { text: 'CLAIMED!', color: '#ffaa44' },
      territory_expired: { text: 'LOST TURF', color: '#666666' },
    };
    const fx = effectMap[type];
    if (fx) {
      characterManager.showStatusEffect(data.agent_id, fx.text, fx.color);
    }

    // Dynamic world reactions
    if (type === 'challenge_resolved') {
      flashScreen('#ffd700', 500);
      shakeCamera(0.5, 300);
      if (data.location) pulseLocation(data.location, 0xffd700, 1500);
    } else if (type === 'goal_completed') {
      flashScreen('#44ff88', 400);
      if (data.location) pulseLocation(data.location, 0x44ff88, 1200);
    } else if (type === 'event_hosted') {
      flashScreen('#ffdd44', 400);
      if (data.location) pulseLocation(data.location, 0xffdd44, 2000);
    } else if (type === 'territory_claimed') {
      flashScreen(data.crew_color || '#ff6b35', 500);
      shakeCamera(0.3, 200);
      if (data.location) pulseLocation(data.location, parseInt((data.crew_color || '#ff6b35').replace('#', '0x')), 2000);
    } else if (type === 'structure_built') {
      if (data.location) pulseLocation(data.location, 0x44aaff, 1000);
    }
  }

  // Thought bubbles in 3D
  if (type === 'thought' && data.agent_id) {
    const pos = characterManager.getAgentScreenPosition(data.agent_id, camera, renderer);
    if (pos) ui.showThoughtBubble(data.text, pos.x, pos.y, data.agent_name);
  }
});

ws.on('speech', (data) => {
  // Show in stream
  ui.addStreamItem('speech', data);

  // Show as 3D speech bubble
  const pos = characterManager.getAgentScreenPosition(data.agent_id, camera, renderer);
  if (pos) ui.showSpeechBubble(data.text, pos.x, pos.y, data.agent_name);
});

// Fallback: REST polling if WebSocket fails
let restFallback = null;
ws.on('close', () => {
  restFallback = setInterval(async () => {
    try {
      const res = await fetch('/api/v1/sims/world/state');
      const data = await res.json();
      currentAgents = data.agents || [];
      characterManager.updateAgents(currentAgents);
      ui.updateCrews(data.crews || []);
      ui.updateHeadlines(data.headlines || []);
      ui.updateAgentList(currentAgents);
      ui.updateKing(data.hill);
      ui.updateAgentCount(currentAgents.length);
      minimap.update(currentAgents);
      if (data.crews) characterManager.updateCrewData(data.crews);
      updateStructures(data.structures || []);
      updateTerritories(data.territories || []);
      updateLocationHeat(currentAgents);
    } catch (e) { /* retry */ }
  }, 5000);
});

ws.on('open', () => {
  if (restFallback) {
    clearInterval(restFallback);
    restFallback = null;
  }
});

// --- Auto-Camera ---
function autoCamera(elapsed) {
  if (!autoCameraEnabled) return;
  if (elapsed - lastAutoCameraSwitch < 8) return;

  lastAutoCameraSwitch = elapsed;

  // Find busiest location
  const counts = {};
  for (const agent of currentAgents) {
    const loc = agent.current_location;
    if (loc && loc !== 'traveling') {
      counts[loc] = (counts[loc] || 0) + 1;
    }
  }

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (sorted.length > 0) {
    // Pick randomly between top 2 busiest for variety
    const pick = sorted[Math.floor(Math.random() * Math.min(2, sorted.length))];
    const loc = LOCATION_COORDS[pick[0]];
    if (loc) flyTo(controls, loc.x, loc.z);
  }
}

// --- Animation Loop ---
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();
  const elapsed = clock.getElapsedTime();

  controls.update();

  // Follow agent
  if (followingAgent) {
    const char = characterManager.characters.get(followingAgent);
    if (char) {
      controls.target.lerp(new THREE.Vector3(char.group.position.x, 0, char.group.position.z), 0.05);
    }
  }

  // Auto-camera
  autoCamera(elapsed);

  characterManager.update(delta, elapsed);
  updateWorld(elapsed);
  updateBuildingTransparency(camera, controls);

  // Camera shake
  const now = performance.now();
  if (now < shakeEnd && shakeIntensity > 0) {
    const t = (shakeEnd - now) / 300; // decay
    const offset = shakeIntensity * t;
    camera.position.x += (Math.random() - 0.5) * offset;
    camera.position.y += (Math.random() - 0.5) * offset * 0.5;
  }

  composer.render();
}

// --- Resize ---
window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  composer.setSize(w, h);
  bloomPass.resolution.set(w, h);

  if (camera.isOrthographicCamera) {
    const aspect = w / h;
    const frustumSize = 120;
    camera.left = -frustumSize * aspect / 2;
    camera.right = frustumSize * aspect / 2;
    camera.top = frustumSize / 2;
    camera.bottom = -frustumSize / 2;
  } else {
    camera.aspect = w / h;
  }
  camera.updateProjectionMatrix();
});

// --- Start ---
setTimeout(() => {
  document.getElementById('loading').classList.add('hidden');
}, 2200);

ws.connect();
animate();
