// EMBERLINE rounds: the match state machine. Owns actor creation, round
// setup (spawns, loadouts, bot plans), the buy phase, the plant and defuse
// channels, win/loss resolution, the economy, and the kill hook that
// weapons.js reports into. Phases: buy → live → (planted) → end → next
// round or matchover.

import * as THREE from 'three';
import { ECONOMY, ROUND, WEAPONS } from './config.js';
import { G, feed, showBanner } from './state.js';
import { makeActor, makeWeaponInst, buildActorMesh, BOT_NAMES } from './actors.js';
import { makeBrain } from './bots.js';
import { SPAWNS, HOLD_POINTS, SITES } from './world.js';
import { combatEvents, explosionAt } from './weapons.js';
import { input } from './input.js';
import * as SFX from './audio.js';

let scene = null;
let chargeMesh = null;
let chargeLightMat = null;
let beepT = 0;

export function initMatch(sceneRef) {
  scene = sceneRef;
  const defs = [
    { team: 'us', isPlayer: true, name: 'YOU' },
    ...BOT_NAMES.us.map((name) => ({ team: 'us', isPlayer: false, name })),
    ...BOT_NAMES.them.map((name) => ({ team: 'them', isPlayer: false, name })),
  ];
  G.actors = defs.map((d, i) => {
    const a = makeActor(i, d.team, d.isPlayer, d.name);
    if (!d.isPlayer) {
      a.brain = makeBrain(d.team);
      scene.add(buildActorMesh(a));
    }
    return a;
  });
  G.player = G.actors[0];

  // the charge: a squat charge block with a blinking amber light
  chargeMesh = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.3, 0.42),
    new THREE.MeshStandardMaterial({ color: 0x35322c, roughness: 0.5, metalness: 0.4 }),
  );
  body.position.y = 0.15;
  body.castShadow = true;
  chargeMesh.add(body);
  chargeLightMat = new THREE.MeshBasicMaterial({ color: 0xff3524 });
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.1), chargeLightMat);
  lamp.position.y = 0.33;
  chargeMesh.add(lamp);
  chargeMesh.visible = false;
  scene.add(chargeMesh);

  combatEvents.onKill = onKill;
}

export function startMatch() {
  G.score = { us: 0, them: 0 };
  G.roundNo = 1;
  G.money = ECONOMY.startMoney;
  G.matchWinner = null;
  for (const a of G.actors) {
    a.weapons.primary = null;
    a.weapons.sidearm = makeWeaponInst('sparrow');
    a.slot = 'sidearm';
    a.grenades = { frag: 0, flash: 0, smoke: 0 };
    a.armor = 0;
    a.lostGear = true;
  }
  setupRound();
}

// Bot loadouts follow a simple team economy: pistols in round 1, SMGs in
// round 2, rifles after; a defender picks up the Osprey late. The player's
// economy is real money and lives in the buy menu.
function botLoadout(a) {
  const r = G.roundNo;
  let primary = null;
  if (r === 2) primary = 'rook';
  else if (r >= 3) primary = a.team === 'them' && a.idx === 7 && r >= 5 ? 'osprey' : 'kestrel';
  if (primary && (a.lostGear || !a.weapons.primary)) {
    a.weapons.primary = makeWeaponInst(primary);
  }
  if (a.weapons.primary) a.slot = 'primary';
  a.armor = r >= 3 ? 100 : 0;
  if (r >= 3) {
    a.grenades = a.team === 'them'
      ? { frag: 0, flash: 1, smoke: G.rand() < 0.5 ? 1 : 0 }
      : { frag: 1, flash: 0, smoke: 0 };
  }
}

