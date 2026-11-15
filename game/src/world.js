// EMBERLINE world: the Foundry Nine map — an original desert foundry with
// two plant sites (the Kiln Yard west, the Vault east), a furnace hall in
// the middle and a lane down each flank. This module builds the meshes,
// keeps the collider list every other system tests against, answers
// raycasts and line-of-sight questions, and owns the navigation grid the
// bots path on. One map, described once, used by physics, AI and the
// minimap alike.

import * as THREE from 'three';
import { G } from './state.js';

export const MAP_HALF = 32;

// Wall tuples: [centreX, centreZ, widthX, depthZ, height, material].
// Materials: sand (sandstone), dark (burnt metal), wood, metal (green
// machinery paint), brick. The layout is hand-placed: every lane has two
// entrances, every site three, and no corridor is a straight sniper alley
// from spawn to site.
const WALLS = [
  // outer boundary
  [0, -32.5, 66, 1, 6, 'dark'], [0, 32.5, 66, 1, 6, 'dark'],
  [-32.5, 0, 1, 66, 6, 'dark'], [32.5, 0, 1, 66, 6, 'dark'],
  // south yard funnels: walls leaving three exits (west run, mid, east run)
  [-13, 15, 14, 1, 3.6, 'sand'], [13, 15, 14, 1, 3.6, 'sand'],
  [-19.5, 15, 1, 12, 3.6, 'sand'], [19.5, 15, 1, 12, 3.6, 'sand'],
  // west run east wall (gap at z -2..2 is the mid-west door yard)
  [-19.5, -6, 1, 16, 3.6, 'sand'], [-19.5, 8, 1, 6, 3.6, 'sand'],
  // east run west wall (mirror)
  [19.5, -6, 1, 16, 3.6, 'sand'], [19.5, 8, 1, 6, 3.6, 'sand'],
  // furnace hall (mid): south wall with two doors at x -6 and x 6
  [-8.5, 12, 3, 1, 4, 'brick'], [-3, 12, 4, 1, 4, 'brick'], [3, 12, 4, 1, 4, 'brick'], [8.5, 12, 3, 1, 4, 'brick'],
  // furnace hall: north wall with two doors at x -6 and x 6
  [-8.5, -14, 3, 1, 4, 'brick'], [-3, -14, 4, 1, 4, 'brick'], [3, -14, 4, 1, 4, 'brick'], [8.5, -14, 3, 1, 4, 'brick'],
  // furnace hall: side walls with one door each (to the runs)
  [-10, -8, 1, 10, 4, 'brick'], [-10, 4, 1, 14, 4, 'brick'],
  [10, -8, 1, 10, 4, 'brick'], [10, 4, 1, 14, 4, 'brick'],
  // cross yard dividers between mid and the sites
  [-16, -14, 6, 1, 3.6, 'sand'], [16, -14, 6, 1, 3.6, 'sand'],
  // site A south wall: entrances at x -26..-23 and x -18..-15
  [-29.5, -20, 5, 1, 4, 'sand'], [-20.5, -20, 4, 1, 4, 'sand'], [-13.5, -20, 3, 1, 4, 'sand'],
  // site B south wall: entrances at x 15..18 and x 23..26
  [29.5, -20, 5, 1, 4, 'sand'], [20.5, -20, 4, 1, 4, 'sand'], [13.5, -20, 3, 1, 4, 'sand'],
  // the Vault: an inner room on site B with doors north and west
  [21, -29.5, 10, 1, 4.2, 'metal'], [16.5, -25, 1, 8, 4.2, 'metal'], [25.5, -25, 1, 8, 4.2, 'metal'], [18, -21.5, 4, 1, 4.2, 'metal'], [24, -21.5, 4, 1, 4.2, 'metal'],
];

