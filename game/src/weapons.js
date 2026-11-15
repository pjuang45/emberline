// EMBERLINE weapons and combat: hitscan shooting with body-part hitboxes,
// distance falloff, movement bloom and recoil; reloads; thrown grenades
// (frag, flash, smoke); tracers and impact particles; and the first-person
// viewmodel. Damage flows through applyDamage, kills through combatEvents,
// which rounds.js hooks to pay rewards and end rounds.

import * as THREE from 'three';
import { WEAPONS, GRENADE_INFO, HEADSHOT_MULT, LEG_MULT, BOT } from './config.js';
import { G, emitNoise } from './state.js';
import { currentWeapon, actorHitboxes } from './actors.js';
import { raycastWorld, colliders } from './world.js';
import { SPEED_RUN } from './movement.js';
import * as SFX from './audio.js';

export const combatEvents = { onKill: null };

// Recoil the player controller applies to the camera: each shot kicks the
// view up (and a little sideways at random); it recovers between shots.
export const recoil = { pitch: 0, yaw: 0 };
export const viewShake = { t: 0, mag: 0 };
export function addShake(mag) { viewShake.t = 0.35; viewShake.mag = Math.max(viewShake.mag, mag); }

// --- shared scratch (no per-shot allocation) --------------------------------
const _dir = new THREE.Vector3();
const _org = new THREE.Vector3();
const _end = new THREE.Vector3();

function rayBox(ox, oy, oz, dx, dy, dz, b) {
  let tmin = 0, tmax = Infinity;
  const axes = [
    [ox, dx, b.cx - b.hx, b.cx + b.hx],
    [oy, dy, b.cy - b.hy, b.cy + b.hy],
    [oz, dz, b.cz - b.hz, b.cz + b.hz],
  ];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return Infinity; }
    else {
      let t1 = (lo - o) / d, t2 = (hi - o) / d;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}

export function spreadDegFor(actor) {
  const w = currentWeapon(actor);
  if (!w) return 1;
  const def = WEAPONS[w.id];
  const speedRatio = Math.min(1, actor.speedNow / SPEED_RUN);
  let s = def.spreadDeg + actor.bloom + speedRatio * speedRatio * def.bloomMove;
  if (!actor.onGround) s += def.bloomAir;
  if (actor.crouching) s *= 0.78;
  if (actor.isPlayer && actor === G.player && scopedNow) s *= 0.45;
  return s;
}

function jitterDir(dx, dy, dz, spreadRad) {
  // random point in the cone: build a basis around the direction and offset
  const gx = (G.rand() + G.rand() - 1) * spreadRad;
  const gy = (G.rand() + G.rand() - 1) * spreadRad;
  let ux = 0, uy = 1, uz = 0;
  if (Math.abs(dy) > 0.95) { ux = 1; uy = 0; }
  // right = dir x up, upv = right x dir
  let rx = dy * uz - dz * uy, ry = dz * ux - dx * uz, rz = dx * uy - dy * ux;
  const rl = Math.hypot(rx, ry, rz) || 1; rx /= rl; ry /= rl; rz /= rl;
  const vx = ry * dz - rz * dy, vy = rz * dx - rx * dz, vz = rx * dy - ry * dx;
  let nx = dx + rx * gx + vx * gy, ny = dy + ry * gx + vy * gy, nz = dz + rz * gx + vz * gy;
  const nl = Math.hypot(nx, ny, nz) || 1;
  _dir.set(nx / nl, ny / nl, nz / nl);
  return _dir;
}

function falloff(def, dist) {
  if (dist <= def.falloffStart) return 1;
  if (dist >= def.falloffEnd) return def.falloffMin;
  const t = (dist - def.falloffStart) / (def.falloffEnd - def.falloffStart);
  return 1 + (def.falloffMin - 1) * t;
}

export function applyDamage(victim, amount, part, attacker, weaponId) {
  if (!victim.alive) return false;
  let dmg = amount;
  if (part === 'head') dmg *= HEADSHOT_MULT;
  else if (part === 'legs') dmg *= LEG_MULT;
  if (victim.armor > 0) {
    victim.armor = Math.max(0, victim.armor - amount * 0.45);
    dmg *= 0.55;
  }
  victim.hp -= dmg;
  victim.hurtT = 0.3;
  if (victim.isPlayer) { SFX.sfxHurt(); addShake(0.05); }
  if (victim.hp <= 0) {
    victim.hp = 0;
    victim.alive = false;
    victim.deadT = 0;
    victim.reloadT = 0;
    if (combatEvents.onKill) combatEvents.onKill(attacker, victim, part === 'head', weaponId);
    return true;
  }
  return false;
}

