// EMBERLINE actors: the plain record every combatant shares — the human
// player is index 0, bots fill the rest — plus the low-poly soldier meshes
// and their walk/death animation. Combat, AI and movement all work on the
// record; only this file knows what a soldier looks like.

import * as THREE from 'three';
import { WEAPONS, TEAMS } from './config.js';

export const BOT_NAMES = {
  us: ['VEX', 'ORIN', 'TALO'],
  them: ['MIRA', 'KOSS', 'BRANT', 'UDO'],
};

export function makeWeaponInst(id) {
  const def = WEAPONS[id];
  return { id, mag: def.mag, reserve: def.reserve };
}

export function makeActor(idx, team, isPlayer, name) {
  return {
    idx, team, isPlayer, name,
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, z: 0 },
    vy: 0, onGround: true,
    yaw: 0, pitch: 0,
    hp: 100, armor: 0, alive: true,
    radius: 0.35, crouching: false, walking: false,
    weapons: { primary: null, sidearm: makeWeaponInst('sparrow') },
    slot: 'sidearm',
    grenades: { frag: 0, flash: 0, smoke: 0 },
    fireT: 0,          // seconds until the weapon may fire again
    reloadT: 0,         // seconds left of an active reload
    bloom: 0,           // accumulated spread from recent shots, degrees
    muzzle: 0,          // muzzle flash timer for the mesh/viewmodel
    hurtT: 0,           // red-flash timer after taking damage
    deadT: 0,           // seconds since death (corpse animation)
    walkCycle: 0, speedNow: 0,
    stepAcc: 0,         // footstep sound distance accumulator
    blindT: 0,          // flashbang blindness remaining
    // bot brain (bots.js fills this; the player leaves it null)
    brain: null,
    mesh: null, parts: null,
  };
}

export function currentWeapon(actor) {
  return actor.weapons[actor.slot] ?? actor.weapons.sidearm;
}

export function eyeHeight(actor) {
  return actor.crouching ? 1.18 : 1.62;
}

// The three boxes a bullet can hit, in world space. Head damage is the
// game's skill shot: HEADSHOT_MULT in config.js applies to 'head' hits.
export function actorHitboxes(a) {
  const { x, z } = a.pos;
  const y = a.pos.y;
  if (a.crouching) {
    return [
      { part: 'head', cx: x, cy: y + 1.08, cz: z, hx: 0.17, hy: 0.16, hz: 0.17 },
      { part: 'body', cx: x, cy: y + 0.78, cz: z, hx: 0.31, hy: 0.3, hz: 0.23 },
      { part: 'legs', cx: x, cy: y + 0.3, cz: z, hx: 0.27, hy: 0.3, hz: 0.21 },
    ];
  }
  return [
    { part: 'head', cx: x, cy: y + 1.64, cz: z, hx: 0.17, hy: 0.16, hz: 0.17 },
    { part: 'body', cx: x, cy: y + 1.2, cz: z, hx: 0.31, hy: 0.32, hz: 0.23 },
    { part: 'legs', cx: x, cy: y + 0.48, cz: z, hx: 0.27, hy: 0.48, hz: 0.21 },
  ];
}

// --- meshes -----------------------------------------------------------------

const boxGeo = new THREE.BoxGeometry(1, 1, 1);
function part(parent, mat, sx, sy, sz, x, y, z) {
  const m = new THREE.Mesh(boxGeo, mat);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

// A soldier from boxes: legs that swing, a torso in team colours, a dark
// helmet with a team visor stripe, and a gun arm that tracks pitch. Built
// once per actor; animation only moves the pivots.
export function buildActorMesh(actor) {
  const teamMat = new THREE.MeshStandardMaterial({ color: TEAMS[actor.team].color, roughness: 0.8 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x2c2c30, roughness: 0.6, metalness: 0.3 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xb98a5e, roughness: 0.9 });
  const visorMat = new THREE.MeshStandardMaterial({ color: 0x14181d, roughness: 0.25, metalness: 0.6 });

  const group = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = 0.98;
  group.add(hips);

  const legL = new THREE.Group(); legL.position.set(-0.13, 0, 0); hips.add(legL);
  const legR = new THREE.Group(); legR.position.set(0.13, 0, 0); hips.add(legR);
  part(legL, darkMat, 0.17, 0.98, 0.2, 0, -0.49, 0);
  part(legR, darkMat, 0.17, 0.98, 0.2, 0, -0.49, 0);

  const torso = part(group, teamMat, 0.54, 0.62, 0.3, 0, 1.28, 0);
  const vest = part(group, darkMat, 0.58, 0.44, 0.36, 0, 1.24, 0);
  vest.visible = false;

  const headG = new THREE.Group();
  headG.position.y = 1.62;
  group.add(headG);
  part(headG, skinMat, 0.26, 0.3, 0.26, 0, 0.02, 0);
  part(headG, darkMat, 0.3, 0.14, 0.3, 0, 0.16, 0);          // helmet
  part(headG, visorMat, 0.27, 0.07, 0.05, 0, 0.03, -0.13);   // visor, faces -z

  const armL = part(group, teamMat, 0.13, 0.52, 0.13, -0.34, 1.3, -0.08);
  armL.rotation.x = -0.9;
  const armR = new THREE.Group();
  armR.position.set(0.34, 1.48, 0);
  group.add(armR);
  part(armR, teamMat, 0.13, 0.13, 0.52, 0, 0, -0.2);
  const gun = new THREE.Group();
  gun.position.set(0, -0.04, -0.42);
  armR.add(gun);
  part(gun, darkMat, 0.07, 0.11, 0.62, 0, 0, -0.1);
  part(gun, darkMat, 0.05, 0.16, 0.05, 0, -0.1, 0.08);       // grip/mag
  const muzzle = part(gun, new THREE.MeshBasicMaterial({ color: 0xffc46b }), 0.13, 0.13, 0.13, 0, 0, -0.46);
  muzzle.visible = false;

  actor.mesh = group;
  actor.parts = { legL, legR, armR, headG, vest, muzzle, torso };
  return group;
}

// Per-frame mesh sync: position, facing, walk swing, crouch dip, gun pitch,
// muzzle flash and the death fall. Rendering only — the simulation has
// already decided everything this shows.
export function syncActorMesh(actor, dt) {
  const m = actor.mesh;
  if (!m) return;
  const p = actor.parts;
  m.position.set(actor.pos.x, actor.pos.y, actor.pos.z);
  m.rotation.y = actor.yaw;
  if (!actor.alive) {
    actor.deadT += dt;
    const fall = Math.min(1, actor.deadT * 2.6);
    m.rotation.x = -fall * Math.PI / 2;
    m.position.y = actor.pos.y + fall * 0.25;
    return;
  }
  m.rotation.x = 0;
  const swing = Math.sin(actor.walkCycle) * Math.min(1, actor.speedNow / 3) * 0.55;
  p.legL.rotation.x = swing;
  p.legR.rotation.x = -swing;
  const dip = actor.crouching ? -0.42 : 0;
  m.position.y = actor.pos.y + dip + Math.abs(Math.sin(actor.walkCycle)) * 0.03 * Math.min(1, actor.speedNow / 3);
  p.armR.rotation.x = actor.pitch;
  p.headG.rotation.x = actor.pitch * 0.7;
  p.vest.visible = actor.armor > 0;
  p.muzzle.visible = actor.muzzle > 0;
  if (actor.hurtT > 0) {
    p.torso.material.emissive = p.torso.material.emissive ?? new THREE.Color(0);
    p.torso.material.emissive.setRGB(actor.hurtT * 1.4, 0, 0);
  }
}
