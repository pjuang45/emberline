// EMBERLINE input: keyboard state, mouse look through pointer lock, and an
// edge-triggered press set the simulation polls once per frame. Nothing
// here knows the game rules — it only reports what the human is doing.

export const input = {
  keys: Object.create(null),   // held, by KeyboardEvent.code
  pressed: new Set(),          // went down since the last frame (edge)
  mouseDX: 0, mouseDY: 0,      // accumulated look movement, pixels
  firing: false,               // left mouse held
  clicked: false,              // left mouse went down this frame
  aiming: false,               // right mouse held (Osprey scope)
  locked: false,               // pointer lock engaged
};

let lockTarget = null;
let onLockChange = null;

export function initInput(element, lockChangeCb) {
  lockTarget = element;
  onLockChange = lockChangeCb;

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
    if (!e.repeat) input.pressed.add(e.code);
    input.keys[e.code] = true;
  });
  window.addEventListener('keyup', (e) => { input.keys[e.code] = false; });
  window.addEventListener('blur', () => {
    for (const k in input.keys) input.keys[k] = false;
    input.firing = false;
  });

  document.addEventListener('pointerlockchange', () => {
    input.locked = document.pointerLockElement === lockTarget;
    if (!input.locked) { input.firing = false; input.aiming = false; }
    if (onLockChange) onLockChange(input.locked);
  });
  document.addEventListener('mousemove', (e) => {
    if (!input.locked) return;
    input.mouseDX += e.movementX || 0;
    input.mouseDY += e.movementY || 0;
  });
  document.addEventListener('mousedown', (e) => {
    if (!input.locked) return;
    if (e.button === 0) { input.firing = true; input.clicked = true; }
    if (e.button === 2) input.aiming = true;
  });
  document.addEventListener('mouseup', (e) => {
    if (e.button === 0) input.firing = false;
    if (e.button === 2) input.aiming = false;
  });
  document.addEventListener('contextmenu', (e) => e.preventDefault());
}

export function requestLock() {
  if (lockTarget && !input.locked) lockTarget.requestPointerLock();
}

export function releaseLock() {
  if (input.locked) document.exitPointerLock();
}

// Called by main.js after each rendered frame: edges and look deltas are
// per-frame, held keys persist.
export function endFrameInput() {
  input.pressed.clear();
  input.clicked = false;
  input.mouseDX = 0;
  input.mouseDY = 0;
}
