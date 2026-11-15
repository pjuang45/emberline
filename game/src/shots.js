// EMBERLINE screenshot poses. The bounty requires screenshots that are
// real renders of the game's own code, so each pose is just game state
// written by hand — real actors, real HUD values, the real charge — with
// the simulation then held still. Nothing here runs in normal play.

import { G, showBanner } from './state.js';
import { SPAWNS, SITES } from './world.js';
import { showChargeAt } from './rounds.js';

function place(actor, x, z, yaw, pitch = 0) {
  actor.pos.x = x; actor.pos.z = z; actor.pos.y = 0;
  actor.yaw = yaw; actor.pitch = pitch;
  actor.vel.x = 0; actor.vel.z = 0;
}

export function poseShot(mode, camera) {
  const [you, vex, orin, talo, mira, koss, brant, udo] = G.actors;

  if (mode === 'start') {
    // the menu overlooks the foundry from the south yard, squads at spawn
    G.actors.forEach((a, i) => {
      const s = SPAWNS[a.team][a.team === 'us' ? i : i - 4];
      place(a, s.x, s.z, s.yaw);
    });
    camera.position.set(7, 11, 31);
    camera.lookAt(-3, 0, -14);
    return;
  }

  if (mode === 'buy') {
    // round 4, rifles out: the squad at spawn while the player shops
    G.roundNo = 4;
    G.money = 3150;
    G.score.us = 2; G.score.them = 1;
    place(you, 0, 26, 0);
    place(vex, -3.4, 24.5, -0.3);
    place(orin, 3.6, 24.8, 0.25);
    place(talo, 0.5, 22.6, 0);
    for (const bot of [vex, orin, talo]) {
      bot.weapons.primary = bot.weapons.primary ?? { id: 'kestrel', mag: 30, reserve: 90 };
      bot.slot = 'primary';
    }
    G.phase = 'buy';
    G.phaseT = 9;
    camera.position.set(you.pos.x, 1.62, you.pos.z);
    camera.rotation.set(0, 0, 0);
    return;
  }

  if (mode === 'play') {
    // mid-round in the furnace hall: Vex trades fire with Mira across the
    // furnace block, Orin pushes the north door, Koss holds the cross yard
    G.roundNo = 5;
    G.score.us = 3; G.score.them = 1;
    G.money = 1750;
    G.phase = 'live';
    G.phaseT = 57;
    place(you, -6.5, 2, -0.55, 0.02);
    you.hp = 64;
    you.weapons.primary = { id: 'kestrel', mag: 17, reserve: 61 };
    you.slot = 'primary';
    you.grenades = { frag: 1, flash: 1, smoke: 0 };
    place(vex, 0.5, 3.2, -0.3);
    vex.weapons.primary = { id: 'kestrel', mag: 22, reserve: 90 };
    vex.slot = 'primary';
    vex.muzzle = 0.05;
    place(orin, -5.6, -3.5, 0.4);
    place(talo, -24, 2, 0);
    place(mira, 6.5, -9, Math.PI - 0.3);
    mira.weapons.primary = { id: 'kestrel', mag: 25, reserve: 90 };
    mira.slot = 'primary';
    mira.muzzle = 0.05;
    place(koss, 7.5, -16.5, Math.PI - 0.5);
    place(brant, -21, -21, 2.6);
    place(udo, 21.5, -22.5, 2.84);
    G.playerHitmark = { kill: false, at: G.time };
    return;
  }

  if (mode === 'end') {
    // the charge is planted at the Kiln Yard and the round is won: two
    // Wardens down, the squad standing over the site
    G.roundNo = 6;
    G.score.us = 4; G.score.them = 1;
    G.money = 3550;
    G.phase = 'planted';
    G.phaseT = 21;
    const site = SITES.A;
    G.charge.state = 'planted';
    G.charge.site = 'A';
    G.charge.pos = { x: site.x + 1, y: 0, z: site.z + 1 };
    showChargeAt(G.charge.pos.x, G.charge.pos.z);
    place(you, site.x + 7.5, site.z + 7.5, 0.785);
    you.weapons.primary = { id: 'kestrel', mag: 21, reserve: 47 };
    you.slot = 'primary';
    place(vex, site.x - 3.5, site.z + 3.5, -0.78);
    place(orin, site.x + 1, site.z - 4.5, Math.PI);
    place(talo, -24.5, -17, 0);
    place(mira, site.x - 1.5, site.z + 0.5, 1.2);
    mira.alive = false; mira.hp = 0; mira.deadT = 1.2;
    place(koss, site.x + 3, site.z - 2, -0.8);
    koss.alive = false; koss.hp = 0; koss.deadT = 1.6;
    place(brant, -16, -18, 0);
    brant.alive = false; brant.hp = 0; brant.deadT = 2.0;
    place(udo, 21, -22, -2.8);
    showBanner('CHARGE PLANTED', 'Hold the Kiln Yard — 21 seconds to detonation', 'win', 9999);
    return;
  }
}

// In shot mode the render loop calls this instead of the simulation: the
// posed muzzle flashes stay lit and the start camera drifts a little, so
// consecutive captures are not pixel-identical dead frames.
export function tickShot(mode, camera, t) {
  if (mode === 'play') {
    for (const a of G.actors) if (a.muzzle > 0) a.muzzle = 0.05;
    if (G.playerHitmark) G.playerHitmark.at = G.time;
  }
  if (mode === 'start') {
    camera.position.x = 7 + Math.sin(t * 0.05) * 1.6;
    camera.lookAt(-3, 0, -14);
  }
}