export function setupRound() {
  // clear the field: grenades, smokes, noises
  for (const gr of G.grenades) scene.remove(gr.mesh);
  for (const s of G.smokes) scene.remove(s.mesh);
  G.grenades = [];
  G.smokes = [];
  G.noises = [];
  G.banner = null;

  const targetSite = G.rand() < 0.5 ? 'A' : 'B';
  const routes = ['mid', 'flank', 'mid'];

  G.actors.forEach((a, i) => {
    const spawnList = SPAWNS[a.team];
    const spawn = spawnList[a.team === 'us' ? i : i - 4];
    a.pos.x = spawn.x; a.pos.z = spawn.z; a.pos.y = 0;
    a.vel.x = 0; a.vel.z = 0; a.vy = 0;
    a.yaw = spawn.yaw; a.pitch = 0;
    a.hp = 100; a.alive = true; a.deadT = 0;
    a.fireT = 0; a.reloadT = 0; a.bloom = 0; a.blindT = 0; a.hurtT = 0;
    a.crouching = false;
    if (a.isPlayer) {
      if (a.lostGear) {
        a.weapons.primary = null;
        a.grenades = { frag: 0, flash: 0, smoke: 0 };
        a.armor = 0;
      }
      if (!a.weapons.primary && a.slot === 'primary') a.slot = 'sidearm';
      // survivors keep their guns, topped up to a working reserve
      for (const slot of ['primary', 'sidearm']) {
        const w = a.weapons[slot];
        if (w) w.reserve = Math.max(w.reserve, WEAPONS[w.id].reserve);
      }
    } else {
      botLoadout(a);
      const b = a.brain;
      b.state = 'idle'; b.target = null; b.lastKnown = null; b.path = []; b.dest = null; b.quietT = 0;
      if (a.team === 'us') {
        b.plan = { site: targetSite, route: routes[(i - 1) % 3] };
      } else {
        const site = i - 4 < 2 ? 'A' : 'B';
        const hold = HOLD_POINTS[site][(i - 4) % 2];
        b.plan = { site, hold };
        b.holdYaw = hold.yaw;
      }
    }
    a.lostGear = false;
  });

  G.charge.state = 'carried';
  G.charge.carrier = 0;
  G.charge.site = null;
  G.charge.channelBy = -1;
  G.charge.channelT = 0;
  chargeMesh.visible = false;

  G.phase = 'buy';
  G.phaseT = ROUND.buySec;
  G.roundWinner = null;
  beepT = 0;
}

// Lets the screenshot poses show the planted charge without running a
// round: positions the charge mesh exactly as a real plant would.
export function showChargeAt(x, z) {
  chargeMesh.visible = true;
  chargeMesh.position.set(x, 0, z);
}

// --- buying ---------------------------------------------------------------------

export function buyItem(id) {
  const p = G.player;
  if (!p || !p.alive || G.phase !== 'buy') return false;
  let price = 0;
  if (id === 'vest') {
    if (p.armor >= 100) return false;
    price = 650;
    if (G.money < price) { SFX.sfxDenied(); return false; }
    G.money -= price; p.armor = 100;
  } else if (id === 'ammo') {
    price = 150;
    if (G.money < price) { SFX.sfxDenied(); return false; }
    let topped = false;
    for (const slot of ['primary', 'sidearm']) {
      const w = p.weapons[slot];
      if (w && w.reserve < WEAPONS[w.id].reserve) { w.reserve = WEAPONS[w.id].reserve; topped = true; }
    }
    if (!topped) return false;
    G.money -= price;
  } else if (id === 'frag' || id === 'flash' || id === 'smoke') {
    price = id === 'frag' ? 300 : id === 'flash' ? 200 : 300;
    if (p.grenades[id] >= 2 || G.money < price) { SFX.sfxDenied(); return false; }
    G.money -= price; p.grenades[id]++;
  } else {
    const def = WEAPONS[id];
    if (!def) return false;
    price = def.price;
    if (G.money < price) { SFX.sfxDenied(); return false; }
    G.money -= price;
    p.weapons.primary = makeWeaponInst(id);
    p.slot = 'primary';
  }
  SFX.sfxBuy();
  return true;
}

// --- kills -------------------------------------------------------------------------

