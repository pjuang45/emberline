// EMBERLINE HUD: every DOM readout — vitals, money, ammunition, timer,
// score, killfeed, banners, the interaction bar, the flash and damage
// overlays, the buy menu and the minimap. It only reads game state and
// writes the DOM; values are cached so a frame that changes nothing writes
// nothing.

import { WEAPONS, BUY_MENU, ROUND } from './config.js';
import { G } from './state.js';
import { currentWeapon } from './actors.js';
import { spreadDegFor } from './weapons.js';
import { colliders, SITES, MAP_HALF } from './world.js';
import { buyItem } from './rounds.js';
import { input } from './input.js';

const el = {};
let last = {};
let mapStatic = null;

function cache(id) { el[id] = document.getElementById(id); }
function set(key, node, value) {
  if (last[key] !== value) { last[key] = value; node.textContent = value; }
}

export function initHUD() {
  for (const id of ['hud', 'health', 'armor', 'healthbar', 'money', 'weapon-name', 'ammo',
    'ammo-mag', 'ammo-reserve', 'grenades', 'timer', 'round-no', 'planted-tag',
    'score-us', 'score-them', 'killfeed', 'crosshair', 'hitmarker', 'interact',
    'interact-label', 'interact-fill', 'banner', 'spectate', 'vignette', 'flash',
    'buy-menu', 'buy-grid', 'buy-money', 'minimap']) cache(id);
  el.healthbarFill = el.healthbar.querySelector('i');
  el.timerVal = el.timer.querySelector('b');
  el.scoreUsVal = el['score-us'].querySelector('b');
  el.scoreThemVal = el['score-them'].querySelector('b');
  el.bannerTitle = el.banner.querySelector('h2');
  el.bannerSub = el.banner.querySelector('p');
  buildBuyGrid();
  buildMapStatic();
}

function fmtTime(sec) {
  sec = Math.max(0, Math.ceil(sec));
  return `${(sec / 60) | 0}:${String(sec % 60).padStart(2, '0')}`;
}