// Free-standing cover: [centreX, centreZ, sizeX, sizeZ, height, material].
const COVER = [
  // south yard
  [-8, 22, 2.2, 1.1, 1.1, 'wood'], [8, 22, 2.2, 1.1, 1.1, 'wood'], [0, 19, 1.1, 2.2, 1.1, 'metal'],
  [-14, 26, 1.1, 1.1, 2.2, 'wood'], [14, 26, 1.1, 1.1, 2.2, 'wood'],
  // west and east runs
  [-24, 4, 2.2, 1.1, 1.1, 'wood'], [-24, -10, 1.1, 1.1, 1.1, 'metal'],
  [24, 4, 2.2, 1.1, 1.1, 'wood'], [24, -10, 1.1, 1.1, 1.1, 'metal'],
  // furnace hall interior: the furnace block and pillars
  [0, -1, 4.4, 3.2, 3.4, 'dark'], [-5.5, -6, 1.4, 1.4, 4, 'brick'], [5.5, -6, 1.4, 1.4, 4, 'brick'],
  [-5.5, 6, 1.4, 1.4, 1.1, 'wood'], [5.5, 6, 1.4, 1.4, 1.1, 'wood'], [0, 8, 2.2, 1.1, 1.1, 'metal'],
  // cross yard
  [-8, -17, 2.2, 1.1, 1.1, 'wood'], [8, -17, 2.2, 1.1, 1.1, 'wood'], [0, -17.5, 1.1, 1.1, 2.2, 'metal'],
  // site A: kiln bases (cylinders get square colliders) and crates
  [-25, -26, 4.6, 4.6, 5, 'dark'], [-16.5, -27, 4.6, 4.6, 5, 'dark'],
  [-21, -16.5, 2.2, 1.1, 1.1, 'wood'], [-27, -22, 1.1, 2.2, 1.1, 'metal'], [-15, -22.5, 1.1, 1.1, 2.2, 'wood'],
  // site B: crates around the vault
  [15, -27, 2.2, 1.1, 1.1, 'wood'], [27.5, -27, 1.1, 2.2, 1.1, 'metal'], [21, -16.5, 2.2, 1.1, 1.1, 'wood'],
  [13.8, -23, 1.1, 1.1, 2.2, 'wood'], [28.5, -17, 1.1, 1.1, 1.1, 'metal'],
];

export const SITES = {
  A: { x: -21, z: -24, r: 6.2, label: 'KILN YARD', color: 0xe86a2a },
  B: { x: 21, z: -25, r: 6.2, label: 'THE VAULT', color: 0x2a9d8f },
};

// Yaw convention: forward is (-sin yaw, -cos yaw), so yaw 0 faces north
// (-z, toward the sites) and yaw PI faces south (+z, toward the Jackal yard).
export const SPAWNS = {
  us: [
    { x: -3, z: 27, yaw: 0 }, { x: 3, z: 27, yaw: 0 },
    { x: -6, z: 29, yaw: 0 }, { x: 6, z: 29, yaw: 0 },
  ],
  them: [
    { x: -24, z: -29.5, yaw: Math.PI }, { x: -17, z: -17.5, yaw: Math.PI },
    { x: 24, z: -29.5, yaw: Math.PI }, { x: 17, z: -17.5, yaw: Math.PI },
  ],
};

// Where defenders hold, per site: a spot with a facing direction and the
// entrance it watches. Attackers clear these one by one without knowing.
export const HOLD_POINTS = {
  A: [
    { x: -15.2, z: -23.5, yaw: -Math.PI / 2 }, { x: -26.5, z: -18.5, yaw: Math.PI * 0.78 },
    { x: -20.5, z: -28.8, yaw: Math.PI },
  ],
  B: [
    { x: 26.8, z: -23.5, yaw: Math.PI / 2 }, { x: 15.5, z: -18.5, yaw: Math.PI * 0.85 },
    { x: 21, z: -29, yaw: Math.PI },
  ],
};

// Named waypoints the bot strategy talks about.
export const PLACES = {
  midDoorsS: [{ x: -6, z: 10.5 }, { x: 6, z: 10.5 }],
  midDoorsN: [{ x: -6, z: -12.5 }, { x: 6, z: -12.5 }],
  crossYard: [{ x: -8, z: -17 }, { x: 8, z: -17 }, { x: 0, z: -18.5 }],
  westRun: [{ x: -24, z: 6 }, { x: -24, z: -14 }],
  eastRun: [{ x: 24, z: 6 }, { x: 24, z: -14 }],
  siteAEntry: [{ x: -24.5, z: -18 }, { x: -16.5, z: -18 }],
  siteBEntry: [{ x: 24.5, z: -18 }, { x: 16.5, z: -18 }],
};

// Colliders: one flat list of boxes {x0,x1,z0,z1,h} built from WALLS+COVER,
// plus the two kiln cylinders approximated by their bounding squares (they
// are in COVER already). Everything — bullets, bodies, sight — tests these.
export const colliders = [];
for (const [cx, cz, w, d, h] of [...WALLS, ...COVER]) {
  colliders.push({ x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2, h });
}

// --- collision: circle vs the collider list, axis separated ---------------

