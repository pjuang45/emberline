// EMBERLINE bot AI: perception (sight with field of view and line of sight,
// hearing gunfire and running feet), a small state machine per role, and
// burst-fire combat. Defenders hold angles on their site and rotate on
// information; attackers push a chosen site down a route, clear it, plant
// when they carry the charge, and hold the post-plant. Everyone stops to
// shoot — the same spread rules apply to them as to the player.

import { BOT, WEAPONS } from './config.js';
import { G } from './state.js';
import { findPath, losClear, SITES, HOLD_POINTS, PLACES } from './world.js';
import { integrateMovement, SPEED_RUN, SPEED_WALK } from './movement.js';
import { shoot } from './weapons.js';
import { currentWeapon, eyeHeight } from './actors.js';

export function makeBrain(team) {
  return {
    team,
    state: 'idle',         // hold | push | rotate | combat | plant | defuse | pickup | postplant
    plan: null,            // set by rounds.js: { site, route, hold }
    path: [], pathI: 0,
    dest: null,            // current strategic destination {x,z}
    route: [], routeI: 0,  // strategic waypoint chain for a push
    target: null,          // actor currently engaged
    lastKnown: null,       // {x, z, at} last seen/heard enemy position
    seenAt: 0,             // when the current target was first seen
    reactionAt: 0,         // when the bot may open fire on this target
    thinkT: Math.random() * 0.1,
    decideT: 0,
    burstLeft: 0, pauseT: 0,
    strafeDir: 1, strafeT: 0,
    holdYaw: 0, scanPhase: Math.random() * 6,
    speedFactor: 0.92 + Math.random() * 0.08,
    lastPos: { x: 0, z: 0 }, stuckT: 0,
    quietT: 0,             // seconds since this bot last saw an enemy
  };
}

// --- perception ---------------------------------------------------------------

const _eye = { x: 0, y: 0, z: 0 };
function perceive(bot) {
  const b = bot.brain;
  const eyeY = bot.pos.y + eyeHeight(bot);
  let bestTarget = null, bestDist = Infinity;
  if (bot.blindT < 0.6) {
    for (const e of G.actors) {
      if (!e.alive || e.team === bot.team) continue;
      const dx = e.pos.x - bot.pos.x, dz = e.pos.z - bot.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > BOT.sightRange) continue;
      // field of view, unless the enemy is close enough to be unavoidable
      if (dist > 3.2) {
        const fx = -Math.sin(bot.yaw), fz = -Math.cos(bot.yaw);
        const dot = (fx * dx + fz * dz) / (dist || 1);
        if (dot < Math.cos((BOT.sightFovDeg / 2) * Math.PI / 180)) continue;
      }
      const ey = e.pos.y + (e.crouching ? 0.95 : 1.25);
      if (!losClear(bot.pos.x, eyeY, bot.pos.z, e.pos.x, ey, e.pos.z)) continue;
      if (dist < bestDist) { bestDist = dist; bestTarget = e; }
    }
  }
  if (bestTarget) {
    if (b.target !== bestTarget) {
      b.target = bestTarget;
      b.seenAt = G.time;
      b.reactionAt = G.time + BOT.reactionSec * (0.8 + G.rand() * 0.5);
      b.burstLeft = 0; b.pauseT = 0;
    }
    b.lastKnown = { x: bestTarget.pos.x, z: bestTarget.pos.z, at: G.time };
    b.quietT = 0;
  } else {
    if (b.target && G.time - (b.lastKnown?.at ?? 0) > 2.6) b.target = null;
    b.quietT += 0.12;
  }
  // hearing: the newest noise inside its radius refreshes lastKnown
  for (const n of G.noises) {
    if (n.at < G.time - 0.6) continue;
    const d = Math.hypot(n.x - bot.pos.x, n.z - bot.pos.z);
    if (d > n.radius) continue;
    if (n.kind === 'shot' || (n.kind === 'step' && d < 9)) {
      if (!b.lastKnown || n.at > b.lastKnown.at) {
        b.lastKnown = { x: n.x, z: n.z, at: n.at };
        if (bot.team === 'them' && b.state === 'hold') b.state = 'alert';
      }
    }
  }
}