// --- visual pools: tracers, impact particles, muzzle light ------------------

let tracerPool = [];
let particleSys = null;
const P_MAX = 320;
const pPos = new Float32Array(P_MAX * 3);
const pCol = new Float32Array(P_MAX * 3);
const pVel = new Float32Array(P_MAX * 3);
const pLife = new Float32Array(P_MAX);
let pHead = 0;
let muzzleLight = null;
let sceneRef = null;

export function initWeapons(scene) {
  sceneRef = scene;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  particleSys = new THREE.Points(geo, new THREE.PointsMaterial({
    size: 0.075, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false,
  }));
  particleSys.frustumCulled = false;
  scene.add(particleSys);
  for (let i = 0; i < P_MAX; i++) pPos[i * 3 + 1] = -50;
  for (let i = 0; i < 26; i++) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(g, new THREE.LineBasicMaterial({
      color: 0xffd9a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    line.frustumCulled = false;
    line.visible = false;
    scene.add(line);
    tracerPool.push({ line, life: 0 });
  }
  muzzleLight = new THREE.PointLight(0xffb45e, 0, 9, 1.8);
  scene.add(muzzleLight);
}

function spawnTracer(x0, y0, z0, x1, y1, z1, color) {
  for (const t of tracerPool) {
    if (t.life > 0) continue;
    const a = t.line.geometry.attributes.position.array;
    a[0] = x0; a[1] = y0; a[2] = z0; a[3] = x1; a[4] = y1; a[5] = z1;
    t.line.geometry.attributes.position.needsUpdate = true;
    t.line.material.color.setHex(color);
    t.line.material.opacity = 0.75;
    t.line.visible = true;
    t.life = 0.055;
    return;
  }
}

function spawnParticles(x, y, z, count, r, g, b, speed, up = 1.2) {
  for (let n = 0; n < count; n++) {
    const i = pHead; pHead = (pHead + 1) % P_MAX;
    pPos[i * 3] = x; pPos[i * 3 + 1] = y; pPos[i * 3 + 2] = z;
    pVel[i * 3] = (G.rand() - 0.5) * speed;
    pVel[i * 3 + 1] = G.rand() * speed * up;
    pVel[i * 3 + 2] = (G.rand() - 0.5) * speed;
    pCol[i * 3] = r; pCol[i * 3 + 1] = g; pCol[i * 3 + 2] = b;
    pLife[i] = 0.34 + G.rand() * 0.3;
  }
}

// --- shooting -----------------------------------------------------------------

let scopedNow = false;
export function setScoped(v) { scopedNow = v; }

export function shoot(actor, ox, oy, oz, dx, dy, dz) {
  const w = currentWeapon(actor);
  if (!w || !actor.alive || actor.fireT > 0 || actor.reloadT > 0 || actor.blindT > 2.2) return false;
  const def = WEAPONS[w.id];
  if (w.mag <= 0) {
    actor.fireT = 0.3;
    if (actor.isPlayer) SFX.sfxDryFire();
    startReload(actor);
    return false;
  }
  w.mag--;
  actor.fireT = 60 / def.rpm;
  actor.bloom = Math.min(7, actor.bloom + def.bloomShot);
  actor.muzzle = 0.05;
  actor.lastShotT = G.time;
  emitNoise(actor.pos.x, actor.pos.z, BOT.hearingGunfire, 'shot');

  const p = G.player;
  const distToPlayer = p ? Math.hypot(p.pos.x - actor.pos.x, p.pos.z - actor.pos.z) : 0;
  SFX.sfxShot(def.kind, actor.isPlayer ? 0 : distToPlayer);
  if (actor.isPlayer) {
    recoil.pitch += 0.0038 + def.bloomShot * 0.0022;
    recoil.yaw += (G.rand() - 0.5) * 0.0016;
    muzzleLight.position.set(ox + dx * 0.7, oy + dy * 0.7 - 0.05, oz + dz * 0.7);
    muzzleLight.intensity = 14;
  } else if (distToPlayer < 14) {
    muzzleLight.position.set(ox + dx * 0.8, oy + dy * 0.8, oz + dz * 0.8);
    muzzleLight.intensity = 8;
  }

  const spreadRad = THREE.MathUtils.degToRad(spreadDegFor(actor));
  const mx = ox + dx * 0.55, my = oy + dy * 0.55, mz = oz + dz * 0.55;
  for (let pellet = 0; pellet < def.pellets; pellet++) {
    const d = jitterDir(dx, dy, dz, spreadRad);
    const wallHit = raycastWorld(ox, oy, oz, d.x, d.y, d.z, 140);
    let bestT = wallHit ? wallHit.t : 140;
    let bestActor = null, bestPart = null;
    for (const other of G.actors) {
      if (other === actor || !other.alive || other.team === actor.team) continue;
      const boxes = actorHitboxes(other);
      for (const b of boxes) {
        const t = rayBox(ox, oy, oz, d.x, d.y, d.z, b);
        if (t < bestT) { bestT = t; bestActor = other; bestPart = b.part; }
      }
    }
    _end.set(ox + d.x * bestT, oy + d.y * bestT, oz + d.z * bestT);
    spawnTracer(mx, my, mz, _end.x, _end.y, _end.z, def.tracer);
    if (bestActor) {
      const dmg = def.damage * falloff(def, bestT);
      const died = applyDamage(bestActor, dmg, bestPart, actor, w.id);
      spawnParticles(_end.x, _end.y, _end.z, 5, 0.45, 0.08, 0.06, 1.6);
      if (actor.isPlayer) { G.playerHitmark = { kill: died, at: G.time }; SFX.sfxHit(died); }
    } else if (wallHit) {
      spawnParticles(_end.x, _end.y, _end.z, 4, 0.72, 0.6, 0.42, 1.3);
    }
  }
  return true;
}

export function startReload(actor) {
  const w = currentWeapon(actor);
  if (!w || actor.reloadT > 0) return;
  const def = WEAPONS[w.id];
  if (w.mag >= def.mag || w.reserve <= 0) return;
  actor.reloadT = def.reloadSec;
  if (actor.isPlayer) SFX.sfxReload();
}

function finishReload(actor) {
  const w = currentWeapon(actor);
  if (!w) return;
  const def = WEAPONS[w.id];
  const take = Math.min(def.mag - w.mag, w.reserve);
  w.mag += take;
  w.reserve -= take;
}

// --- grenades -------------------------------------------------------------------

const grenadeGeo = new THREE.SphereGeometry(0.09, 10, 8);
const grenadeMats = {
  frag: new THREE.MeshStandardMaterial({ color: 0x44513a, roughness: 0.6 }),
  flash: new THREE.MeshStandardMaterial({ color: 0xb9bec4, roughness: 0.35, metalness: 0.6 }),
  smoke: new THREE.MeshStandardMaterial({ color: 0x5a6068, roughness: 0.5, metalness: 0.3 }),
};

export function throwGrenade(actor, kind) {
  if (!actor.alive || actor.grenades[kind] <= 0 || G.phase === 'buy' || G.phase === 'end') return false;
  actor.grenades[kind]--;
  const eye = actor.pos.y + (actor.crouching ? 1.18 : 1.62);
  const fx = -Math.sin(actor.yaw) * Math.cos(actor.pitch);
  const fy = Math.sin(actor.pitch);
  const fz = -Math.cos(actor.yaw) * Math.cos(actor.pitch);
  const mesh = new THREE.Mesh(grenadeGeo, grenadeMats[kind]);
  mesh.position.set(actor.pos.x, eye, actor.pos.z);
  sceneRef.add(mesh);
  G.grenades.push({
    kind, owner: actor,
    x: actor.pos.x + fx * 0.4, y: eye + 0.1, z: actor.pos.z + fz * 0.4,
    vx: fx * 13 + actor.vel.x * 0.5, vy: fy * 13 + 2.2, vz: fz * 13 + actor.vel.z * 0.5,
    fuse: GRENADE_INFO[kind].fuseSec, mesh,
  });
  if (actor.isPlayer) SFX.sfxThrow();
  return true;
}

export function explosionAt(x, y, z, radius, maxDamage, owner) {
  spawnParticles(x, y + 0.4, z, 42, 1.0, 0.55, 0.18, 5.5, 1.6);
  spawnParticles(x, y + 0.4, z, 20, 0.25, 0.22, 0.2, 3.4, 1.8);
  const p = G.player;
  const pd = p ? Math.hypot(p.pos.x - x, p.pos.z - z) : 99;
  SFX.sfxFragBoom(pd);
  if (pd < radius + 7) addShake(Math.max(0.06, 0.3 - pd * 0.02));
  for (const a of G.actors) {
    if (!a.alive) continue;
    const d = Math.hypot(a.pos.x - x, a.pos.z - z) - 0.3;
    if (d > radius) continue;
    const cy = a.pos.y + 1.0;
    const blocked = raycastWorld(x, y, z, (a.pos.x - x) / (d + 0.3), (cy - y) / (d + 0.3), (a.pos.z - z) / (d + 0.3), d + 0.3);
    let dmg = maxDamage * Math.pow(Math.max(0, 1 - d / radius), 1.15);
    if (blocked) dmg *= 0.25;
    if (owner && a.team === owner.team && a !== owner) dmg *= 0.3;
    if (a === owner) dmg *= 0.5;
    if (dmg >= 1) applyDamage(a, dmg, 'body', owner, 'frag');
  }
}

function detonate(gr) {
  const info = GRENADE_INFO[gr.kind];
  if (gr.kind === 'frag') {
    explosionAt(gr.x, gr.y, gr.z, info.radius, info.maxDamage, gr.owner);
  } else if (gr.kind === 'flash') {
    SFX.sfxFlashPop(G.player ? Math.hypot(G.player.pos.x - gr.x, G.player.pos.z - gr.z) : 99);
    spawnParticles(gr.x, gr.y, gr.z, 16, 1, 0.98, 0.9, 2.6, 1);
    for (const a of G.actors) {
      if (!a.alive) continue;
      const ex = a.pos.x, ey = a.pos.y + (a.crouching ? 1.18 : 1.62), ez = a.pos.z;
      const dx = gr.x - ex, dy = gr.y - ey, dz = gr.z - ez;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > info.radius) continue;
      if (raycastWorld(ex, ey, ez, dx / dist, dy / dist, dz / dist, dist - 0.1)) continue;
      // how directly is the actor looking at the pop?
      let lx, ly, lz;
      if (a.isPlayer && G.playerLook) { lx = G.playerLook.x; ly = G.playerLook.y; lz = G.playerLook.z; }
      else {
        lx = -Math.sin(a.yaw) * Math.cos(a.pitch); ly = Math.sin(a.pitch); lz = -Math.cos(a.yaw) * Math.cos(a.pitch);
      }
      const dot = (lx * dx + ly * dy + lz * dz) / dist;
      const facing = THREE.MathUtils.clamp((dot + 0.25) / 1.25, 0, 1);
      let dur = (1 - dist / info.radius) * (0.4 + 2.9 * facing);
      if (dist < 3.2) dur = Math.max(dur, 1.1);
      if (dur > 0.15) { a.blindT = Math.max(a.blindT, dur); a.blindMax = Math.max(a.blindMax ?? 0, dur); }
    }
  } else if (gr.kind === 'smoke') {
    SFX.sfxSmokeHiss(G.player ? Math.hypot(G.player.pos.x - gr.x, G.player.pos.z - gr.z) : 99);
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x9aa0a4, transparent: true, opacity: 0.5, roughness: 1, depthWrite: false });
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(info.radius * (0.55 + G.rand() * 0.3), 10, 8), mat);
      s.position.set((G.rand() - 0.5) * 2.4, 0.7 + G.rand() * 1.1, (G.rand() - 0.5) * 2.4);
      group.add(s);
    }
    group.position.set(gr.x, 0, gr.z);
    sceneRef.add(group);
    G.smokes.push({ x: gr.x, y: 1, z: gr.z, r: info.radius, until: G.time + info.lifeSec, mesh: group, born: G.time });
  }
}

