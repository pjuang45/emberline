// EMBERLINE central state. Every module reads and writes this one object;
// there is no other global. The simulation advances it in fixed steps from
// main.js, and the renderer only reads it, so a paused simulation is a
// frozen frame and the screenshot poses are just state written by hand.

import { ECONOMY, ROUND } from './config.js';

// Deterministic RNG (mulberry32). Gameplay randomness goes through G.rand so
// a seeded run — a screenshot pose, a replayed round — always plays the same.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const G = {
  // run control
  started: false,          // the player has clicked DEPLOY at least once
  paused: true,            // simulation holds while menus are open
  shotMode: null,          // 'start' | 'play' | 'buy' | 'end' when posing
  time: 0,                 // simulated seconds since match start
  rand: mulberry32(20261115),

  // match and round
  phase: 'buy',            // buy | live | planted | end | matchover
  phaseT: ROUND.buySec,    // seconds left in the current phase
  roundNo: 1,
  score: { us: 0, them: 0 },
  roundWinner: null,       // 'us' | 'them' once decided
  roundEndReason: '',      // human line for the banner
  matchWinner: null,

  // actors: index 0 is always the human player; bots follow. An actor is a
  // plain record (see actors.js makeActor) — position, health, team, weapons.
  actors: [],
  player: null,

  // the charge (the bomb): carried by an actor, dropped, or planted
  charge: {
    state: 'carried',      // carried | dropped | planted | blown | defused
    carrier: 0,            // actor index while carried
    pos: { x: 0, y: 0, z: 0 },
    site: null,            // 'A' | 'B' once planted
    channelBy: -1,         // actor index planting or defusing, -1 for none
    channelT: 0,           // seconds of channel accumulated
  },

  // live projectiles and area effects
  grenades: [],            // thrown grenades in flight or cooking
  smokes: [],              // active smoke clouds {x,y,z,r,until}
  noises: [],              // {x,z,radius,kind,at} recent sounds bots can hear

  // presentation feeds the HUD and renderer consume
  killfeed: [],            // {text, cls, until}
  banner: null,            // {title, sub, cls, until}
  lastEvent: '',           // short status line (plant started, etc.)

  // per-round bookkeeping
  money: ECONOMY.startMoney,
  buyOpen: false,
};

// A noise is how bots hear the world: gunfire is loud, running feet carry,
// walking and crouching are silent. Entries expire by age in bots.js.
export function emitNoise(x, z, radius, kind) {
  G.noises.push({ x, z, radius, kind, at: G.time });
  if (G.noises.length > 24) G.noises.shift();
}

export function feed(text, cls) {
  G.killfeed.push({ text, cls, until: G.time + 5 });
  if (G.killfeed.length > 5) G.killfeed.shift();
}

export function showBanner(title, sub, cls, sec) {
  G.banner = { title, sub, cls, until: G.time + sec };
}
