import * as THREE from 'three';

const LOCATIONS = {
  arena:  { x: 0,   z: 0,   w: 20, d: 20, h: 12, color: 0xff4444, name: 'THE ARENA' },
  shop:   { x: 40,  z: 0,   w: 14, d: 10, h: 7,  color: 0x44aa44, name: 'SHOP' },
  social: { x: -40, z: 0,   w: 14, d: 14, h: 6,  color: 0x4444ff, name: 'SOCIAL HUB' },
  cafe:   { x: 20,  z: 30,  w: 10, d: 10, h: 5,  color: 0xaa8844, name: 'CAFE' },
  gym:    { x: -20, z: 30,  w: 12, d: 12, h: 6,  color: 0xaa44aa, name: 'GYM' },
};

let _scene = null;
let decorations = []; // tree leaves for sway
let particles = { embers: null, sparkles: null, fireflies: null, fountainSplash: null, gymSparks: null };
let flames = [];
let fountainParts = [];
let lampBulbs = [];       // for flicker
let windowMeshes = [];    // for flicker
let starPoints = null;    // for twinkle

// --- Pulse lights (temporary event flashes) ---
let pulseLights = [];

// --- Agent-built structures ---
const structureMeshes = new Map(); // id -> THREE.Group

// --- Territory overlays ---
const territoryMeshes = new Map(); // id -> THREE.Mesh

// --- Location heat lights ---
const heatLights = {};

// --- Building transparency system ---
const buildingParts = {};     // id -> { body, bodyMat, roof, roofMat, frontWall, frontWallMat, edges, edgesMat, frontWindows[] }
const buildingInteriors = {}; // id -> THREE.Group

export function createWorld(scene) {
  _scene = scene;
  createSky(scene);
  createStars(scene);
  createGround(scene);
  createRoads(scene);

  // Buildings
  for (const [id, loc] of Object.entries(LOCATIONS)) {
    const group = createBuilding(loc, id);
    scene.add(group);
    // Create heat light per location
    const hl = new THREE.PointLight(loc.color, 0, 35);
    hl.position.set(loc.x, loc.h + 2, loc.z);
    scene.add(hl);
    heatLights[id] = hl;
  }

  // Home zone markers
  for (let px = 0; px < 6; px++) {
    for (let py = 0; py < 3; py++) {
      const x = -50 + px * 16;
      const z = 50 + py * 16;
      const plotMat = new THREE.MeshStandardMaterial({
        color: 0x2a3a4a, roughness: 0.9, transparent: true, opacity: 0.4,
      });
      const plot = new THREE.Mesh(new THREE.BoxGeometry(12, 0.1, 12), plotMat);
      plot.position.set(x, 0.05, z);
      scene.add(plot);
    }
  }

  addDecorations(scene);
  addWorldProps(scene);
  createArenaEmbers(scene);
  createShopSparkles(scene);
  createArenaFlames(scene);
  createFountain(scene);
  createFireflies(scene);
  createFountainSplash(scene);
  createGymSparks(scene);
}

// --- Sky Dome ---
function createSky(scene) {
  const skyGeo = new THREE.SphereGeometry(400, 32, 32);
  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      topColor: { value: new THREE.Color(0x050520) },
      midColor: { value: new THREE.Color(0x0a0a3a) },
      bottomColor: { value: new THREE.Color(0x1a1a3e) },
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 midColor;
      uniform vec3 bottomColor;
      varying vec3 vWorldPosition;
      void main() {
        float h = normalize(vWorldPosition).y;
        vec3 col = mix(bottomColor, midColor, smoothstep(0.0, 0.3, h));
        col = mix(col, topColor, smoothstep(0.3, 0.8, h));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));
}

// --- Stars with twinkle ---
function createStars(scene) {
  const count = 400;
  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);  // twinkle phase offset
  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 0.5 + 0.5);
    const r = 350;
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi);
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    phases[i] = Math.random() * Math.PI * 2;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  starGeo.setAttribute('phase', new THREE.BufferAttribute(phases, 1));

  const starMat = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      color: { value: new THREE.Color(0xffffff) },
    },
    vertexShader: `
      attribute float phase;
      varying float vAlpha;
      uniform float time;
      void main() {
        vAlpha = 0.4 + 0.5 * sin(time * 0.8 + phase * 6.28);
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = 1.5 + 0.8 * sin(time * 1.2 + phase * 3.14);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 color;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        if (d > 0.5) discard;
        gl_FragColor = vec4(color, vAlpha * (1.0 - d * 2.0));
      }
    `,
    transparent: true,
    depthWrite: false,
  });
  starPoints = new THREE.Points(starGeo, starMat);
  scene.add(starPoints);
}