function stepGrenades(dt) {
  for (let i = G.grenades.length - 1; i >= 0; i--) {
    const gr = G.grenades[i];
    gr.fuse -= dt;
    gr.vy -= 16 * dt;
    gr.x += gr.vx * dt; gr.y += gr.vy * dt; gr.z += gr.vz * dt;
    if (gr.y < 0.09) { gr.y = 0.09; gr.vy *= -0.38; gr.vx *= 0.7; gr.vz *= 0.7; if (Math.abs(gr.vy) < 0.8) gr.vy = 0; }
    // wall bounce: if the grenade's centre entered a collider box, leave by
    // the shallowest face and reflect that velocity component, damped
    for (const c of colliders) {
      if (gr.y > c.h || gr.x < c.x0 - 0.09 || gr.x > c.x1 + 0.09 || gr.z < c.z0 - 0.09 || gr.z > c.z1 + 0.09) continue;
      const pl = gr.x - (c.x0 - 0.09), pr = (c.x1 + 0.09) - gr.x;
      const pb = gr.z - (c.z0 - 0.09), pf = (c.z1 + 0.09) - gr.z;
      const m = Math.min(pl, pr, pb, pf);
      if (m === pl) { gr.x = c.x0 - 0.09; gr.vx = -Math.abs(gr.vx) * 0.42; }
      else if (m === pr) { gr.x = c.x1 + 0.09; gr.vx = Math.abs(gr.vx) * 0.42; }
      else if (m === pb) { gr.z = c.z0 - 0.09; gr.vz = -Math.abs(gr.vz) * 0.42; }
      else { gr.z = c.z1 + 0.09; gr.vz = Math.abs(gr.vz) * 0.42; }
    }
    gr.mesh.position.set(gr.x, gr.y, gr.z);
    if (gr.fuse <= 0) {
      detonate(gr);
      sceneRef.remove(gr.mesh);
      G.grenades.splice(i, 1);
    }
  }
  for (let i = G.smokes.length - 1; i >= 0; i--) {
    const s = G.smokes[i];
    const age = G.time - s.born;
    const grow = Math.min(1, age / 0.8);
    s.mesh.scale.setScalar(0.4 + 0.6 * grow);
    if (G.time > s.until - 1.2) s.mesh.scale.setScalar(Math.max(0.05, (s.until - G.time) / 1.2));
    if (G.time >= s.until) { sceneRef.remove(s.mesh); G.smokes.splice(i, 1); }
  }
}