// --- movement helpers -----------------------------------------------------------

function setDest(bot, x, z) {
  const b = bot.brain;
  b.dest = { x, z };
  b.path = findPath(bot.pos.x, bot.pos.z, x, z);
  b.pathI = 0;
}

function followPath(bot, dt, speed) {
  const b = bot.brain;
  if (b.pathI >= b.path.length) {
    if (b.dest && Math.hypot(b.dest.x - bot.pos.x, b.dest.z - bot.pos.z) > 1.0) {
      moveToward(bot, dt, b.dest.x, b.dest.z, speed);
    }
    return true; // arrived
  }
  const pt = b.path[b.pathI];
  if (Math.hypot(pt.x - bot.pos.x, pt.z - bot.pos.z) < 0.75) { b.pathI++; return false; }
  moveToward(bot, dt, pt.x, pt.z, speed);
  return false;
}

function moveToward(bot, dt, x, z, speed) {
  const dx = x - bot.pos.x, dz = z - bot.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.05) { integrateMovement(bot, 0, 0, 0, dt); return; }
  integrateMovement(bot, dx / d, dz / d, speed * bot.brain.speedFactor, dt);
}

function faceToward(bot, x, z, dt, rate = 7) {
  const want = Math.atan2(-(x - bot.pos.x), -(z - bot.pos.z));
  turnToward(bot, want, dt, rate);
}
function turnToward(bot, want, dt, rate = 7) {
  let diff = want - bot.yaw;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  bot.yaw += Math.max(-rate * dt, Math.min(rate * dt, diff));
}

// --- combat -----------------------------------------------------------------------