export function collideMove(pos, radius, dx, dz) {
  // X axis first, then Z, so sliding along a wall keeps the free component.
  pos.x += dx;
  for (const c of colliders) {
    if (pos.x + radius > c.x0 && pos.x - radius < c.x1 && pos.z + radius > c.z0 && pos.z - radius < c.z1) {
      pos.x = dx > 0 ? c.x0 - radius : c.x1 + radius;
    }
  }
  pos.z += dz;
  for (const c of colliders) {
    if (pos.x + radius > c.x0 && pos.x - radius < c.x1 && pos.z + radius > c.z0 && pos.z - radius < c.z1) {
      pos.z = dz > 0 ? c.z0 - radius : c.z1 + radius;
    }
  }
  const lim = MAP_HALF - 0.6;
  pos.x = Math.max(-lim, Math.min(lim, pos.x));
  pos.z = Math.max(-lim, Math.min(lim, pos.z));
}

// --- raycast: slab test against every collider box and the ground ---------

const _hit = { t: Infinity, nx: 0, ny: 0, nz: 0, x: 0, y: 0, z: 0 };
export function raycastWorld(ox, oy, oz, dx, dy, dz, maxDist) {
  let best = maxDist;
  let nx = 0, ny = 0, nz = 0;
  if (dy < -1e-6) {
    const t = -oy / dy;
    if (t > 0 && t < best) { best = t; nx = 0; ny = 1; nz = 0; }
  }
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    let tmin = 0, tmax = best;
    let ax = 0, ay = 0, az = 0;
    // X slab
    if (Math.abs(dx) < 1e-9) { if (ox < c.x0 || ox > c.x1) continue; }
    else {
      let t1 = (c.x0 - ox) / dx, t2 = (c.x1 - ox) / dx;
      const s = dx > 0 ? -1 : 1;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      if (t1 > tmin) { tmin = t1; ax = s; ay = 0; az = 0; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) continue;
    }
    // Y slab (boxes stand on the ground, 0..h)
    if (Math.abs(dy) < 1e-9) { if (oy < 0 || oy > c.h) continue; }
    else {
      let t1 = (0 - oy) / dy, t2 = (c.h - oy) / dy;
      const s = dy > 0 ? -1 : 1;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      if (t1 > tmin) { tmin = t1; ax = 0; ay = s; az = 0; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) continue;
    }
    // Z slab
    if (Math.abs(dz) < 1e-9) { if (oz < c.z0 || oz > c.z1) continue; }
    else {
      let t1 = (c.z0 - oz) / dz, t2 = (c.z1 - oz) / dz;
      const s = dz > 0 ? -1 : 1;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      if (t1 > tmin) { tmin = t1; ax = 0; ay = 0; az = s; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) continue;
    }
    if (tmin < best && tmin > 0) { best = tmin; nx = ax; ny = ay; nz = az; }
  }
  if (best >= maxDist) return null;
  _hit.t = best; _hit.nx = nx; _hit.ny = ny; _hit.nz = nz;
  _hit.x = ox + dx * best; _hit.y = oy + dy * best; _hit.z = oz + dz * best;
  return _hit;
}

// Line of sight between two eye points: clear of walls and of smoke. Smoke
// blocks sight, not bullets, and it is the only soft blocker.
export function losClear(ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 0.01) return true;
  const hit = raycastWorld(ax, ay, az, dx / dist, dy / dist, dz / dist, dist - 0.05);
  if (hit) return false;
  for (const s of G.smokes) {
    // distance from the segment to the smoke centre, in the horizontal plane
    const t = Math.max(0, Math.min(1, ((s.x - ax) * dx + (s.z - az) * dz) / (dist * dist)));
    const px = ax + dx * t - s.x, pz = az + dz * t - s.z;
    if (px * px + pz * pz < s.r * s.r) return false;
  }
  return true;
}

// --- navigation grid + A* ---------------------------------------------------

