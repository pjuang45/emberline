// EMBERLINE entry point: builds the renderer and world, wires the UI flow
// (start overlay, buy menu, pointer lock, match end), and runs the game as
// a fixed-step simulation with rendering on top. Simulation steps are
// always 1/60 s however fast the display is, so the game plays identically
// on a 60 Hz laptop and a 144 Hz monitor.

import * as THREE from 'three';
import { G, mulberry32 } from './state.js';
import { buildWorld } from './world.js';
import { initAudio } from './audio.js';
import { initInput, input, requestLock, releaseLock, endFrameInput } from './input.js';
import { initMatch, startMatch, updateRounds } from './rounds.js';
import { updatePlayer } from './player.js';
import { updateBot } from './bots.js';
import { initWeapons, updateWeapons, initViewmodel, poseViewmodel, viewShake, recoil } from './weapons.js';
import { syncActorMesh, eyeHeight } from './actors.js';
import { initHUD, updateHUD, openBuy, closeBuy, buyKeyStep } from './hud.js';
import { poseShot, tickShot } from './shots.js';

const STEP = 1 / 60;
const params = new URLSearchParams(location.search);
// ?debug=1 exposes the state for automated smoke tests; normal play never
// sets it and nothing in the game reads it back
if (params.get('debug')) window.__ember = { G };
const shotMode = params.get('shot');
if (params.get('seed')) G.rand = mulberry32(Number(params.get('seed')) || 1);
if (shotMode) G.shotMode = shotMode;

const container = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.08, 220);
camera.rotation.order = 'YXZ';
scene.add(camera);

buildWorld(scene);
initWeapons(scene);
initViewmodel(camera);
initMatch(scene);
initHUD();

const overlay = document.getElementById('overlay');
const playBtn = document.getElementById('play');
const matchend = document.getElementById('matchend');
const endTitle = document.getElementById('end-title');
const endCopy = document.getElementById('end-copy');

let lastPhase = G.phase;
let spectateIdx = -1;

initInput(renderer.domElement, (locked) => {
  // losing the lock mid-round (Esc, alt-tab) parks the game behind the
  // overlay; the buy menu and the match end own the cursor legitimately
  if (!locked && G.started && !G.buyOpen && G.phase !== 'matchover' && !shotMode) {
    playBtn.textContent = 'CLICK TO CONTINUE';
    overlay.hidden = false;
  }
  if (locked) overlay.hidden = true;
});

playBtn.addEventListener('click', () => {
  initAudio();
  if (!G.started) {
    G.started = true;
    startMatch();
  }
  overlay.hidden = true;
  if (G.phase === 'buy' && G.player.alive) openBuy();
  else requestLock();
});

document.getElementById('buy-close').addEventListener('click', () => {
  closeBuy();
  requestLock();
});
document.getElementById('again').addEventListener('click', () => {
  matchend.hidden = true;
  startMatch();
  if (G.phase === 'buy') openBuy();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- screenshot mode: pose once, render the held frame ----------------------
if (shotMode) {
  G.started = true;
  startMatch();
  poseShot(shotMode, camera);
  overlay.hidden = shotMode !== 'start';
  if (shotMode === 'buy') openBuy();
  let t = 0;
  renderer.setAnimationLoop(() => {
    t += 1 / 60;
    G.time += 1 / 60;
    for (const a of G.actors) syncActorMesh(a, 1 / 60);
    tickShot(shotMode, camera, t);
    if (shotMode !== 'start') poseCamera(1 / 60);
    poseViewmodel(G.player, 1 / 60);
    updateHUD();
    renderer.render(scene, camera);
  });
} else {
  let last = performance.now();
  let acc = 0;
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.1) dt = 0.1;
    acc += dt;
    while (acc >= STEP) {
      acc -= STEP;
      if (G.started) stepSim(STEP);
    }
    for (const a of G.actors) syncActorMesh(a, dt);
    poseCamera(dt);
    poseViewmodel(G.player, dt);
    updateHUD();
    renderer.render(scene, camera);
    endFrameInput();
  });
}

function stepSim(dt) {
  G.time += dt;
  // phase transitions drive the buy menu and the match-end screen
  if (G.phase !== lastPhase) {
    if (G.phase === 'buy' && G.player.alive && G.started) {
      openBuy();
      releaseLock();
    }
    if (G.phase === 'live') {
      if (G.buyOpen) closeBuy();
      // the buy window timed out while the menu held the cursor: hand the
      // player the click-to-continue overlay so they can re-lock
      if (G.started && !input.locked && !shotMode && overlay.hidden) {
        playBtn.textContent = 'CLICK TO CONTINUE';
        overlay.hidden = false;
      }
    }
    if (G.phase === 'matchover') {
      closeBuy();
      releaseLock();
      const won = G.matchWinner === 'us';
      endTitle.textContent = won ? 'VICTORY' : 'DEFEAT';
      endCopy.textContent = `Final score — Jackals ${G.score.us}, Wardens ${G.score.them}. ${won ? 'The foundry is yours.' : 'The foundry holds. Run it back.'}`;
      matchend.hidden = false;
    }
    lastPhase = G.phase;
  }

  if (input.pressed.has('KeyB') && G.phase === 'buy') {
    if (G.buyOpen) { closeBuy(); requestLock(); }
    else { openBuy(); releaseLock(); }
  }

  if (G.buyOpen) buyKeyStep();
  else if (input.locked) updatePlayer(dt);

  for (const a of G.actors) if (!a.isPlayer) updateBot(a, dt);
  updateWeapons(dt);
  updateRounds(dt);
}

// Camera: the player's eyes while alive; a teammate's eyes while dead
// (click cycles the squad). Shot mode poses the player like anyone else.
function poseCamera(dt) {
  const p = G.player;
  if (!p) return;
  let subject = p;
  if (!p.alive && G.phase !== 'matchover') {
    const mates = G.actors.filter((a) => a.team === 'us' && a.alive && !a.isPlayer);
    if (mates.length) {
      if (spectateIdx < 0 || !mates.includes(G.actors[spectateIdx])) spectateIdx = mates[0].idx;
      if (input.clicked && input.locked) {
        const cur = mates.findIndex((a) => a.idx === spectateIdx);
        spectateIdx = mates[(cur + 1) % mates.length].idx;
      }
      subject = G.actors[spectateIdx];
    }
  }
  const eye = subject.pos.y + eyeHeight(subject);
  camera.position.set(subject.pos.x, eye, subject.pos.z);
  let shakeX = 0, shakeY = 0;
  if (viewShake.t > 0 && subject === p) {
    const m = viewShake.mag * (viewShake.t / 0.35);
    shakeX = (Math.random() - 0.5) * m * 0.14;
    shakeY = (Math.random() - 0.5) * m * 0.14;
  }
  // recoil is a view offset for the player only: it moves the camera, and
  // the bullets follow it (see lookDir in player.js)
  camera.rotation.set(
    subject.pitch + (subject === p ? recoil.pitch : 0) + shakeY,
    subject.yaw + (subject === p ? recoil.yaw : 0),
    shakeX,
  );
  const targetFov = 74 / (subject === p ? (G.aimZoom || 1) : 1);
  if (Math.abs(camera.fov - targetFov) > 0.05) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 14);
    camera.updateProjectionMatrix();
  }
}