function combatStep(bot, dt) {
  const b = bot.brain;
  const t = b.target;
  const eyeY = bot.pos.y + eyeHeight(bot);
  let visible = false;
  if (t && t.alive && bot.blindT < 0.6) {
    const ey = t.pos.y + (t.crouching ? 0.95 : 1.25);
    visible = losClear(bot.pos.x, eyeY, bot.pos.z, t.pos.x, ey, t.pos.z)
      && Math.hypot(t.pos.x - bot.pos.x, t.pos.z - bot.pos.z) < BOT.sightRange;
  }
  if (visible) {
    faceToward(bot, t.pos.x, t.pos.z, dt, 10);
    bot.pitch = Math.max(-0.4, Math.min(0.4, Math.atan2((t.pos.y + 1.25) - eyeY, Math.hypot(t.pos.x - bot.pos.x, t.pos.z - bot.pos.z))));
    const dist = Math.hypot(t.pos.x - bot.pos.x, t.pos.z - bot.pos.z);
    // strafe between bursts, close or hold distance while pausing
    b.strafeT -= dt;
    if (b.strafeT <= 0) { b.strafeDir = G.rand() < 0.5 ? -1 : 1; b.strafeT = 0.4 + G.rand() * 0.6; }
    if (b.pauseT > 0) {
      b.pauseT -= dt;
      const px = -Math.cos(bot.yaw) * b.strafeDir, pz = Math.sin(bot.yaw) * b.strafeDir;
      const back = dist < 4.5 ? 0.5 : 0;
      integrateMovement(bot,
        px + Math.sin(bot.yaw) * back, pz + Math.cos(bot.yaw) * back,
        SPEED_WALK, dt);
      bot.crouching = dist > 14 && G.rand() < 0.006;
    } else {
      integrateMovement(bot, 0, 0, 0, dt);
      bot.crouching = false;
      if (G.time >= b.reactionAt) {
        if (b.burstLeft <= 0) {
          const w = currentWeapon(bot);
          const def = w ? WEAPONS[w.id] : null;
          b.burstLeft = def && def.auto
            ? BOT.burstMin + (G.rand() * (BOT.burstMax - BOT.burstMin)) | 0
            : 1;
        }
        // aim at the chest with an error that settles the longer the bot
        // tracks the target — first shots are wild, held angles are not
        const settle = Math.min(1, (G.time - b.seenAt) / 0.9);
        const errDeg = BOT.aimErrorDeg + (BOT.aimSettleDeg - BOT.aimErrorDeg) * settle;
        const err = errDeg * Math.PI / 180;
        const aimY = t.pos.y + (t.crouching ? 0.95 : 1.28);
        let dx = t.pos.x - bot.pos.x, dy = aimY - eyeY, dz = t.pos.z - bot.pos.z;
        const dl = Math.hypot(dx, dy, dz) || 1;
        dx /= dl; dy /= dl; dz /= dl;
        const jx = (G.rand() + G.rand() - 1) * err, jy = (G.rand() + G.rand() - 1) * err * 0.7;
        // jitter perpendicular-ish: add scaled random vector then normalise
        let nx = dx + jx * -dz, ny = dy + jy, nz = dz + jx * dx;
        const nl = Math.hypot(nx, ny, nz) || 1;
        const fired = shoot(bot, bot.pos.x, eyeY, bot.pos.z, nx / nl, ny / nl, nz / nl);
        if (fired) {
          b.burstLeft--;
          if (b.burstLeft <= 0) b.pauseT = BOT.burstPauseSec * (0.7 + G.rand() * 0.7);
        } else if (bot.reloadT <= 0) {
          b.pauseT = 0.25; // dry weapon: the reload is already running
        }
      }
    }
    return true;
  }
  // target lost: hunt the last known position while it is fresh
  if (b.lastKnown && G.time - b.lastKnown.at < 3.2) {
    faceToward(bot, b.lastKnown.x, b.lastKnown.z, dt, 8);
    bot.pitch = 0;
    const arrived = followPath(bot, dt, SPEED_RUN * 0.94);
    if (arrived || Math.hypot(b.lastKnown.x - bot.pos.x, b.lastKnown.z - bot.pos.z) < 1.4) {
      b.lastKnown = null;
      return false;
    }
    return true;
  }
  b.target = null;
  return false;
}

// --- role behaviour -----------------------------------------------------------------

function routeFor(site, route) {
  if (site === 'A') {
    return route === 'flank'
      ? [...PLACES.westRun, PLACES.siteAEntry[0], { x: SITES.A.x + 3, z: SITES.A.z + 3 }]
      : [PLACES.midDoorsS[0], PLACES.midDoorsN[0], PLACES.crossYard[0], PLACES.siteAEntry[1], { x: SITES.A.x, z: SITES.A.z + 2 }];
  }
  return route === 'flank'
    ? [...PLACES.eastRun, PLACES.siteBEntry[0], { x: SITES.B.x - 3, z: SITES.B.z + 3 }]
    : [PLACES.midDoorsS[1], PLACES.midDoorsN[1], PLACES.crossYard[1], PLACES.siteBEntry[1], { x: SITES.B.x, z: SITES.B.z + 2 }];
}

