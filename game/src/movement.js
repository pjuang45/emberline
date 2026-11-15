// EMBERLINE movement: the one integrator every actor — human or bot —
// moves through. Ground movement accelerates toward the wished velocity
// (snappy stops, so counter-strafing works), air control is weak, gravity
// and jumping are shared, and collision is the world's circle-vs-boxes
// slide. Running feet make noise the bots can hear; walking is silent.

import { collideMove } from './world.js';
import { emitNoise, G } from './state.js';
import { BOT } from './config.js';
import { sfxStep } from './audio.js';

export const SPEED_RUN = 5.2;
export const SPEED_WALK = 2.6;
export const SPEED_CROUCH = 1.9;
const GRAVITY = 22;
const JUMP_VEL = 7.2;

export function integrateMovement(a, wishX, wishZ, speed, dt, jump = false) {
  if (!a.alive) return;
  const wishLen = Math.hypot(wishX, wishZ);
  let tx = 0, tz = 0;
  if (wishLen > 0.01) { tx = (wishX / wishLen) * speed; tz = (wishZ / wishLen) * speed; }

  // Approach the wished velocity: fast on the ground (friction + drive in
  // one), sluggish in the air so a jump commits you to your line.
  const k = a.onGround ? (wishLen > 0.01 ? 13 : 16) : 1.1;
  const f = Math.min(1, k * dt);
  a.vel.x += (tx - a.vel.x) * f;
  a.vel.z += (tz - a.vel.z) * f;

  if (jump && a.onGround) { a.vy = JUMP_VEL; a.onGround = false; }
  a.vy -= GRAVITY * dt;
  a.pos.y += a.vy * dt;
  if (a.pos.y <= 0) { a.pos.y = 0; a.vy = 0; a.onGround = true; }

  collideMove(a.pos, a.radius, a.vel.x * dt, a.vel.z * dt);

  a.speedNow = Math.hypot(a.vel.x, a.vel.z);
  if (a.onGround && a.speedNow > 0.4) {
    a.walkCycle += a.speedNow * dt * 2.1;
    a.stepAcc += a.speedNow * dt;
    const stride = a.walking ? 2.0 : 2.7;
    if (a.stepAcc > stride) {
      a.stepAcc = 0;
      const running = a.speedNow > 3.4 && !a.crouching;
      if (running) emitNoise(a.pos.x, a.pos.z, BOT.hearingRun, 'step');
      const p = G.player;
      if (p && p !== a) {
        const d = Math.hypot(p.pos.x - a.pos.x, p.pos.z - a.pos.z);
        if (d < 16) sfxStep(running, d);
      } else if (a.isPlayer) {
        sfxStep(running, 0);
      }
    }
  }
}