// --- viewmodel --------------------------------------------------------------------

let vm = null;
let vmMuzzle = null;
let vmKind = null;
const vmMats = {
  body: new THREE.MeshStandardMaterial({ color: 0x2e2c2c, roughness: 0.45, metalness: 0.55 }),
  accent: new THREE.MeshStandardMaterial({ color: 0xe86a2a, roughness: 0.5 }),
  grip: new THREE.MeshStandardMaterial({ color: 0x191919, roughness: 0.8 }),
};
function vmBox(sx, sy, sz, x, y, z, mat = vmMats.body) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
  m.position.set(x, y, z);
  vm.add(m);
  return m;
}
export function initViewmodel(camera) {
  vm = new THREE.Group();
  vm.position.set(0.27, -0.245, -0.55);
  camera.add(vm);
  setViewmodel('sparrow');
}
export function setViewmodel(weaponId) {
  if (!vm) return;
  const def = WEAPONS[weaponId];
  if (vmKind === def.kind) return;
  vmKind = def.kind;
  while (vm.children.length) vm.remove(vm.children[0]);
  vmMuzzle = null;
  if (def.kind === 'pistol') {
    vmBox(0.055, 0.09, 0.21, 0, 0, -0.05);
    vmBox(0.05, 0.05, 0.16, 0, 0.06, -0.06);
    vmBox(0.05, 0.11, 0.06, 0, -0.08, 0.03, vmMats.grip);
  } else if (def.kind === 'shotgun') {
    vmBox(0.07, 0.1, 0.3, 0, -0.01, -0.08);
    vmBox(0.055, 0.055, 0.42, 0, 0.03, -0.3);
    vmBox(0.06, 0.06, 0.16, 0, -0.045, -0.22, vmMats.grip);
    vmBox(0.05, 0.12, 0.06, 0, -0.09, 0.05, vmMats.grip);
  } else if (def.kind === 'dmr') {
    vmBox(0.06, 0.09, 0.34, 0, 0, -0.08);
    vmBox(0.04, 0.04, 0.5, 0, 0.02, -0.38);
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.13, 10), vmMats.grip);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.085, -0.08);
    vm.add(scope);
    vmBox(0.05, 0.13, 0.06, 0, -0.1, -0.02, vmMats.grip);
  } else {
    // smg and rifle share a carbine silhouette; the smg is shorter, fatter mag
    const len = def.kind === 'smg' ? 0.3 : 0.38;
    vmBox(0.065, 0.1, len, 0, 0, -0.1);
    vmBox(0.04, 0.04, 0.24, 0, 0.02, -0.1 - len / 2 - 0.08);
    vmBox(0.045, def.kind === 'smg' ? 0.15 : 0.12, 0.05, 0, -0.11, -0.03, vmMats.grip);
    vmBox(0.05, 0.1, 0.05, 0, -0.08, 0.09, vmMats.grip);
    vmBox(0.068, 0.03, 0.1, 0, 0.065, -0.12, vmMats.accent);
  }
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.17, 0.17),
    new THREE.MeshBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0, 0.02, def.kind === 'pistol' ? -0.2 : def.kind === 'dmr' ? -0.68 : -0.52);
  flash.visible = false;
  vm.add(flash);
  vmMuzzle = flash;
}