function decideStep(bot) {
  const b = bot.brain;
  const plan = b.plan;
  if (!plan) return;
  const charge = G.charge;

  if (bot.team === 'them') {
    // defenders
    if (G.phase === 'planted') {
      const site = SITES[charge.site];
      if (b.state !== 'defuse') {
        // converge on the planted site; the closest defender defuses
        const defenders = G.actors.filter((a) => a.team === 'them' && a.alive);
        const closest = defenders.reduce((m, a) => {
          const d = Math.hypot(a.pos.x - charge.pos.x, a.pos.z - charge.pos.z);
          return d < m.d ? { a, d } : m;
        }, { a: null, d: Infinity });
        if (closest.a === bot && b.quietT > 1.4) {
          b.state = 'defuse';
          setDest(bot, charge.pos.x, charge.pos.z);
        } else {
          b.state = 'rotate';
          setDest(bot, site.x + (G.rand() - 0.5) * 6, site.z + (G.rand() - 0.5) * 6);
        }
      }
      return;
    }
    if (b.state === 'alert' && b.lastKnown) {
      b.state = 'rotate';
      setDest(bot, b.lastKnown.x, b.lastKnown.z);
      return;
    }
    if (b.state === 'rotate' && !b.dest) { b.state = 'hold'; return; }
    if (b.state === 'idle' || b.state === 'hold') {
      b.state = 'hold';
      if (!b.dest && plan.hold) setDest(bot, plan.hold.x, plan.hold.z);
    }
    return;
  }

  // attackers
  if (G.phase === 'planted') {
    if (b.state !== 'postplant') {
      b.state = 'postplant';
      const pts = HOLD_POINTS[charge.site];
      const pt = pts[bot.idx % pts.length];
      setDest(bot, pt.x, pt.z);
      b.holdYaw = Math.atan2(-(SITES[charge.site].x - pt.x), -(SITES[charge.site].z - pt.z));
    }
    return;
  }
  if (charge.state === 'dropped' && charge.carrier !== bot.idx) {
    const carrierAlive = charge.carrier >= 0 && G.actors[charge.carrier]?.alive;
    if (!carrierAlive) {
      // someone must fetch the charge: the nearest attacker goes
      const attackers = G.actors.filter((a) => a.team === 'us' && a.alive && !a.isPlayer);
      const nearest = attackers.reduce((m, a) => {
        const d = Math.hypot(a.pos.x - charge.pos.x, a.pos.z - charge.pos.z);
        return d < m.d ? { a, d } : m;
      }, { a: null, d: Infinity });
      if (nearest.a === bot) { b.state = 'pickup'; setDest(bot, charge.pos.x, charge.pos.z); return; }
    }
  }
  if (charge.state === 'carried' && charge.carrier === bot.idx) {
    const site = SITES[plan.site];
    const onSite = Math.hypot(bot.pos.x - site.x, bot.pos.z - site.z) < site.r - 1;
    if (onSite && b.quietT > 1.1) { b.state = 'plant'; return; }
  }
  if (b.state === 'idle' || b.state === 'plant' || b.state === 'pickup') {
    b.state = 'push';
    b.route = routeFor(plan.site, plan.route);
    b.routeI = 0;
    const first = b.route[0];
    setDest(bot, first.x, first.z);
  }
}

// --- main per-bot step -----------------------------------------------------------------

