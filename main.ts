// EMBERLINE — entry program for the make.fun three.js tactical FPS bounty.
//
// The game itself is the static site in game/ (ES modules, vendored three.js,
// no build step). This program is the hand-in: it copies game/ and
// screenshots/ into the output directory and writes dossier.json there with
// the kit's vendored library, so the bytes the scorer checks are exactly the
// bytes this repository holds. Outside the grader, MAKEFUN_OUTPUT_DIR names
// the output directory:
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const repoDir = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(outDir, { recursive: true });
cpSync(join(repoDir, 'game'), join(outDir, 'game'), { recursive: true });
mkdirSync(join(outDir, 'screenshots'), { recursive: true });
if (existsSync(join(repoDir, 'screenshots'))) {
  cpSync(join(repoDir, 'screenshots'), join(outDir, 'screenshots'), { recursive: true });
}

// The caps mirror the scorer's own limits: at most 4 screenshots of 256 KiB,
// at most 993 files and 48 MiB under game/, and the dossier text window.
const dossier = buildDossier(outDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
});
writeFileSync(join(outDir, 'dossier.json'), dossier);
