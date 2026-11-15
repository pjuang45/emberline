# EMBERLINE — a three.js tactical FPS

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/pjuang45/emberline/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/pjuang45/emberline/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

A round-based tactical shooter in the Counter-Strike mould, built from scratch on three.js 0.187: two teams of four, short rounds, a charge to plant and defuse, money between rounds and a buy menu, and gunplay where stopping to aim is how you hit anything.

You lead the **Jackals** into Foundry Nine, a derelict desert foundry with two plant sites — the Kiln Yard and the Vault — a furnace hall in the middle and a lane down each flank. Carry the charge to a site, plant it (3.5 s), and hold for 35 s — or wipe the **Wardens** out. They hold angles, rotate on gunfire they hear, retake planted sites and defuse. First team to 7 rounds takes the foundry.

## The game

- **Gunplay with a point of view.** Hitscan against head/torso/leg hitboxes (headshots ×4), distance falloff per weapon, spread that blooms while you run, jump or spray, recoil that kicks the view, and a crosshair that shows the true spread. Crouch and counter-strafe to shoot straight.
- **Five weapons, three grenades.** Sparrow P9 sidearm, Rook-9 SMG, Boar-12 shotgun, Kestrel AR, Osprey bolt-action DMR with a scoped right-click — plus frag, flash and smoke grenades, all bought with round money (kills $300, round win $1,400).
- **Bots with ears.** Squad AI on a navigation grid (A* with line-of-sight smoothing): defenders hold site angles and rotate on information, attackers push a chosen site down mid or the flank, plant, and set up the post-plant. Gunfire and running feet are noises they react to; walking is silent.
- **A real match loop.** Buy phase → live round (100 s) → plant/defuse → round end → next round, first to 7, with a killfeed, round timer, minimap with spotted-enemy markers, spectating after death, and fully synthesised WebAudio sound — no audio files.
- **Fixed-step simulation.** The world advances in 1/60 s steps decoupled from rendering; state lives in one place (`src/state.js`) and each module has one job.

## Play it

```sh
node serve.ts            # serves game/ at http://localhost:8080
```

Open the page, click DEPLOY, buy with the number keys or the mouse, and play. WASD moves, Shift walks, Ctrl crouches, R reloads, B reopens the buy menu during the buy phase, E (hold) plants, 1/2 switch weapons, 3/4/5 throw frag/flash/smoke, right-click scopes the Osprey.

## Layout

- `game/` — the game itself: static ES modules, no build step. `game/index.html` is the page and HUD; `game/src/` holds the modules (`world`, `movement`, `player`, `bots`, `weapons`, `rounds`, `hud`, `audio`, `input`, `actors`, `config`, `state`, `shots`); `game/vendor/three/` is three.js 0.187.0, vendored.
- `main.ts` — the hand-in program: copies `game/` and `screenshots/` to the output directory and writes `dossier.json` with the kit's vendored library.
- `screenshots/` — four real renders of the game, captured from its own `?shot=` poses.

---

<sub>Entered on [make.fun](https://make.fun/?ref=mszj4wxd&utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards</sub>
