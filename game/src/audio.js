// EMBERLINE audio: every sound is synthesised with WebAudio — no files, no
// network. Gunshots are filtered noise bursts with a low thump, the charge
// beeps on a square oscillator, the explosion is a long noise swell. The
// context is created on the first user gesture (the DEPLOY click), as
// browsers require.

let ctx = null;
let master = null;
let noiseBuf = null;

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.42;
  master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
}

function noise(dur, filterType, freq, q, gainPeak, when = 0, sweepTo = null) {
  if (!ctx) return;
  const t0 = ctx.currentTime + when;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = filterType; f.frequency.setValueAtTime(freq, t0); f.Q.value = q;
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gainPeak, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t0); src.stop(t0 + dur + 0.05);
}

function tone(type, freq, dur, gainPeak, when = 0, sweepTo = null) {
  if (!ctx) return;
  const t0 = ctx.currentTime + when;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (sweepTo) o.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gainPeak, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g); g.connect(master);
  o.start(t0); o.stop(t0 + dur + 0.05);
}

// Distance attenuation for world sounds: full volume at the muzzle, a
// quarter at 30 m. Callers pass the distance from the listener.
function att(dist) {
  return Math.max(0.04, Math.min(1, 9 / (9 + dist)));
}

const SHOT_PROFILES = {
  pistol: { freq: 1500, dur: 0.13, thump: 150, gain: 0.5 },
  smg: { freq: 1700, dur: 0.1, thump: 170, gain: 0.42 },
  shotgun: { freq: 750, dur: 0.3, thump: 95, gain: 0.8 },
  rifle: { freq: 1250, dur: 0.16, thump: 130, gain: 0.6 },
  dmr: { freq: 950, dur: 0.34, thump: 80, gain: 0.85 },
};

export function sfxShot(kind, dist = 0) {
  const p = SHOT_PROFILES[kind] ?? SHOT_PROFILES.rifle;
  const a = att(dist);
  noise(p.dur, 'bandpass', p.freq, 0.7, p.gain * a);
  tone('triangle', p.thump, p.dur * 0.8, 0.5 * a, 0, p.thump * 0.5);
}

export function sfxDryFire() { tone('square', 1900, 0.03, 0.12); }
export function sfxReload() {
  noise(0.05, 'highpass', 2500, 1, 0.16);
  noise(0.05, 'highpass', 1800, 1, 0.2, 0.22);
  tone('square', 700, 0.04, 0.1, 0.5);
}
export function sfxHit(kill) {
  tone('square', kill ? 620 : 880, kill ? 0.14 : 0.05, 0.16);
  if (kill) tone('square', 415, 0.16, 0.14, 0.05);
}
export function sfxHurt() { noise(0.12, 'lowpass', 500, 1, 0.4); tone('sine', 110, 0.14, 0.3, 0, 60); }
export function sfxStep(run, dist = 0) {
  noise(0.05, 'lowpass', run ? 700 : 480, 0.8, (run ? 0.13 : 0.06) * att(dist));
}
export function sfxJump() { noise(0.06, 'lowpass', 600, 1, 0.1); }
export function sfxThrow() { noise(0.14, 'bandpass', 900, 1, 0.1, 0, 300); }
export function sfxFragBoom(dist = 0) {
  const a = att(dist);
  noise(0.7, 'lowpass', 900, 0.6, 0.95 * a, 0, 90);
  tone('sine', 68, 0.6, 0.8 * a, 0, 34);
}
export function sfxFlashPop(dist = 0) {
  const a = att(dist);
  noise(0.07, 'highpass', 3000, 1, 0.5 * a);
  tone('sine', 2400, 0.3, 0.1 * a, 0, 1900);
}
export function sfxSmokeHiss(dist = 0) { noise(0.8, 'highpass', 4200, 0.7, 0.1 * att(dist)); }
export function sfxChargeBeep(final = false) {
  tone('square', final ? 1560 : 1180, final ? 0.3 : 0.09, 0.14);
}
export function sfxExplosion() {
  noise(1.6, 'lowpass', 1100, 0.5, 1.0, 0, 55);
  tone('sine', 55, 1.4, 0.95, 0, 26);
  noise(0.3, 'bandpass', 2000, 0.8, 0.4, 0.02);
}
export function sfxSting(win) {
  const base = win ? [392, 494, 587] : [330, 262, 196];
  base.forEach((f, i) => tone('triangle', f, 0.34, 0.16, i * 0.11));
}
export function sfxBuy() { tone('square', 1320, 0.05, 0.1); tone('square', 1760, 0.07, 0.1, 0.06); }
export function sfxDenied() { tone('square', 220, 0.09, 0.12); }
export function sfxPlantTick() { tone('square', 980, 0.04, 0.1); }
