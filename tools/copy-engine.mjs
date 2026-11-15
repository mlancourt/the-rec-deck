// Copies the Stockfish engine (lite, single-threaded) out of node_modules into public/engine/
// so the page can load it as a same-origin Web Worker and the service worker can precache it.
// public/engine/ is gitignored: the engine's version is pinned by package-lock.json.

import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'node_modules/stockfish/bin');
const to = join(root, 'public/engine');
mkdirSync(to, { recursive: true });
for (const f of ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm']) copyFileSync(join(from, f), join(to, f));
copyFileSync(join(root, 'node_modules/stockfish/Copying.txt'), join(to, 'COPYING.txt'));