export function updateHUD() {
  const p = G.player;
  if (!p) return;
  el.hud.hidden = !G.started;

  // vitals
  set('hp', el.health, String(Math.ceil(p.hp)));
  el.health.classList.toggle('low', p.hp <= 30);
  el.healthbarFill.style.width = `${Math.max(0, p.hp)}%`;
  set('armor', el.armor, p.armor > 0 ? `VEST ${Math.ceil(p.armor)}` : '');
  set('money', el.money, `$${G.money.toLocaleString('en-US')}`);

  // weapon
  const w = currentWeapon(p);
  const def = w ? WEAPONS[w.id] : null;
  set('wname', el['weapon-name'], def ? def.name : '—');
  if (w) {
    set('mag', el['ammo-mag'], String(w.mag));
    set('res', el['ammo-reserve'], String(w.reserve));
    el.ammo.classList.toggle('empty', w.mag === 0);
  }
  const g = p.grenades;
  const nadesHtml = `FRAG <b>${g.frag}</b> · FLASH <b>${g.flash}</b> · SMOKE <b>${g.smoke}</b>${G.charge.carrier === 0 && G.charge.state === 'carried' ? ' · <b>CHARGE</b>' : ''}`;
  if (last.nades !== nadesHtml) { last.nades = nadesHtml; el.grenades.innerHTML = nadesHtml; }

  // top bar
  set('sus', el.scoreUsVal, String(G.score.us));
  set('sthem', el.scoreThemVal, String(G.score.them));
  set('round', el['round-no'], String(G.roundNo));
  const phaseLabel = G.phase === 'buy' ? 'BUY ' : G.phase === 'end' ? '' : '';
  set('timer', el.timerVal, phaseLabel + fmtTime(G.phaseT));
  el.timerVal.classList.toggle('low', (G.phase === 'live' || G.phase === 'planted') && G.phaseT <= 10);
  el['planted-tag'].hidden = G.phase !== 'planted';

  // crosshair bloom mirrors the true spread — what you see is what you get
  const spread = spreadDegFor(p);
  el.crosshair.style.setProperty('--gap', `${(3 + spread * 2.6).toFixed(1)}px`);
  el.crosshair.style.opacity = p.alive ? 1 : 0;

  // hitmarker
  const hm = G.playerHitmark;
  const hmOn = hm && G.time - hm.at < 0.14;
  el.hitmarker.classList.toggle('on', !!hmOn);
  el.hitmarker.classList.toggle('kill', !!(hm && hm.kill));

  // killfeed
  const feedKey = G.killfeed.map((k) => k.text).join('|');
  if (last.feed !== feedKey) {
    last.feed = feedKey;
    el.killfeed.innerHTML = G.killfeed
      .map((k) => `<div class="${k.cls}">${k.text}</div>`).join('');
  }

  // banner
  const b = G.banner;
  const showB = b && G.time < b.until;
  el.banner.hidden = !showB;
  if (showB) {
    set('bt', el.bannerTitle, b.title);
    set('bs', el.bannerSub, b.sub);
    el.banner.className = b.cls;
  }

  // interaction bar: planting progress, or the prompt to start
  let interactLabel = null, interactFrac = 0;
  if (G.phase === 'live' && G.charge.state === 'carried' && G.charge.carrier === 0 && p.alive) {
    const inSite = ['A', 'B'].some((k) => {
      const s = SITES[k];
      return Math.hypot(p.pos.x - s.x, p.pos.z - s.z) < s.r;
    });
    if (inSite) {
      if (G.charge.channelBy === 0) {
        interactLabel = 'PLANTING THE CHARGE';
        interactFrac = G.charge.channelT / ROUND.plantChannelSec;
      } else {
        interactLabel = 'HOLD E — PLANT THE CHARGE';
      }
    }
  }
  el.interact.hidden = !interactLabel;
  if (interactLabel) {
    set('il', el['interact-label'], interactLabel);
    el['interact-fill'].style.width = `${interactFrac * 100}%`;
  }

  // spectate note
  el.spectate.hidden = p.alive || G.phase === 'matchover';

  // flash and damage overlays
  const blind = p.blindT > 0 ? Math.min(1, p.blindT * 1.5) : 0;
  el.flash.style.opacity = blind.toFixed(2);
  const hurt = Math.max(p.hurtT * 0.85, p.hp <= 30 && p.alive ? 0.16 + Math.sin(G.time * 3) * 0.05 : 0);
  el.vignette.style.boxShadow = `inset 0 0 140px 40px rgba(160, 20, 10, ${hurt.toFixed(2)})`;

  drawMinimap();
  // the menu's visibility always follows the flag, whoever changed it —
  // including the round clock, which closes the menu when the buy phase ends
  el['buy-menu'].hidden = !G.buyOpen;
  if (G.buyOpen) refreshBuyGrid();
}

// --- buy menu -----------------------------------------------------------------

const WEAPON_DESC = {
  rook: 'Fast and forgiving. Wins close fights, fades at range.',
  boar: 'Eight pellets, one argument. Point blank or nothing.',
  kestrel: 'The all-round rifle. Two taps to the chest, one to the head.',
  osprey: 'Bolt-action marksman rifle. One headshot ends anyone. Right-click to scope.',
};
const buyNodes = [];

function buildBuyGrid() {
  el['buy-grid'].innerHTML = '';
  buyNodes.length = 0;
  for (const entry of BUY_MENU) {
    const node = document.createElement('div');
    node.className = 'buy-item';
    const isWeapon = !!WEAPONS[entry.id];
    const name = isWeapon ? WEAPONS[entry.id].name : entry.name;
    const desc = isWeapon ? WEAPON_DESC[entry.id] : entry.desc;
    const price = isWeapon ? WEAPONS[entry.id].price : entry.price;
    node.innerHTML = `<div class="nm">${entry.key}. ${name}</div><div class="ds">${desc}</div><div class="pr">$${price}</div>`;
    node.addEventListener('click', () => { if (buyItem(entry.id)) refreshBuyGrid(); });
    el['buy-grid'].appendChild(node);
    buyNodes.push({ entry, node, price });
  }
}