const CELL = 1, GRID_N = MAP_HALF * 2;
const walkable = new Uint8Array(GRID_N * GRID_N);
function cellIndex(cx, cz) { return cz * GRID_N + cx; }
function cellBlocked(cx, cz) {
  const x0 = -MAP_HALF + cx * CELL - 0.1, x1 = x0 + CELL + 0.2;
  const z0 = -MAP_HALF + cz * CELL - 0.1, z1 = z0 + CELL + 0.2;
  for (const c of colliders) {
    // an actor needs its radius: inflate the cell test by shrinking the gap
    if (x1 - 0.35 > c.x0 && x0 + 0.35 < c.x1 && z1 - 0.35 > c.z0 && z0 + 0.35 < c.z1) return true;
  }
  return false;
}
for (let cz = 0; cz < GRID_N; cz++) {
  for (let cx = 0; cx < GRID_N; cx++) {
    walkable[cellIndex(cx, cz)] = cellBlocked(cx, cz) ? 0 : 1;
  }
}
function nearestCell(x, z) {
  let cx = Math.max(0, Math.min(GRID_N - 1, Math.floor(x + MAP_HALF)));
  let cz = Math.max(0, Math.min(GRID_N - 1, Math.floor(z + MAP_HALF)));
  if (walkable[cellIndex(cx, cz)]) return [cx, cz];
  for (let r = 1; r < 6; r++) {
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const nx = cx + dx, nz = cz + dz;
      if (nx >= 0 && nz >= 0 && nx < GRID_N && nz < GRID_N && walkable[cellIndex(nx, nz)]) return [nx, nz];
    }
  }
  return [cx, cz];
}
function gridLineClear(ax, az, bx, bz) {
  const dist = Math.hypot(bx - ax, bz - az);
  const steps = Math.max(1, Math.ceil(dist / 0.4));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const cx = Math.floor(ax + (bx - ax) * t + MAP_HALF);
    const cz = Math.floor(az + (bz - az) * t + MAP_HALF);
    if (cx < 0 || cz < 0 || cx >= GRID_N || cz >= GRID_N || !walkable[cellIndex(cx, cz)]) return false;
  }
  return true;
}

const _gs = new Float32Array(GRID_N * GRID_N);
const _from = new Int32Array(GRID_N * GRID_N);
const _closed = new Uint8Array(GRID_N * GRID_N);
const _open = [];
// A* over the grid, then line-of-sight smoothing so bots walk lanes, not
// grid zigzags. Returns world-space points (excluding the start).
export function findPath(sx, sz, tx, tz) {
  if (gridLineClear(sx, sz, tx, tz)) return [{ x: tx, z: tz }];
  const [scx, scz] = nearestCell(sx, sz);
  const [tcx, tcz] = nearestCell(tx, tz);
  const start = cellIndex(scx, scz), goal = cellIndex(tcx, tcz);
  _gs.fill(Infinity); _closed.fill(0); _open.length = 0;
  _gs[start] = 0; _from[start] = -1; _open.push(start);
  const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
  let found = false;
  while (_open.length) {
    let bi = 0;
    for (let i = 1; i < _open.length; i++) if (_gs[_open[i]] < _gs[_open[bi]]) bi = i;
    const cur = _open.splice(bi, 1)[0];
    if (cur === goal) { found = true; break; }
    if (_closed[cur]) continue;
    _closed[cur] = 1;
    const cx = cur % GRID_N, cz = (cur / GRID_N) | 0;
    for (const [dx, dz, cost] of DIRS) {
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= GRID_N || nz >= GRID_N) continue;
      const ni = cellIndex(nx, nz);
      if (!walkable[ni] || _closed[ni]) continue;
      if (dx !== 0 && dz !== 0 && (!walkable[cellIndex(cx + dx, cz)] || !walkable[cellIndex(cx, cz + dz)])) continue;
      const g = _gs[cur] + cost;
      if (g < _gs[ni]) { _gs[ni] = g; _from[ni] = cur; if (!_open.includes(ni)) _open.push(ni); }
    }
  }
  if (!found) return [];
  const cells = [];
  for (let c = goal; c !== -1; c = _from[c]) cells.push(c);
  cells.reverse();
  const pts = cells.map((c) => ({ x: -MAP_HALF + (c % GRID_N) + 0.5, z: -MAP_HALF + ((c / GRID_N) | 0) + 0.5 }));
  pts.push({ x: tx, z: tz });
  // smoothing: from each kept point, jump to the farthest visible next point
  const out = [];
  let anchor = { x: sx, z: sz };
  let i = 0;
  while (i < pts.length) {
    let j = pts.length - 1;
    while (j > i && !gridLineClear(anchor.x, anchor.z, pts[j].x, pts[j].z)) j--;
    out.push(pts[j]);
    anchor = pts[j];
    i = j + 1;
  }
  return out;
}

// --- scene construction -----------------------------------------------------