export function updateBot(bot, dt) {
  const b = bot.brain;
  if (!b || !bot.alive) return;
  if (G.phase === 'buy' || G.phase === 'end' || G.phase === 'matchover') {
    integrateMovement(bot, 0, 0, 0, dt);
    return;
  }

  b.thinkT -= dt;
  if (b.thinkT <= 0) { b.thinkT = 0.12; perceive(bot); }
  b.decideT -= dt;
  if (b.decideT <= 0) { b.decideT = 0.3; decideStep(bot); }

  // stuck detection: if we meant to move but barely did, repath
  b.stuckT += dt;
  if (b.stuckT > 1.1) {
    const moved = Math.hypot(bot.pos.x - b.lastPos.x, bot.pos.z - b.lastPos.z);
    b.lastPos = { x: bot.pos.x, z: bot.pos.z };
    b.stuckT = 0;
    if (moved < 0.35 && b.dest && b.state !== 'hold' && b.state !== 'defuse' && b.state !== 'plant') {
      b.path = findPath(bot.pos.x, bot.pos.z, b.dest.x, b.dest.z);
      b.pathI = 0;
    }
  }

  if (combatStep(bot, dt)) return;

  switch (b.state) {
    case 'hold': {
      const arrived = followPath(bot, dt, SPEED_RUN * 0.9);
      if (arrived) {
        integrateMovement(bot, 0, 0, 0, dt);
        // scan the watched angle slowly
        b.scanPhase += dt * 0.55;
        turnToward(bot, b.holdYaw + Math.sin(b.scanPhase) * 0.45, dt, 2.2);
        bot.pitch = 0;
        bot.crouching = bot.idx % 2 === 0;
      }
      break;
    }
    case 'alert': {
      if (b.lastKnown) faceToward(bot, b.lastKnown.x, b.lastKnown.z, dt, 5);
      integrateMovement(bot, 0, 0, 0, dt);
      if (b.quietT > 2.2) { b.state = 'hold'; b.dest = null; }
      break;
    }
    case 'push': {
      const arrived = followPath(bot, dt, SPEED_RUN * 0.97);
      if (arrived) {
        b.routeI++;
        if (b.routeI < b.route.length) {
          const pt = b.route[b.routeI];
          setDest(bot, pt.x, pt.z);
        } else {
          b.state = 'hold';
          const site = SITES[b.plan.site];
          // face outward from the site centre, toward the entries the
          // defenders will retake through
          b.holdYaw = Math.atan2(-(bot.pos.x - site.x), -(bot.pos.z - site.z));
          setDest(bot, bot.pos.x, bot.pos.z);
        }
      } else if (b.path.length) {
        const pt = b.path[Math.min(b.pathI, b.path.length - 1)];
        faceToward(bot, pt.x, pt.z, dt, 6);
      }
      bot.crouching = false;
      break;
    }
    case 'rotate': {
      const arrived = followPath(bot, dt, SPEED_RUN);
      if (b.dest) faceToward(bot, b.dest.x, b.dest.z, dt, 6);
      if (arrived) { b.state = bot.team === 'them' && G.phase !== 'planted' ? 'alert' : 'hold'; b.dest = null; }
      break;
    }
    case 'pickup': {
      followPath(bot, dt, SPEED_RUN);
      if (Math.hypot(G.charge.pos.x - bot.pos.x, G.charge.pos.z - bot.pos.z) < 1.3 && G.charge.state === 'dropped') {
        G.charge.state = 'carried';
        G.charge.carrier = bot.idx;
        b.state = 'push';
        b.route = routeFor(b.plan.site, b.plan.route);
        b.routeI = Math.max(0, b.route.length - 2);
        const pt = b.route[b.routeI];
        setDest(bot, pt.x, pt.z);
      }
      break;
    }
    case 'plant': {
      // stand in the site and channel; rounds.js watches channelBy
      integrateMovement(bot, 0, 0, 0, dt);
      faceToward(bot, SITES[b.plan.site].x, SITES[b.plan.site].z - 6, dt, 4);
      if (G.charge.state === 'carried' && G.charge.carrier === bot.idx) {
        G.charge.channelBy = bot.idx;
      }
      if (b.quietT < 0.3) { b.state = 'push'; G.charge.channelBy = -1; }
      break;
    }
    case 'defuse': {
      const arrived = followPath(bot, dt, SPEED_RUN);
      if (arrived || Math.hypot(G.charge.pos.x - bot.pos.x, G.charge.pos.z - bot.pos.z) < 1.6) {
        integrateMovement(bot, 0, 0, 0, dt);
        faceToward(bot, G.charge.pos.x, G.charge.pos.z, dt, 5);
        if (G.phase === 'planted' && b.quietT > 0.8) G.charge.channelBy = bot.idx;
        else if (b.quietT <= 0.8) G.charge.channelBy = -1;
      }
      break;
    }
    case 'postplant': {
      const arrived = followPath(bot, dt, SPEED_RUN * 0.95);
      if (arrived) {
        integrateMovement(bot, 0, 0, 0, dt);
        b.scanPhase += dt * 0.5;
        turnToward(bot, b.holdYaw + Math.sin(b.scanPhase) * 0.5, dt, 2.2);
      }
      break;
    }
    default: {
      integrateMovement(bot, 0, 0, 0, dt);
    }
  }
}