// --- Ground with enhanced texture + subtle vertex displacement ---
function createGround(scene) {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Dark earthy base
  ctx.fillStyle = '#1a2a1a';
  ctx.fillRect(0, 0, size, size);

  // Multi-layer noise
  for (let i = 0; i < 12000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const shade = Math.random();
    if (shade > 0.75) ctx.fillStyle = '#1e3020';
    else if (shade > 0.5) ctx.fillStyle = '#162818';
    else if (shade > 0.25) ctx.fillStyle = '#1b2b18';
    else ctx.fillStyle = '#22351e';
    ctx.fillRect(x, y, 1 + Math.random() * 4, 1 + Math.random() * 4);
  }

  // Brown dirt patches
  for (let i = 0; i < 30; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 10 + Math.random() * 30;
    ctx.fillStyle = `rgba(60, 40, 25, ${0.15 + Math.random() * 0.15})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Subtle glow zones near building positions (mapped to texture coords)
  const glowPoints = [
    { x: 0.5, y: 0.5, color: 'rgba(255,68,68,0.06)' },      // arena
    { x: 0.63, y: 0.5, color: 'rgba(68,170,68,0.05)' },      // shop
    { x: 0.37, y: 0.5, color: 'rgba(68,68,255,0.05)' },      // social
    { x: 0.57, y: 0.6, color: 'rgba(170,136,68,0.04)' },     // cafe
    { x: 0.43, y: 0.6, color: 'rgba(170,68,170,0.04)' },     // gym
  ];
  for (const gp of glowPoints) {
    const grad = ctx.createRadialGradient(gp.x * size, gp.y * size, 0, gp.x * size, gp.y * size, 60);
    grad.addColorStop(0, gp.color);
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }

  // Path hints
  ctx.strokeStyle = '#1e2e1e';
  ctx.lineWidth = 10;
  ctx.beginPath(); ctx.moveTo(0, size / 2); ctx.lineTo(size, size / 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(size / 2, 0); ctx.lineTo(size / 2, size); ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(10, 10);

  // Vertex displacement for gentle rolling
  const groundGeo = new THREE.PlaneGeometry(300, 300, 64, 64);
  const posAttr = groundGeo.attributes.position;
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const y = posAttr.getY(i);
    // Gentle hills, but flat under buildings
    let inBuilding = false;
    for (const loc of Object.values(LOCATIONS)) {
      if (Math.abs(x - loc.x) < loc.w / 2 + 3 && Math.abs(y - loc.z) < loc.d / 2 + 3) {
        inBuilding = true;
        break;
      }
    }
    if (!inBuilding) {
      const h = Math.sin(x * 0.04) * Math.cos(y * 0.03) * 0.25 +
                Math.sin(x * 0.08 + 1.5) * Math.sin(y * 0.06) * 0.15;
      posAttr.setZ(i, h);
    }
  }
  groundGeo.computeVertexNormals();

  const ground = new THREE.Mesh(
    groundGeo,
    new THREE.MeshStandardMaterial({ map: texture, roughness: 0.95 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
}

// --- Roads ---
function createRoads(scene) {
  const roadCanvas = document.createElement('canvas');
  roadCanvas.width = 128;
  roadCanvas.height = 128;
  const rctx = roadCanvas.getContext('2d');
  rctx.fillStyle = '#2c3e50';
  rctx.fillRect(0, 0, 128, 128);
  rctx.strokeStyle = '#3a4f63';
  rctx.lineWidth = 2;
  rctx.setLineDash([8, 12]);
  rctx.beginPath(); rctx.moveTo(64, 0); rctx.lineTo(64, 128); rctx.stroke();
  const roadTex = new THREE.CanvasTexture(roadCanvas);
  roadTex.wrapS = roadTex.wrapT = THREE.RepeatWrapping;
  roadTex.repeat.set(20, 1);

  const roadMat = new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.85 });
  const road1 = new THREE.Mesh(new THREE.BoxGeometry(200, 0.05, 6), roadMat);
  road1.position.set(0, 0.02, 15);
  scene.add(road1);

  const roadMat2 = roadMat.clone();
  roadMat2.map = roadTex.clone();
  roadMat2.map.rotation = Math.PI / 2;
  roadMat2.map.repeat.set(1, 20);
  const road2 = new THREE.Mesh(new THREE.BoxGeometry(6, 0.05, 200), roadMat2);
  road2.position.set(0, 0.02, 0);
  scene.add(road2);
}

// --- Enhanced Buildings ---
function createBuilding(loc, id) {
  const group = new THREE.Group();
  group.userData.locationId = id;

  // Main body (back + sides, slightly shorter in Z to make room for separate front wall)
  const bodyGeo = new THREE.BoxGeometry(loc.w, loc.h, loc.d - 0.3);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: loc.color, roughness: 0.6, metalness: 0.1,
    transparent: true, opacity: 1.0,
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.set(loc.x, loc.h / 2, loc.z - 0.15);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // Separate front wall (fades independently for interior reveal)
  const frontWallGeo = new THREE.BoxGeometry(loc.w, loc.h, 0.3);
  const frontWallMat = new THREE.MeshStandardMaterial({
    color: loc.color, roughness: 0.6, metalness: 0.1,
    transparent: true, opacity: 1.0,
  });
  const frontWall = new THREE.Mesh(frontWallGeo, frontWallMat);
  frontWall.position.set(loc.x, loc.h / 2, loc.z + loc.d / 2 - 0.15);
  frontWall.castShadow = true;
  group.add(frontWall);

  // Roof
  const roofGeo = new THREE.BoxGeometry(loc.w + 2, 0.6, loc.d + 2);
  const roofMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(loc.color).multiplyScalar(0.7), roughness: 0.4, metalness: 0.3,
    transparent: true, opacity: 1.0,
  });
  const roof = new THREE.Mesh(roofGeo, roofMat);
  roof.position.set(loc.x, loc.h + 0.3, loc.z);
  roof.castShadow = true;
  group.add(roof);

  // Glowing edges
  const edgesGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(loc.w, loc.h, loc.d));
  const edgesMat = new THREE.LineBasicMaterial({ color: loc.color, transparent: true, opacity: 0.4 });
  const edges = new THREE.LineSegments(edgesGeo, edgesMat);
  edges.position.set(loc.x, loc.h / 2, loc.z);
  group.add(edges);

  // Track front windows for transparency
  const frontWindows = [];

  // Windows with individual materials for flicker
  const cols = Math.max(1, Math.floor(loc.w / 5));
  const rows = Math.max(1, Math.floor(loc.h / 4));
  const startX = loc.x - (cols - 1) * 2.5;
  const windowGeo = new THREE.PlaneGeometry(1.2, 1.5);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // Front window
      const wMat = new THREE.MeshStandardMaterial({
        color: 0xffeeaa, emissive: 0xffdd44, emissiveIntensity: 0.3,
        transparent: true, opacity: 0.8,
      });
      const win = new THREE.Mesh(windowGeo, wMat);
      win.position.set(startX + c * 5, 2.5 + r * 3.5, loc.z + loc.d / 2 + 0.05);
      win.userData.flickerPhase = Math.random() * Math.PI * 2;
      win.userData.isFrontWindow = true;
      group.add(win);
      windowMeshes.push(win);
      frontWindows.push(win);

      // Back window
      const wMatBack = wMat.clone();
      const winBack = new THREE.Mesh(windowGeo, wMatBack);
      winBack.position.set(startX + c * 5, 2.5 + r * 3.5, loc.z - loc.d / 2 - 0.05);
      winBack.rotation.y = Math.PI;
      winBack.userData.flickerPhase = Math.random() * Math.PI * 2;
      group.add(winBack);
      windowMeshes.push(winBack);
    }
  }

  // Door (on front wall)
  const doorGeo = new THREE.PlaneGeometry(2.5, 3.5);
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, transparent: true, opacity: 1.0 });
  const door = new THREE.Mesh(doorGeo, doorMat);
  door.position.set(loc.x, 1.75, loc.z + loc.d / 2 + 0.06);
  group.add(door);

  // Label
  const labelCanvas = document.createElement('canvas');
  labelCanvas.width = 256;
  labelCanvas.height = 64;
  const ctx = labelCanvas.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.roundRect(10, 4, 236, 56, 8);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 24px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(loc.name, 128, 42);
  const labelTexture = new THREE.CanvasTexture(labelCanvas);
  const labelMat = new THREE.SpriteMaterial({ map: labelTexture, transparent: true, opacity: 0.9 });
  const label = new THREE.Sprite(labelMat);
  label.position.set(loc.x, loc.h + 3, loc.z);
  label.scale.set(12, 3, 1);
  group.add(label);

  // Building glow light
  const glowLight = new THREE.PointLight(loc.color, 0.4, 25);
  glowLight.position.set(loc.x, 2, loc.z + loc.d / 2 + 2);
  group.add(glowLight);

  // Store references for transparency system
  buildingParts[id] = { body, bodyMat, roof, roofMat, frontWall, frontWallMat, edges, edgesMat, frontWindows, door, doorMat };

  // Create interior (starts hidden)
  createInterior(loc, id, group);

  return group;
}

// --- Building Interiors ---
function createInterior(loc, id, parentGroup) {
  const interior = new THREE.Group();
  interior.visible = false;

  // Floor
  const floorGeo = new THREE.PlaneGeometry(loc.w - 1, loc.d - 1);
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.8 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(loc.x, 0.15, loc.z);
  interior.add(floor);

  // Interior light
  const intLight = new THREE.PointLight(0xffeecc, 0.3, loc.w);
  intLight.position.set(loc.x, loc.h * 0.6, loc.z);
  interior.add(intLight);

  switch (id) {
    case 'arena': {
      // Fighting ring platform
      const ringGeo = new THREE.CylinderGeometry(6, 6, 0.3, 24);
      const ringMat = new THREE.MeshStandardMaterial({ color: 0x884444, roughness: 0.7 });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.set(loc.x, 0.3, loc.z);
      interior.add(ring);

      // Ring ropes
      for (const h of [1.5, 2.5, 3.5]) {
        const rope = new THREE.Mesh(
          new THREE.TorusGeometry(6.5, 0.08, 6, 32),
          new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.3 })
        );
        rope.position.set(loc.x, h, loc.z);
        rope.rotation.x = Math.PI / 2;
        interior.add(rope);
      }

      // Corner posts
      for (const [cx, cz] of [[1,1],[1,-1],[-1,1],[-1,-1]]) {
        const post = new THREE.Mesh(
          new THREE.CylinderGeometry(0.15, 0.15, 4, 6),
          new THREE.MeshStandardMaterial({ color: 0x888888 })
        );
        post.position.set(loc.x + cx * 6.5, 2, loc.z + cz * 6.5);
        interior.add(post);
      }

      // Benches along 3 walls
      for (const [sx, sz, bw, bd] of [[0, -1, loc.w - 4, 2], [-1, 0, 2, loc.d - 4], [1, 0, 2, loc.d - 4]]) {
        const bench = new THREE.Mesh(
          new THREE.BoxGeometry(bw, 0.8, bd),
          new THREE.MeshStandardMaterial({ color: 0x5c3d2e, roughness: 0.8 })
        );
        bench.position.set(loc.x + sx * (loc.w / 2 - 1.5), 0.5, loc.z + sz * (loc.d / 2 - 1.5));
        interior.add(bench);
      }
      break;
    }

    case 'shop': {
      // Shelves along left and right walls
      for (const xOff of [-1, 1]) {
        const shelf = new THREE.Mesh(
          new THREE.BoxGeometry(1.5, 4, loc.d - 2),
          new THREE.MeshStandardMaterial({ color: 0x6b4c2a, roughness: 0.8 })
        );
        shelf.position.set(loc.x + xOff * (loc.w / 2 - 1.2), 2, loc.z);
        interior.add(shelf);

        // Shelf items (small colored boxes)
        for (let s = 0; s < 3; s++) {
          const item = new THREE.Mesh(
            new THREE.BoxGeometry(0.4, 0.4, 0.4),
            new THREE.MeshStandardMaterial({ color: [0x44aa44, 0xaa4444, 0x4444aa][s] })
          );
          item.position.set(loc.x + xOff * (loc.w / 2 - 1.2), 1 + s * 1.5, loc.z - 2 + s * 2);
          interior.add(item);
        }
      }

      // Counter near front
      const counter = new THREE.Mesh(
        new THREE.BoxGeometry(loc.w - 4, 1.5, 1.5),
        new THREE.MeshStandardMaterial({ color: 0x5a3a1a, roughness: 0.7 })
      );
      counter.position.set(loc.x, 0.75, loc.z + loc.d / 2 - 3);
      interior.add(counter);

      // Cash register on counter
      const register = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 0.5, 0.5),
        new THREE.MeshStandardMaterial({ color: 0x333333 })
      );
      register.position.set(loc.x, 1.75, loc.z + loc.d / 2 - 3);
      interior.add(register);
      break;
    }

    case 'social': {
      // Two couches
      for (const xOff of [-3, 3]) {
        const seat = new THREE.Mesh(
          new THREE.BoxGeometry(4, 1, 2),
          new THREE.MeshStandardMaterial({ color: 0x4444aa, roughness: 0.7 })
        );
        seat.position.set(loc.x + xOff, 0.5, loc.z);
        interior.add(seat);

        const back = new THREE.Mesh(
          new THREE.BoxGeometry(4, 1.5, 0.5),
          new THREE.MeshStandardMaterial({ color: 0x3333aa, roughness: 0.7 })
        );
        back.position.set(loc.x + xOff, 1.0, loc.z - 1);
        interior.add(back);
      }

      // Coffee table in center
      const table = new THREE.Mesh(
        new THREE.BoxGeometry(2.5, 0.6, 1.5),
        new THREE.MeshStandardMaterial({ color: 0x5c3d2e, roughness: 0.7 })
      );
      table.position.set(loc.x, 0.3, loc.z);
      interior.add(table);

      // TV/screen on back wall
      const screen = new THREE.Mesh(
        new THREE.BoxGeometry(3, 2, 0.1),
        new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x2244aa, emissiveIntensity: 0.2 })
      );
      screen.position.set(loc.x, 3, loc.z - loc.d / 2 + 0.5);
      interior.add(screen);
      break;
    }

    case 'cafe': {
      // 4 small tables with chairs
      const tablePositions = [[-2, -2], [2, -2], [-2, 2], [2, 2]];
      for (const [tx, tz] of tablePositions) {
        // Table
        const tbl = new THREE.Mesh(
          new THREE.CylinderGeometry(0.7, 0.7, 0.8, 8),
          new THREE.MeshStandardMaterial({ color: 0x8b6914, roughness: 0.6 })
        );
        tbl.position.set(loc.x + tx, 0.5, loc.z + tz);
        interior.add(tbl);

        // Table leg
        const leg = new THREE.Mesh(
          new THREE.CylinderGeometry(0.08, 0.08, 0.8, 4),
          new THREE.MeshStandardMaterial({ color: 0x444444 })
        );
        leg.position.set(loc.x + tx, 0.4, loc.z + tz);
        interior.add(leg);

        // 2 chairs per table
        for (const cOff of [-1, 1]) {
          const chair = new THREE.Mesh(
            new THREE.BoxGeometry(0.5, 0.6, 0.5),
            new THREE.MeshStandardMaterial({ color: 0x5c3d2e, roughness: 0.8 })
          );
          chair.position.set(loc.x + tx + cOff * 0.9, 0.3, loc.z + tz);
          interior.add(chair);
        }
      }

      // Bar counter along back wall
      const bar = new THREE.Mesh(
        new THREE.BoxGeometry(loc.w - 2, 1.5, 1),
        new THREE.MeshStandardMaterial({ color: 0x5a3a1a, roughness: 0.7 })
      );
      bar.position.set(loc.x, 0.75, loc.z - loc.d / 2 + 1.5);
      interior.add(bar);

      // Bottles on bar
      for (let b = 0; b < 4; b++) {
        const bottle = new THREE.Mesh(
          new THREE.CylinderGeometry(0.08, 0.08, 0.5, 4),
          new THREE.MeshStandardMaterial({ color: [0x44aa44, 0xaa4444, 0xaaaa44, 0x4444aa][b] })
        );
        bottle.position.set(loc.x - 1.5 + b, 1.75, loc.z - loc.d / 2 + 1.5);
        interior.add(bottle);
      }
      break;
    }

    case 'gym': {
      // 2 punching bags hanging from ceiling
      for (const xOff of [-3, 3]) {
        // Chain
        const chain = new THREE.Mesh(
          new THREE.CylinderGeometry(0.05, 0.05, 2, 4),
          new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.3 })
        );
        chain.position.set(loc.x + xOff, loc.h - 2, loc.z);
        interior.add(chain);

        // Bag
        const bag = new THREE.Mesh(
          new THREE.CylinderGeometry(0.5, 0.45, 2.5, 8),
          new THREE.MeshStandardMaterial({ color: 0xaa3333, roughness: 0.7 })
        );
        bag.position.set(loc.x + xOff, loc.h - 4.5, loc.z);
        interior.add(bag);
      }

      // Weight bench
      const benchSeat = new THREE.Mesh(
        new THREE.BoxGeometry(1, 0.3, 3),
        new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.6 })
      );
      benchSeat.position.set(loc.x, 0.6, loc.z + 2);
      interior.add(benchSeat);

      // Bench legs
      for (const [lx, lz] of [[-0.4, 1], [0.4, 1], [-0.4, 3], [0.4, 3]]) {
        const leg = new THREE.Mesh(
          new THREE.CylinderGeometry(0.05, 0.05, 0.6, 4),
          new THREE.MeshStandardMaterial({ color: 0x666666 })
        );
        leg.position.set(loc.x + lx, 0.3, loc.z + lz);
        interior.add(leg);
      }

      // Barbell across bench
      const barbell = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.06, 3, 6),
        new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.3 })
      );
      barbell.position.set(loc.x, 1.5, loc.z + 2);
      barbell.rotation.z = Math.PI / 2;
      interior.add(barbell);

      // Weight plates
      for (const xOff of [-1.4, 1.4]) {
        const plate = new THREE.Mesh(
          new THREE.CylinderGeometry(0.4, 0.4, 0.15, 8),
          new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5 })
        );
        plate.position.set(loc.x + xOff, 1.5, loc.z + 2);
        plate.rotation.z = Math.PI / 2;
        interior.add(plate);
      }

      // Dumbbell rack along wall
      const rack = new THREE.Mesh(
        new THREE.BoxGeometry(loc.w - 4, 1.2, 0.8),
        new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.6 })
      );
      rack.position.set(loc.x, 0.6, loc.z - loc.d / 2 + 1.5);
      interior.add(rack);
      break;
    }
  }

  parentGroup.add(interior);
  buildingInteriors[id] = interior;
}

// --- Decorations ---
function addDecorations(scene) {
  const lampGeo = new THREE.CylinderGeometry(0.15, 0.15, 6, 6);
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x666666 });
  const bulbGeo = new THREE.SphereGeometry(0.4, 8, 8);

  for (let i = -80; i <= 80; i += 20) {
    const lamp = new THREE.Mesh(lampGeo, lampMat);
    lamp.position.set(i, 3, 20);
    scene.add(lamp);

    // Individual bulb material for flicker
    const bulbMat = new THREE.MeshStandardMaterial({
      color: 0xffdd44, emissive: 0xffdd44, emissiveIntensity: 0.5,
    });
    const bulb = new THREE.Mesh(bulbGeo, bulbMat);
    bulb.position.set(i, 6.2, 20);
    scene.add(bulb);
    lampBulbs.push(bulb);

    const light = new THREE.PointLight(0xffdd44, 0.3, 15);
    light.position.set(i, 6, 20);
    scene.add(light);
  }

  // Trees
  const trunkGeo = new THREE.CylinderGeometry(0.3, 0.4, 3, 6);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c3d2e });
  const leafGeo = new THREE.ConeGeometry(2, 4, 6);
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2d5a27 });

  const treePositions = [
    [-60, -20], [-60, 20], [60, -20], [60, 20],
    [-30, -25], [30, -25], [-15, 45], [15, 45],
    [50, 30], [-50, 30], [70, -10], [-70, -10],
    [-80, 40], [80, 40], [-10, -40], [10, -40],
    [35, 45], [-35, 45], [65, 25], [-65, 25],
  ];

  for (const [x, z] of treePositions) {
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.set(x, 1.5, z);
    trunk.castShadow = true;
    scene.add(trunk);

    const leaves = new THREE.Mesh(leafGeo, leafMat.clone());
    leaves.position.set(x, 5, z);
    leaves.castShadow = true;
    leaves.userData.phase = Math.random() * Math.PI * 2;
    scene.add(leaves);
    decorations.push(leaves);
  }
}

// --- World Props ---
function addWorldProps(scene) {
  const benchGeo = new THREE.BoxGeometry(3, 0.5, 1);
  const benchMat = new THREE.MeshStandardMaterial({ color: 0x5c3d2e });
  const benchLegGeo = new THREE.BoxGeometry(0.2, 0.5, 0.8);

  const benchPositions = [[-12, 16], [12, 16], [30, 16], [-30, 16], [0, -8], [0, 38]];
  for (const [x, z] of benchPositions) {
    const bench = new THREE.Mesh(benchGeo, benchMat);
    bench.position.set(x, 0.5, z);
    bench.castShadow = true;
    scene.add(bench);
    for (const ox of [-1.2, 1.2]) {
      const leg = new THREE.Mesh(benchLegGeo, benchMat);
      leg.position.set(x + ox, 0.25, z);
      scene.add(leg);
    }
  }

  // Market stalls
  const stallMat = new THREE.MeshStandardMaterial({ color: 0x44aa44, transparent: true, opacity: 0.7 });
  for (let i = 0; i < 3; i++) {
    const stall = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 3), stallMat);
    stall.position.set(40 + (i - 1) * 6, 1.5, -8);
    stall.castShadow = true;
    scene.add(stall);
    const awning = new THREE.Mesh(
      new THREE.BoxGeometry(4.5, 0.15, 4),
      new THREE.MeshStandardMaterial({ color: [0xff6b35, 0xffdd44, 0x44ffaa][i] })
    );
    awning.position.set(40 + (i - 1) * 6, 3.1, -8);
    scene.add(awning);
  }

  // Training dummies
  const dummyBodyGeo = new THREE.CylinderGeometry(0.4, 0.4, 2, 8);
  const dummyMat = new THREE.MeshStandardMaterial({ color: 0x8b6914 });
  const dummyHeadGeo = new THREE.SphereGeometry(0.35, 8, 8);
  for (let i = 0; i < 3; i++) {
    const body = new THREE.Mesh(dummyBodyGeo, dummyMat);
    body.position.set(-20 + (i - 1) * 4, 1.5, 38);
    scene.add(body);
    const head = new THREE.Mesh(dummyHeadGeo, dummyMat);
    head.position.set(-20 + (i - 1) * 4, 2.8, 38);
    scene.add(head);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 3, 6), dummyMat);
    post.position.set(-20 + (i - 1) * 4, 1.5, 38);
    scene.add(post);
  }
}

// --- Arena Embers (doubled to 80) ---
function createArenaEmbers(scene) {
  const count = 80;
  const positions = new Float32Array(count * 3);
  const velocities = [];
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 26;
    positions[i * 3 + 1] = Math.random() * 16;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 26;
    velocities.push({
      vx: (Math.random() - 0.5) * 0.03,
      vy: 0.02 + Math.random() * 0.04,
      vz: (Math.random() - 0.5) * 0.03,
    });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xff4400, size: 0.4, transparent: true, opacity: 0.6, sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  scene.add(points);
  particles.embers = { points, velocities };
}

// --- Shop Sparkles ---
function createShopSparkles(scene) {
  const count = 25;
  const positions = new Float32Array(count * 3);
  const velocities = [];
  for (let i = 0; i < count; i++) {
    positions[i * 3] = 40 + (Math.random() - 0.5) * 18;
    positions[i * 3 + 1] = Math.random() * 10;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 14;
    velocities.push({
      vx: (Math.random() - 0.5) * 0.01,
      vy: -0.01 - Math.random() * 0.02,
      vz: (Math.random() - 0.5) * 0.01,
    });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xffdd44, size: 0.3, transparent: true, opacity: 0.5,
  });
  const points = new THREE.Points(geo, mat);
  scene.add(points);
  particles.sparkles = { points, velocities };
}

// --- Social Hub Fireflies ---
function createFireflies(scene) {
  const count = 20;
  const positions = new Float32Array(count * 3);
  const phases = [];
  for (let i = 0; i < count; i++) {
    positions[i * 3] = -40 + (Math.random() - 0.5) * 20;
    positions[i * 3 + 1] = 1 + Math.random() * 5;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 20;
    phases.push(Math.random() * Math.PI * 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xaaff44, size: 0.35, transparent: true, opacity: 0.6,
  });
  const points = new THREE.Points(geo, mat);
  scene.add(points);
  particles.fireflies = { points, phases };
}

// --- Fountain Splash Particles ---
function createFountainSplash(scene) {
  const count = 15;
  const positions = new Float32Array(count * 3);
  const velocities = [];
  for (let i = 0; i < count; i++) {
    positions[i * 3] = -40 + (Math.random() - 0.5) * 1;
    positions[i * 3 + 1] = 2 + Math.random() * 2;
    positions[i * 3 + 2] = -10 + (Math.random() - 0.5) * 1;
    velocities.push({
      vx: (Math.random() - 0.5) * 0.04,
      vy: 0.03 + Math.random() * 0.04,
      vz: (Math.random() - 0.5) * 0.04,
      gravity: -0.002,
    });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0x88bbff, size: 0.2, transparent: true, opacity: 0.5,
  });
  const points = new THREE.Points(geo, mat);
  scene.add(points);
  particles.fountainSplash = { points, velocities };
}

// --- Gym Energy Sparks ---
function createGymSparks(scene) {
  const count = 15;
  const positions = new Float32Array(count * 3);
  const velocities = [];
  for (let i = 0; i < count; i++) {
    positions[i * 3] = -20 + (Math.random() - 0.5) * 16;
    positions[i * 3 + 1] = Math.random() * 10;
    positions[i * 3 + 2] = 30 + (Math.random() - 0.5) * 16;
    velocities.push({
      vx: (Math.random() - 0.5) * 0.02,
      vy: 0.04 + Math.random() * 0.05,
      vz: (Math.random() - 0.5) * 0.02,
    });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xaa44ff, size: 0.3, transparent: true, opacity: 0.5,
  });
  const points = new THREE.Points(geo, mat);
  scene.add(points);
  particles.gymSparks = { points, velocities };
}

// --- Arena Flames ---
function createArenaFlames(scene) {
  const flameGeo = new THREE.ConeGeometry(0.6, 2.5, 6);
  const flameMat = new THREE.MeshStandardMaterial({
    color: 0xff4400, emissive: 0xff2200, emissiveIntensity: 0.6,
    transparent: true, opacity: 0.85,
  });
  for (const xOff of [-12, 12]) {
    const flame = new THREE.Mesh(flameGeo, flameMat.clone());
    flame.position.set(xOff, 1.5, 11);
    scene.add(flame);
    flames.push(flame);

    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(0.8, 1, 1, 8),
      new THREE.MeshStandardMaterial({ color: 0x444444 })
    );
    pedestal.position.set(xOff, 0.5, 11);
    scene.add(pedestal);

    const light = new THREE.PointLight(0xff4400, 0.6, 15);
    light.position.set(xOff, 3, 11);
    scene.add(light);
  }
}

// --- Fountain ---
function createFountain(scene) {
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(3, 3.5, 1, 16),
    new THREE.MeshStandardMaterial({ color: 0x556677 })
  );
  base.position.set(-40, 0.5, -10);
  scene.add(base);

  const water = new THREE.Mesh(
    new THREE.TorusGeometry(2, 0.5, 8, 24),
    new THREE.MeshStandardMaterial({
      color: 0x4488ff, emissive: 0x2244aa, emissiveIntensity: 0.2,
      transparent: true, opacity: 0.7,
    })
  );
  water.position.set(-40, 1.2, -10);
  water.rotation.x = -Math.PI / 2;
  scene.add(water);
  fountainParts.push(water);

  const spout = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.2, 2, 8),
    new THREE.MeshStandardMaterial({ color: 0x556677 })
  );
  spout.position.set(-40, 2, -10);
  scene.add(spout);

  const waterLight = new THREE.PointLight(0x4488ff, 0.3, 10);
  waterLight.position.set(-40, 2, -10);
  scene.add(waterLight);
}

// ===== ANIMATION =====
export function updateWorld(elapsed) {
  // Star twinkle
  if (starPoints) {
    starPoints.material.uniforms.time.value = elapsed;
  }

  // Tree sway (enhanced)
  for (const tree of decorations) {
    const phase = tree.userData.phase || 0;
    tree.rotation.z = Math.sin(elapsed * 0.6 + phase + tree.position.x * 0.1) * 0.06;
    // Leaf scale pulse (rustle)
    const rustle = 1 + Math.sin(elapsed * 2.5 + phase) * 0.03;
    tree.scale.set(rustle, 1, rustle);
  }

  // Lamp bulb flicker
  for (const bulb of lampBulbs) {
    bulb.material.emissiveIntensity = 0.4 + Math.sin(elapsed * 12 + bulb.position.x * 0.5) * 0.15;
  }

  // Window flicker
  for (const win of windowMeshes) {
    const phase = win.userData.flickerPhase || 0;
    win.material.emissiveIntensity = 0.25 + Math.sin(elapsed * 1.8 + phase) * 0.12 +
      Math.sin(elapsed * 4.3 + phase * 2) * 0.05;
  }

  // Arena embers
  if (particles.embers) {
    const pos = particles.embers.points.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const vel = particles.embers.velocities[i];
      pos.array[i * 3] += vel.vx;
      pos.array[i * 3 + 1] += vel.vy;
      pos.array[i * 3 + 2] += vel.vz;
      if (pos.array[i * 3 + 1] > 17) {
        pos.array[i * 3] = (Math.random() - 0.5) * 26;
        pos.array[i * 3 + 1] = 0;
        pos.array[i * 3 + 2] = (Math.random() - 0.5) * 26;
      }
    }
    pos.needsUpdate = true;
    particles.embers.points.material.opacity = 0.5 + Math.sin(elapsed * 3) * 0.15;
  }

  // Shop sparkles
  if (particles.sparkles) {
    const pos = particles.sparkles.points.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const vel = particles.sparkles.velocities[i];
      pos.array[i * 3] += vel.vx;
      pos.array[i * 3 + 1] += vel.vy;
      pos.array[i * 3 + 2] += vel.vz;
      if (pos.array[i * 3 + 1] < 0) {
        pos.array[i * 3] = 40 + (Math.random() - 0.5) * 18;
        pos.array[i * 3 + 1] = 10;
        pos.array[i * 3 + 2] = (Math.random() - 0.5) * 14;
      }
    }
    pos.needsUpdate = true;
    particles.sparkles.points.material.opacity = 0.3 + Math.sin(elapsed * 2) * 0.2;
  }

  // Fireflies (drift + bob + opacity pulse)
  if (particles.fireflies) {
    const pos = particles.fireflies.points.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const phase = particles.fireflies.phases[i];
      pos.array[i * 3] += Math.sin(elapsed * 0.3 + phase) * 0.01;
      pos.array[i * 3 + 1] = 1.5 + Math.sin(elapsed * 0.5 + phase) * 1.5 + Math.sin(elapsed * 1.2 + phase * 2) * 0.5;
      pos.array[i * 3 + 2] += Math.cos(elapsed * 0.25 + phase) * 0.01;
    }
    pos.needsUpdate = true;
    particles.fireflies.points.material.opacity = 0.4 + Math.sin(elapsed * 1.5) * 0.25;
  }

  // Fountain splash
  if (particles.fountainSplash) {
    const pos = particles.fountainSplash.points.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const vel = particles.fountainSplash.velocities[i];
      pos.array[i * 3] += vel.vx;
      vel.vy += vel.gravity;
      pos.array[i * 3 + 1] += vel.vy;
      pos.array[i * 3 + 2] += vel.vz;
      if (pos.array[i * 3 + 1] < 1) {
        pos.array[i * 3] = -40 + (Math.random() - 0.5) * 0.5;
        pos.array[i * 3 + 1] = 3;
        pos.array[i * 3 + 2] = -10 + (Math.random() - 0.5) * 0.5;
        vel.vx = (Math.random() - 0.5) * 0.04;
        vel.vy = 0.03 + Math.random() * 0.04;
        vel.vz = (Math.random() - 0.5) * 0.04;
      }
    }
    pos.needsUpdate = true;
  }

  // Gym sparks
  if (particles.gymSparks) {
    const pos = particles.gymSparks.points.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const vel = particles.gymSparks.velocities[i];
      pos.array[i * 3] += vel.vx;
      pos.array[i * 3 + 1] += vel.vy;
      pos.array[i * 3 + 2] += vel.vz;
      if (pos.array[i * 3 + 1] > 12) {
        pos.array[i * 3] = -20 + (Math.random() - 0.5) * 16;
        pos.array[i * 3 + 1] = 0;
        pos.array[i * 3 + 2] = 30 + (Math.random() - 0.5) * 16;
      }
    }
    pos.needsUpdate = true;
    particles.gymSparks.points.material.opacity = 0.35 + Math.sin(elapsed * 4) * 0.2;
  }

  // Flame flicker
  for (const flame of flames) {
    flame.scale.y = 1 + Math.sin(elapsed * 6 + flame.position.x * 2) * 0.25;
    flame.scale.x = 1 + Math.sin(elapsed * 5 + flame.position.z) * 0.1;
    flame.material.emissiveIntensity = 0.5 + Math.sin(elapsed * 8) * 0.15;
  }

  // Fountain water rotation + bob
  for (const part of fountainParts) {
    part.rotation.z += 0.005;
    part.position.y = 1.2 + Math.sin(elapsed * 1.5) * 0.05;
  }

  // Pulse lights decay
  for (let i = pulseLights.length - 1; i >= 0; i--) {
    const pl = pulseLights[i];
    const t = (performance.now() - pl.start) / pl.duration;
    if (t >= 1) {
      _scene.remove(pl.light);
      pl.light.dispose();
      pulseLights.splice(i, 1);
    } else {
      pl.light.intensity = pl.maxIntensity * (1 - t);
    }
  }

  // Structure animations (banner wave, training post spin)
  for (const [, group] of structureMeshes) {
    if (group.userData.structureType === 'banner' && group.userData.flag) {
      group.userData.flag.rotation.y = Math.sin(elapsed * 2 + group.position.x) * 0.15;
    }
    if (group.userData.structureType === 'training_post' && group.userData.rings) {
      group.userData.rings.rotation.y = elapsed * 2;
    }
  }

  // Territory overlay pulse
  for (const [, mesh] of territoryMeshes) {
    mesh.material.opacity = 0.1 + Math.sin(elapsed * 1.5) * 0.05;
  }
}

// ===== DYNAMIC EVENT LIGHT PULSES =====
export function pulseLocation(locationId, color, duration = 1500) {
  if (!_scene) return;
  const loc = LOCATIONS[locationId];
  if (!loc) return;

  const light = new THREE.PointLight(color, 2.0, 40);
  light.position.set(loc.x, loc.h + 3, loc.z);
  _scene.add(light);
  pulseLights.push({ light, start: performance.now(), duration, maxIntensity: 2.0 });
}

// ===== AGENT-BUILT STRUCTURES =====
export function updateStructures(structures) {
  if (!_scene) return;
  const activeIds = new Set();

  for (const s of structures) {
    activeIds.add(s.id);
    if (structureMeshes.has(s.id)) {
      // Update health visual
      const group = structureMeshes.get(s.id);
      if (s.health < 30) {
        group.traverse(child => {
          if (child.material) {
            child.material.opacity = 0.4;
            child.material.transparent = true;
          }
        });
      }
      continue;
    }

    // Create new structure 3D
    const loc = LOCATIONS[s.location];
    if (!loc) continue;

    const group = new THREE.Group();
    group.userData.structureType = s.type;
    const color = new THREE.Color(s.color || '#ff6b35');

    switch (s.type) {
      case 'banner': {
        // Pole
        const pole = new THREE.Mesh(
          new THREE.CylinderGeometry(0.08, 0.08, 5, 6),
          new THREE.MeshStandardMaterial({ color: 0x888888 })
        );
        pole.position.y = 2.5;
        group.add(pole);
        // Flag
        const flag = new THREE.Mesh(
          new THREE.PlaneGeometry(2, 1.2),
          new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.15, side: THREE.DoubleSide })
        );
        flag.position.set(1, 4.2, 0);
        group.add(flag);
        group.userData.flag = flag;
        break;
      }
      case 'statue': {
        // Pedestal
        const ped = new THREE.Mesh(
          new THREE.CylinderGeometry(0.8, 1, 1.5, 8),
          new THREE.MeshStandardMaterial({ color: 0x666666 })
        );
        ped.position.y = 0.75;
        group.add(ped);
        // Body
        const body = new THREE.Mesh(
          new THREE.CapsuleGeometry(0.5, 1, 4, 8),
          new THREE.MeshStandardMaterial({ color, metalness: 0.5, roughness: 0.3 })
        );
        body.position.y = 2.5;
        group.add(body);
        // Head
        const head = new THREE.Mesh(
          new THREE.SphereGeometry(0.35, 8, 8),
          new THREE.MeshStandardMaterial({ color: 0xddccaa, metalness: 0.3 })
        );
        head.position.y = 3.8;
        group.add(head);
        break;
      }
      case 'vendor_stall': {
        const table = new THREE.Mesh(
          new THREE.BoxGeometry(2.5, 0.15, 1.5),
          new THREE.MeshStandardMaterial({ color: 0x8b6914 })
        );
        table.position.y = 1.2;
        group.add(table);
        const awning = new THREE.Mesh(
          new THREE.BoxGeometry(3, 0.1, 2),
          new THREE.MeshStandardMaterial({ color })
        );
        awning.position.y = 2.5;
        group.add(awning);
        // Legs
        for (const ox of [-1, 1]) {
          for (const oz of [-0.5, 0.5]) {
            const leg = new THREE.Mesh(
              new THREE.CylinderGeometry(0.05, 0.05, 1.2, 4),
              new THREE.MeshStandardMaterial({ color: 0x8b6914 })
            );
            leg.position.set(ox, 0.6, oz);
            group.add(leg);
          }
        }
        break;
      }
      case 'training_post': {
        const post = new THREE.Mesh(
          new THREE.CylinderGeometry(0.15, 0.15, 4, 8),
          new THREE.MeshStandardMaterial({ color: 0x666666 })
        );
        post.position.y = 2;
        group.add(post);
        const rings = new THREE.Mesh(
          new THREE.TorusGeometry(0.6, 0.08, 6, 16),
          new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.2 })
        );
        rings.position.y = 3.5;
        group.add(rings);
        group.userData.rings = rings;
        break;
      }
      case 'graffiti_wall': {
        const wallCanvas = document.createElement('canvas');
        wallCanvas.width = 128;
        wallCanvas.height = 64;
        const ctx = wallCanvas.getContext('2d');
        ctx.fillStyle = '#333';
        ctx.fillRect(0, 0, 128, 64);
        // Random colored splashes
        const colors = ['#ff4444', '#44ff44', '#4444ff', '#ffff44', '#ff44ff', '#44ffff'];
        for (let i = 0; i < 12; i++) {
          ctx.fillStyle = colors[Math.floor(Math.random() * colors.length)];
          ctx.fillRect(Math.random() * 108, Math.random() * 44, 10 + Math.random() * 20, 5 + Math.random() * 15);
        }
        const tex = new THREE.CanvasTexture(wallCanvas);
        const wall = new THREE.Mesh(
          new THREE.PlaneGeometry(3, 1.5),
          new THREE.MeshStandardMaterial({ map: tex, emissive: 0x222222, emissiveIntensity: 0.1 })
        );
        wall.position.y = 1.5;
        group.add(wall);
        break;
      }
    }

    group.position.set(loc.x + (s.x || 0), 0, loc.z + (s.z || 0));
    _scene.add(group);
    structureMeshes.set(s.id, group);
  }

  // Remove structures no longer present
  for (const [id, group] of structureMeshes) {
    if (!activeIds.has(id)) {
      _scene.remove(group);
      group.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (child.material.map) child.material.map.dispose();
          child.material.dispose();
        }
      });
      structureMeshes.delete(id);
    }
  }
}

// ===== TERRITORY OVERLAYS =====
export function updateTerritories(territories) {
  if (!_scene) return;
  const activeIds = new Set();

  for (const t of territories) {
    activeIds.add(t.id);
    if (territoryMeshes.has(t.id)) continue;

    const loc = LOCATIONS[t.location];
    if (!loc) continue;

    // Get crew color from territory data
    const crewColor = new THREE.Color(t.color || '#ff6b35');

    const overlay = new THREE.Mesh(
      new THREE.PlaneGeometry(loc.w + 6, loc.d + 6),
      new THREE.MeshBasicMaterial({
        color: crewColor,
        transparent: true,
        opacity: 0.12,
        side: THREE.DoubleSide,
      })
    );
    overlay.rotation.x = -Math.PI / 2;
    overlay.position.set(loc.x, 0.08, loc.z);
    _scene.add(overlay);
    territoryMeshes.set(t.id, overlay);
  }

  // Remove expired
  for (const [id, mesh] of territoryMeshes) {
    if (!activeIds.has(id)) {
      _scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
      territoryMeshes.delete(id);
    }
  }
}

// ===== LOCATION HEAT GLOW =====
export function updateLocationHeat(agents) {
  if (!agents) return;

  // Count agents per location
  const counts = {};
  for (const a of agents) {
    const loc = a.current_location;
    if (loc && loc !== 'traveling' && LOCATIONS[loc]) {
      counts[loc] = (counts[loc] || 0) + 1;
    }
  }

  // Max count for normalization
  const maxCount = Math.max(1, ...Object.values(counts));

  for (const [id, light] of Object.entries(heatLights)) {
    const count = counts[id] || 0;
    const intensity = (count / maxCount) * 0.6;
    light.intensity += (intensity - light.intensity) * 0.1; // smooth lerp
  }
}

// --- Building Transparency Update ---
export function updateBuildingTransparency(camera, controls) {
  const zoomLevel = camera.zoom;
  const tx = controls.target.x;
  const tz = controls.target.z;

  for (const [id, loc] of Object.entries(LOCATIONS)) {
    const parts = buildingParts[id];
    const interior = buildingInteriors[id];
    if (!parts || !interior) continue;

    // Distance from camera target to building center
    const dx = tx - loc.x;
    const dz = tz - loc.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    // Should we reveal this building's interior?
    const maxDist = Math.max(loc.w, loc.d) * 0.75;
    const isNearBuilding = dist < maxDist;
    const isZoomedIn = zoomLevel > 4;
    const shouldReveal = isNearBuilding && isZoomedIn;

    // Calculate target opacity
    let targetOpacity = 1.0;
    if (shouldReveal) {
      targetOpacity = Math.max(0.05, 1 - (zoomLevel - 3.5) / 1.5);
    }

    // Lerp current opacity for smooth transitions
    const currentOpacity = parts.roofMat.opacity;
    const newOpacity = currentOpacity + (targetOpacity - currentOpacity) * 0.1;

    // Apply to roof
    parts.roofMat.opacity = newOpacity;
    parts.roof.visible = newOpacity > 0.02;
    parts.roofMat.depthWrite = newOpacity > 0.5;

    // Apply to front wall
    parts.frontWallMat.opacity = newOpacity;
    parts.frontWall.visible = newOpacity > 0.02;
    parts.frontWallMat.depthWrite = newOpacity > 0.5;

    // Door fades with front wall
    parts.doorMat.opacity = newOpacity;
    parts.door.visible = newOpacity > 0.02;

    // Edges fade
    parts.edgesMat.opacity = Math.min(0.4, newOpacity * 0.4);

    // Front windows fade with front wall
    for (const win of parts.frontWindows) {
      win.material.opacity = newOpacity * 0.8;
      win.visible = newOpacity > 0.02;
    }

    // Show interior when building is sufficiently transparent
    interior.visible = newOpacity < 0.8;
  }
}

export { LOCATIONS };