function canvasTexture(size, draw, repeat) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  draw(cv.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildWorld(scene) {
  scene.background = new THREE.Color(0x9db8c6);
  scene.fog = new THREE.Fog(0xc4b294, 55, 130);

  const sun = new THREE.DirectionalLight(0xffe3b3, 2.6);
  sun.position.set(-28, 42, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -40; sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40; sun.shadow.camera.bottom = -40;
  sun.shadow.camera.far = 120;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xbdd3e2, 0x8a6f4d, 0.85));

  // ground: speckled sand-asphalt, drawn once on a canvas
  const groundTex = canvasTexture(512, (ctx, s) => {
    ctx.fillStyle = '#977950'; ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 9000; i++) {
      const g = 120 + Math.random() * 90;
      ctx.fillStyle = `rgba(${g},${g * 0.82 | 0},${g * 0.55 | 0},0.25)`;
      ctx.fillRect(Math.random() * s, Math.random() * s, 2, 2);
    }
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = 'rgba(60,48,32,0.10)';
      ctx.beginPath();
      ctx.ellipse(Math.random() * s, Math.random() * s, 20 + Math.random() * 50, 12 + Math.random() * 30, Math.random() * 3, 0, 7);
      ctx.fill();
    }
  }, 14);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(MAP_HALF * 2 + 30, MAP_HALF * 2 + 30),
    new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const wallTex = canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#b59a72'; ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 2600; i++) {
      const g = 140 + Math.random() * 80;
      ctx.fillStyle = `rgba(${g},${g * 0.85 | 0},${g * 0.6 | 0},0.3)`;
      ctx.fillRect(Math.random() * s, Math.random() * s, 2, 2);
    }
    ctx.strokeStyle = 'rgba(80,62,40,0.35)';
    for (let y = 0; y <= s; y += 64) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(s, y); ctx.stroke(); }
  }, 1);

  const MATS = {
    sand: new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.95 }),
    brick: new THREE.MeshStandardMaterial({ color: 0x8a4f38, roughness: 0.9 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x55483c, roughness: 0.62, metalness: 0.35 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 0.85 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x4f6b5a, roughness: 0.5, metalness: 0.4 }),
  };

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  function addBox([cx, cz, w, d, h, mat]) {
    const m = new THREE.Mesh(boxGeo, MATS[mat]);
    m.scale.set(w, h, d);
    m.position.set(cx, h / 2, cz);
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
    return m;
  }
  for (const w of WALLS) addBox(w);
  for (const c of COVER) addBox(c);

  // the two kilns on site A: rusted cylinders standing on their square bases
  const kilnMat = new THREE.MeshStandardMaterial({ color: 0x6e4630, roughness: 0.55, metalness: 0.6 });
  for (const [kx, kz] of [[-25, -26], [-16.5, -27]]) {
    const kiln = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.1, 6.4, 14), kilnMat);
    kiln.position.set(kx, 3.2 + 2.5, kz);
    kiln.castShadow = true;
    scene.add(kiln);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.2, 1.2, 10), MATS.dark);
    cap.position.set(kx, 9.6, kz);
    scene.add(cap);
  }

  // site pads: a painted ring and a letter on the ground, canvas-drawn
  for (const key of ['A', 'B']) {
    const s = SITES[key];
    const pad = new THREE.Mesh(
      new THREE.CircleGeometry(s.r, 40),
      new THREE.MeshBasicMaterial({ color: s.color, transparent: true, opacity: 0.13, depthWrite: false }),
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(s.x, 0.02, s.z);
    scene.add(pad);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(s.r - 0.28, s.r, 40),
      new THREE.MeshBasicMaterial({ color: s.color, transparent: true, opacity: 0.75, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(s.x, 0.03, s.z);
    scene.add(ring);
    const letterTex = canvasTexture(128, (ctx, sz) => {
      ctx.clearRect(0, 0, sz, sz);
      ctx.font = `700 96px system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(key, sz / 2, sz / 2 + 4);
    }, 1);
    letterTex.wrapS = letterTex.wrapT = THREE.ClampToEdgeWrapping;
    const letter = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 3.4),
      new THREE.MeshBasicMaterial({ map: letterTex, transparent: true, depthWrite: false }),
    );
    letter.rotation.x = -Math.PI / 2;
    letter.position.set(s.x, 0.04, s.z);
    scene.add(letter);
  }

  // backdrop: dune ridges and dead derricks outside the walls, silhouettes
  // only — they sell the desert without costing the gate a single collider
  const duneMat = new THREE.MeshBasicMaterial({ color: 0xa8895e });
  const ridge = [[-70, -40, 90, 10], [60, -55, 110, 13], [0, -78, 150, 9], [-75, 30, 80, 8], [75, 25, 90, 11]];
  for (const [x, z, w, h] of ridge) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(w / 2, h, 5), duneMat);
    m.position.set(x, h / 2 - 1, z);
    m.scale.z = 0.4;
    scene.add(m);
  }
}
