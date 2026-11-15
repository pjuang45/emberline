// EMBERLINE player controller: mouse look with recoil, WASD movement built
// on the shared integrator, firing, reloading, weapon slots, grenades and
// the scoped aim. The plant channel itself lives in rounds.js — this file
// only turns the human's hands into actor state.

import { WEAPONS } from './config.js';
import { G } from './state.js';
import { input } from './input.js';
import { currentWeapon } from './actors.js';
import { integrateMovement, SPEED_RUN, SPEED_WALK, SPEED_CROUCH } from './movement.js';
import { shoot, startReload, throwGrenade, recoil, setScoped } from './weapons.js';

const SENS = 0.0021;

// The direction an actor faces, as a unit vector. The player's includes the
// current recoil offset, so the bullets go where the kicked view points.
export function lookDir(a) {
  const pitch = a.pitch + (a.isPlayer ? recoil.pitch : 0);
  const yaw = a.yaw + (a.isPlayer ? recoil.yaw : 0);
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}

export function updatePlayer(dt) {
  const p = G.player;
  if (!p) return;

  // look — always available, even frozen in the buy phase or dead
  p.yaw -= input.mouseDX * SENS;
  p.pitch -= input.mouseDY * SENS;
  p.pitch = Math.max(-1.45, Math.min(1.45, p.pitch));
  const ld = lookDir(p);
  G.playerLook = ld;

  if (!p.alive) { setScoped(false); return; }

  const frozen = G.phase === 'buy' || G.phase === 'end' || G.phase === 'matchover';
  const w = currentWeapon(p);
  const def = w ? WEAPONS[w.id] : null;

  // stance and speed: crouch is slow and steady, walk is quiet, run is loud
  p.crouching = !!(input.keys['ControlLeft'] || input.keys['KeyC']);
  p.walking = !!input.keys['ShiftLeft'] && !p.crouching;
  let speed = p.crouching ? SPEED_CROUCH : p.walking ? SPEED_WALK : SPEED_RUN;
  if (def) speed *= def.moveFactor;

  let wishX = 0, wishZ = 0;
  if (!frozen) {
    const f = (input.keys['KeyW'] ? 1 : 0) - (input.keys['KeyS'] ? 1 : 0);
    const r = (input.keys['KeyD'] ? 1 : 0) - (input.keys['KeyA'] ? 1 : 0);
    const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
    // forward on the ground plane is (-sin yaw, -cos yaw); right is (cos, -sin)... 
    wishX = -sin * f + cos * r;
    wishZ = -cos * f - sin * r;
  }
  const jump = !frozen && !!input.keys['Space'];
  integrateMovement(p, wishX, wishZ, frozen ? 0 : speed, dt, jump);

  if (frozen) { setScoped(false); return; }

  // aim / scope
  const aiming = input.aiming && !!def;
  setScoped(aiming && def.kind === 'dmr');
  G.aimZoom = aiming ? def.zoom : 1;

  // fire: automatics follow the held trigger, the rest need a fresh click
  if (w && def) {
    const trigger = def.auto ? input.firing : input.clicked;
    if (trigger && p.blindT <= 0.4) {
      const eye = p.pos.y + (p.crouching ? 1.18 : 1.62);
      shoot(p, p.pos.x, eye, p.pos.z, ld.x, ld.y, ld.z);
    }
  }

  if (input.pressed.has('KeyR')) startReload(p);

  // slots and grenades (the buy menu owns the number keys while it is open)
  if (!G.buyOpen) {
    if (input.pressed.has('Digit1') && p.weapons.primary && p.slot !== 'primary') {
      p.slot = 'primary'; p.reloadT = 0;
    }
    if (input.pressed.has('Digit2') && p.slot !== 'sidearm') {
      p.slot = 'sidearm'; p.reloadT = 0;
    }
    if (input.pressed.has('Digit3')) throwGrenade(p, 'frag');
    if (input.pressed.has('Digit4')) throwGrenade(p, 'flash');
    if (input.pressed.has('Digit5')) throwGrenade(p, 'smoke');
  }
}