// --- per-step update -----------------------------------------------------------------

export function updateWeapons(dt) {
  for (const a of G.actors) {
    if (a.fireT > 0) a.fireT -= dt;
    if (a.muzzle > 0) a.muzzle -= dt;
    if (a.hurtT > 0) a.hurtT -= dt;
    if (a.blindT > 0) a.blindT -= dt;
    if (a.bloom > 0 && G.time - (a.lastShotT ?? 0) > 0.22) {
      a.bloom = Math.max(0, a.bloom - dt * 7);
    }
    if (a.reloadT > 0) {
      a.reloadT -= dt;
      if (a.reloadT <= 0) finishReload(a);
    }
  }
  recoil.pitch *= Math.pow(0.0001, dt); // fast recovery, ~gone in 0.25 s
  recoil.yaw *= Math.pow(0.0001, dt);
  if (recoil.pitch < 0.00001) recoil.pitch = 0;
  if (viewShake.t > 0) { viewShake.t -= dt; if (viewShake.t <= 0) viewShake.mag = 0; }
  if (muzzleLight && muzzleLight.intensity > 0) muzzleLight.intensity = Math.max(0, muzzleLight.intensity - dt * 160);

  stepGrenades(dt);

  for (const t of tracerPool) {
    if (t.life <= 0) continue;
    t.life -= dt;
    t.line.material.opacity = Math.max(0, t.life / 0.055) * 0.75;
    if (t.life <= 0) t.line.visible = false;
  }
  if (particleSys) {
    for (let i = 0; i < P_MAX; i++) {
      if (pLife[i] <= 0) continue;
      pLife[i] -= dt;
      pVel[i * 3 + 1] -= 5.5 * dt;
      pPos[i * 3] += pVel[i * 3] * dt;
      pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt;
      pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
      if (pLife[i] <= 0 || pPos[i * 3 + 1] < 0) { pLife[i] = 0; pPos[i * 3 + 1] = -50; }
    }
    particleSys.geometry.attributes.position.needsUpdate = true;
    particleSys.geometry.attributes.color.needsUpdate = true;
  }
}

