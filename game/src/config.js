// EMBERLINE configuration: the single table of numbers the rest of the game
// reads — weapons, prices, round timings, economy. Tuning lives here and
// nowhere else, so a balance change is a one-file change.

// Damage model: a hit deals `damage` to the torso, HEADSHOT_MULT to the head
// and LEG_MULT to the legs, scaled by distance falloff between falloffStart
// and falloffEnd (never below falloffMin). Spread is in degrees of cone
// half-angle; bloomMove is added at full run speed, bloomAir while airborne,
// and every shot adds bloomShot which decays. Standing still and crouched is
// the accurate way to shoot — that is the game's central gunplay rule.
export const HEADSHOT_MULT = 4;
export const LEG_MULT = 0.75;

export const WEAPONS = {
  sparrow: {
    name: 'SPARROW P9', kind: 'pistol', slot: 'sidearm', price: 0,
    damage: 26, rpm: 340, auto: false, mag: 12, reserve: 48,
    reloadSec: 1.5, spreadDeg: 0.55, bloomMove: 2.6, bloomAir: 5.0, bloomShot: 0.55,
    falloffStart: 16, falloffEnd: 42, falloffMin: 0.5,
    pellets: 1, moveFactor: 1.0, zoom: 1.15, tracer: 0xbfae8d,
  },
  rook: {
    name: 'ROOK-9 SMG', kind: 'smg', slot: 'primary', price: 900,
    damage: 21, rpm: 780, auto: true, mag: 32, reserve: 128,
    reloadSec: 2.0, spreadDeg: 0.8, bloomMove: 2.2, bloomAir: 4.5, bloomShot: 0.34,
    falloffStart: 11, falloffEnd: 34, falloffMin: 0.45,
    pellets: 1, moveFactor: 0.99, zoom: 1.2, tracer: 0xd8c391,
  },
  boar: {
    name: 'BOAR-12', kind: 'shotgun', slot: 'primary', price: 1600,
    damage: 11, rpm: 68, auto: false, mag: 6, reserve: 30,
    reloadSec: 3.1, spreadDeg: 3.4, bloomMove: 2.4, bloomAir: 4.0, bloomShot: 1.4,
    falloffStart: 5, falloffEnd: 17, falloffMin: 0.25,
    pellets: 8, moveFactor: 0.97, zoom: 1.15, tracer: 0xe0b184,
  },
  kestrel: {
    name: 'KESTREL AR', kind: 'rifle', slot: 'primary', price: 2400,
    damage: 33, rpm: 600, auto: true, mag: 30, reserve: 90,
    reloadSec: 2.35, spreadDeg: 0.5, bloomMove: 3.0, bloomAir: 5.5, bloomShot: 0.42,
    falloffStart: 24, falloffEnd: 58, falloffMin: 0.65,
    pellets: 1, moveFactor: 0.96, zoom: 1.25, tracer: 0xf0cd8e,
  },
  osprey: {
    name: 'OSPREY DMR', kind: 'dmr', slot: 'primary', price: 3400,
    damage: 96, rpm: 48, auto: false, mag: 5, reserve: 25,
    reloadSec: 2.9, spreadDeg: 0.06, bloomMove: 4.5, bloomAir: 7.0, bloomShot: 2.2,
    falloffStart: 40, falloffEnd: 90, falloffMin: 0.9,
    pellets: 1, moveFactor: 0.92, zoom: 3.2, tracer: 0xffe9b0,
  },
};

export const BUY_MENU = [
  { id: 'rook', key: '1' },
  { id: 'boar', key: '2' },
  { id: 'kestrel', key: '3' },
  { id: 'osprey', key: '4' },
  { id: 'vest', key: '5', name: 'FOUNDRY VEST', desc: 'Woven plate carrier. Cuts all incoming damage while it holds.', price: 650 },
  { id: 'frag', key: '6', name: 'BURST FRAG', desc: 'Thrown charge. Heavy damage in a 5 m burst, falls off fast.', price: 300 },
  { id: 'flash', key: '7', name: 'FLARE FLASH', desc: 'Blinds anyone looking at the pop. Turn away or close the distance.', price: 200 },
  { id: 'smoke', key: '8', name: 'VEIL SMOKE', desc: 'A 12-second grey veil. Blocks sight lines, not bullets.', price: 300 },
  { id: 'ammo', key: '9', name: 'FULL AMMO', desc: 'Refill every reserve magazine you carry.', price: 150 },
];

export const GRENADE_INFO = {
  frag: { name: 'BURST FRAG', fuseSec: 1.6, radius: 5.2, maxDamage: 118 },
  flash: { name: 'FLARE FLASH', fuseSec: 1.25, radius: 17 },
  smoke: { name: 'VEIL SMOKE', fuseSec: 0.9, radius: 3.4, lifeSec: 12 },
};

export const ECONOMY = {
  startMoney: 800,
  killReward: 300,
  plantReward: 300,
  roundWin: 1400,
  roundLoss: 1000,
  moneyCap: 10000,
};

export const ROUND = {
  buySec: 12,
  liveSec: 100,
  plantSec: 35,
  endSec: 5.5,
  plantChannelSec: 3.5,
  defuseChannelSec: 5,
  winsNeeded: 7,
  maxRounds: 13,
};

export const TEAMS = {
  us: { name: 'JACKALS', color: 0xe8a33d, css: '#e8a33d' },
  them: { name: 'WARDENS', color: 0x5b7fa6, css: '#5b7fa6' },
};

// Bot difficulty: reaction delay after first sight, burst discipline and the
// angular error of a bot's aim, which shrinks the longer it tracks a target.
export const BOT = {
  reactionSec: 0.32,
  aimErrorDeg: 2.6,
  aimSettleDeg: 0.7,
  burstMin: 3,
  burstMax: 6,
  burstPauseSec: 0.42,
  hearingRun: 13,
  hearingGunfire: 46,
  sightRange: 62,
  sightFovDeg: 104,
};