function aliveCount(team) {
  return G.actors.reduce((n, a) => n + (a.team === team && a.alive ? 1 : 0), 0);
}

function onKill(attacker, victim, headshot, weaponId) {
  victim.lostGear = true;
  const atkName = attacker ? attacker.name : 'THE FOUNDRY';
  feed(`${atkName} ▸ ${victim.name}${headshot ? ' ⌖ HEADSHOT' : ''}`,
    attacker && attacker.team === 'us' ? 'us' : 'them');
  if (attacker && attacker.isPlayer) {
    G.money = Math.min(ECONOMY.moneyCap, G.money + ECONOMY.killReward);
  }
  if (G.charge.state === 'carried' && G.charge.carrier === victim.idx) {
    G.charge.state = 'dropped';
    G.charge.pos = { x: victim.pos.x, y: 0, z: victim.pos.z };
    G.charge.carrier = -1;
    G.charge.channelBy = -1;
    G.charge.channelT = 0;
    chargeMesh.visible = true;
    chargeMesh.position.set(victim.pos.x, 0, victim.pos.z);
  }
  if (G.phase !== 'live' && G.phase !== 'planted') return;
  if (G.phase === 'planted') {
    if (aliveCount('them') === 0) endRound('us', 'Wardens eliminated — the charge is safe');
    return; // attackers all dead after a plant: the round plays out
  }
  if (aliveCount('them') === 0) endRound('us', 'Wardens eliminated');
  else if (aliveCount('us') === 0) endRound('them', 'Jackals eliminated');
}

function endRound(winner, reason) {
  if (G.phase === 'end' || G.phase === 'matchover') return;
  G.roundWinner = winner;
  G.roundEndReason = reason;
  G.score[winner]++;
  const playerWon = winner === 'us';
  G.money = Math.min(ECONOMY.moneyCap, G.money + (playerWon ? ECONOMY.roundWin : ECONOMY.roundLoss));
  G.phase = 'end';
  G.phaseT = ROUND.endSec;
  G.charge.channelBy = -1;
  showBanner(
    playerWon ? 'ROUND WON' : 'ROUND LOST',
    `${reason} · +$${playerWon ? ECONOMY.roundWin : ECONOMY.roundLoss}`,
    playerWon ? 'win' : 'lose',
    ROUND.endSec - 0.4,
  );
  SFX.sfxSting(playerWon);
}

// --- per-step update ------------------------------------------------------------------

export function updateRounds(dt) {
  const charge = G.charge;

  // the dropped charge sits where it fell; walking over it picks it up
  if (charge.state === 'dropped') {
    chargeLightMat.color.setHex(Math.sin(G.time * 6) > 0 ? 0xff3524 : 0x571a12);
    const p = G.player;
    if (p.alive && Math.hypot(p.pos.x - charge.pos.x, p.pos.z - charge.pos.z) < 1.25) {
      charge.state = 'carried';
      charge.carrier = 0;
      chargeMesh.visible = false;
      feed('You picked up the charge', 'us');
    }
  }

  G.phaseT -= dt;
  switch (G.phase) {
    case 'buy': {
      if (G.phaseT <= 0) {
        G.phase = 'live';
        G.phaseT = ROUND.liveSec;
        G.buyOpen = false;
      }
      break;
    }
    case 'live': {
      stepPlantChannel(dt);
      if (G.phase === 'live' && G.phaseT <= 0) {
        endRound('them', 'Time expired — the foundry holds');
      }
      break;
    }
    case 'planted': {
      stepDefuseChannel(dt);
      beepT -= dt;
      if (beepT <= 0) {
        beepT = G.phaseT > 20 ? 1.0 : G.phaseT > 10 ? 0.5 : 0.24;
        SFX.sfxChargeBeep(G.phaseT < 5);
      }
      // the lamp burns for a tenth of a second after each beep
      chargeLightMat.color.setHex(beepT > (G.phaseT > 10 ? 0.4 : 0.14) ? 0xff3524 : 0x571a12);
      if (G.phase === 'planted' && G.phaseT <= 0) {
        charge.state = 'blown';
        explosionAt(charge.pos.x, 0.6, charge.pos.z, 13, 420, null);
        endRound('us', 'The charge detonated');
      }
      break;
    }
    case 'end': {
      if (G.phaseT <= 0) {
        if (G.score.us >= ROUND.winsNeeded || G.score.them >= ROUND.winsNeeded || G.roundNo >= ROUND.maxRounds) {
          G.phase = 'matchover';
          G.matchWinner = G.score.us > G.score.them ? 'us' : 'them';
        } else {
          G.roundNo++;
          setupRound();
        }
      }
      break;
    }
    default: break;
  }
}