function refreshBuyGrid() {
  const p = G.player;
  set('bmoney', el['buy-money'], `$${G.money.toLocaleString('en-US')}`);
  for (const { entry, node, price } of buyNodes) {
    let owned = false, cant = G.money < price;
    if (WEAPONS[entry.id]) owned = p.weapons.primary?.id === entry.id;
    else if (entry.id === 'vest') { owned = p.armor >= 100; cant = cant || owned; }
    else if (entry.id === 'frag' || entry.id === 'flash' || entry.id === 'smoke') {
      owned = p.grenades[entry.id] >= 2; cant = cant || owned;
    }
    node.classList.toggle('owned', owned);
    node.classList.toggle('cant', cant && !owned);
  }
}

export function openBuy() {
  G.buyOpen = true;
  el['buy-menu'].hidden = false;
  refreshBuyGrid();
}
export function closeBuy() {
  G.buyOpen = false;
  el['buy-menu'].hidden = true;
}

// Number keys buy while the menu is open (main.js routes them here so the
// player controller never sees them as weapon switches).
export function buyKeyStep() {
  for (const { entry } of buyNodes) {
    if (input.pressed.has(`Digit${entry.key}`) || input.pressed.has(`Numpad${entry.key}`)) {
      if (buyItem(entry.id)) refreshBuyGrid();
    }
  }
}

// --- minimap --------------------------------------------------------------------

function buildMapStatic() {
  mapStatic = document.createElement('canvas');
  mapStatic.width = mapStatic.height = 168;
  const ctx = mapStatic.getContext('2d');
  const s = 168 / (MAP_HALF * 2 + 2);
  const px = (x) => (x + MAP_HALF + 1) * s;
  ctx.fillStyle = '#241f18';
  ctx.fillRect(0, 0, 168, 168);
  for (const key of ['A', 'B']) {
    const site = SITES[key];
    ctx.fillStyle = key === 'A' ? 'rgba(232,106,42,0.25)' : 'rgba(42,157,143,0.25)';
    ctx.beginPath();
    ctx.arc(px(site.x), px(site.z), site.r * s, 0, 7);
    ctx.fill();
  }
  ctx.fillStyle = '#6f5f43';
  for (const c of colliders) {
    ctx.fillRect(px(c.x0), px(c.z0), (c.x1 - c.x0) * s, (c.z1 - c.z0) * s);
  }
}

function drawMinimap() {
  const ctx = el.minimap.getContext('2d');
  const s = 168 / (MAP_HALF * 2 + 2);
  const px = (x) => (x + MAP_HALF + 1) * s;
  ctx.clearRect(0, 0, 168, 168);
  ctx.drawImage(mapStatic, 0, 0);
  // the charge, once it is on the ground or planted, is public information
  if (G.charge.state === 'dropped' || G.charge.state === 'planted') {
    ctx.fillStyle = Math.sin(G.time * 6) > 0 ? '#ff3524' : '#7a1a10';
    ctx.fillRect(px(G.charge.pos.x) - 3, px(G.charge.pos.z) - 3, 6, 6);
  }
  for (const a of G.actors) {
    if (!a.alive || a.isPlayer) continue;
    if (a.team === 'us') {
      ctx.fillStyle = '#e8a33d';
    } else {
      // enemies appear only when a teammate's brain has fresh contact
      const spotted = G.actors.some((t) => t.team === 'us' && t.brain
        && t.brain.lastKnown && G.time - t.brain.lastKnown.at < 2
        && Math.hypot(t.brain.lastKnown.x - a.pos.x, t.brain.lastKnown.z - a.pos.z) < 4);
      if (!spotted) continue;
      ctx.fillStyle = '#5b7fa6';
    }
    ctx.beginPath();
    ctx.arc(px(a.pos.x), px(a.pos.z), 3, 0, 7);
    ctx.fill();
  }
  // the player: a wedge pointing where they look
  const p = G.player;
  ctx.save();
  ctx.translate(px(p.pos.x), px(p.pos.z));
  ctx.rotate(-p.yaw);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(0, -5); ctx.lineTo(3.4, 4); ctx.lineTo(-3.4, 4);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}