// Viewmodel pose for this frame: walk bob, recoil kick, reload dip, muzzle.
export function poseViewmodel(player, dt) {
  if (!vm) return;
  const w = currentWeapon(player);
  if (w) setViewmodel(w.id);
  const def = w ? WEAPONS[w.id] : null;
  const scoped = scopedNow && def && def.kind === 'dmr';
  vm.visible = !scoped && player.alive;
  const bobA = Math.min(1, player.speedNow / 5) * 0.012;
  vm.position.x = 0.27 + Math.sin(player.walkCycle * 0.5) * bobA * 0.6;
  vm.position.y = -0.245 + Math.abs(Math.sin(player.walkCycle * 0.5)) * bobA - (player.crouching ? 0.03 : 0);
  const kick = player.muzzle > 0 ? 1 : 0;
  vm.position.z = -0.55 + kick * 0.035 + recoil.pitch * 2.2;
  let dip = 0;
  if (player.reloadT > 0 && def) {
    const pr = 1 - player.reloadT / def.reloadSec;
    dip = Math.sin(pr * Math.PI) * 0.55;
  }
  vm.rotation.x = dip + recoil.pitch * 1.4;
  if (vmMuzzle) {
    vmMuzzle.visible = player.muzzle > 0;
    if (vmMuzzle.visible) {
      vmMuzzle.rotation.z = G.rand() * Math.PI;
      const s = 0.8 + G.rand() * 0.5;
      vmMuzzle.scale.set(s, s, 1);
    }
  }
}