// Planting: the carrier stands in a site and channels. For the player that
// is E held still inside the ring; a bot carrier sets channelBy itself in
// its plant state (bots.js) and this step just runs the clock for it.
function stepPlantChannel(dt) {
  const charge = G.charge;
  if (charge.state !== 'carried') { charge.channelT = 0; return; }
  const carrier = G.actors[charge.carrier];
  if (!carrier || !carrier.alive) { charge.channelT = 0; charge.channelBy = -1; return; }

  let siteKey = null;
  for (const key of ['A', 'B']) {
    const s = SITES[key];
    if (Math.hypot(carrier.pos.x - s.x, carrier.pos.z - s.z) < s.r) { siteKey = key; break; }
  }
  let channeling = false;
  if (carrier.isPlayer) {
    channeling = !!input.keys['KeyE'] && !!siteKey && carrier.speedNow < 0.4;
    charge.channelBy = channeling ? 0 : -1;
  } else {
    channeling = charge.channelBy === carrier.idx && !!siteKey;
  }
  if (channeling && siteKey) {
    charge.channelT += dt;
    if ((charge.channelT * 10 | 0) !== ((charge.channelT - dt) * 10 | 0)) SFX.sfxPlantTick();
    if (charge.channelT >= ROUND.plantChannelSec) {
      charge.state = 'planted';
      charge.site = siteKey;
      charge.pos = { x: carrier.pos.x, y: 0, z: carrier.pos.z };
      charge.channelBy = -1;
      charge.channelT = 0;
      chargeMesh.visible = true;
      chargeMesh.position.set(carrier.pos.x, 0, carrier.pos.z);
      if (carrier.isPlayer) {
        G.money = Math.min(ECONOMY.moneyCap, G.money + ECONOMY.plantReward);
      }
      feed(`Charge planted at ${siteKey === 'A' ? 'the Kiln Yard' : 'the Vault'}`, 'us');
      G.phase = 'planted';
      G.phaseT = ROUND.plantSec;
      SFX.sfxChargeBeep(true);
    }
  } else {
    charge.channelT = Math.max(0, charge.channelT - dt * 2);
    if (!carrier.isPlayer && charge.channelBy === carrier.idx) {
      // a bot that stopped channelling (it saw a fight) resets cleanly
      charge.channelBy = -1;
      charge.channelT = 0;
    }
  }
}

let defuseT = 0;
function stepDefuseChannel(dt) {
  const charge = G.charge;
  if (charge.state !== 'planted') { defuseT = 0; return; }
  const idx = charge.channelBy;
  const defender = idx >= 0 ? G.actors[idx] : null;
  const ok = defender && defender.alive && defender.team === 'them'
    && Math.hypot(defender.pos.x - charge.pos.x, defender.pos.z - charge.pos.z) < 1.7;
  if (ok) {
    defuseT += dt;
    charge.channelT = defuseT;
    if (defuseT >= ROUND.defuseChannelSec) {
      charge.state = 'defused';
      charge.channelBy = -1;
      defuseT = 0;
      endRound('them', 'The charge was defused');
    }
  } else {
    defuseT = Math.max(0, defuseT - dt * 2);
    charge.channelT = defuseT;
  }
}
