// The piece set: 16x16 pixel silhouettes, outlined and lit in code so every piece shares one light source.

import type { Color, PieceSymbol } from 'chess.js';
import type { Material, Palette } from './palette';

export const N = 16;

// Left halves (mirrored) for the symmetric pieces. 'o' = body, 'x' = dark detail.
const HALF: Record<Exclude<PieceSymbol, 'n'>, string[]> = {
  p: [
    '........',
    '........',
    '........',
    '........',
    '......oo',
    '.....ooo',
    '.....ooo',
    '......oo',
    '.....ooo',
    '......oo',
    '......oo',
    '.....ooo',
    '....oooo',
    '...ooooo',
    '...ooooo',
    '........',
  ],
  r: [
    '........',
    '........',
    '...oo.oo',
    '...oo.oo',
    '...ooooo',
    '...ooooo',
    '....oooo',
    '....oooo',
    '....oooo',
    '....oooo',
    '....oooo',
    '....oooo',
    '...ooooo',
    '..oooooo',
    '..oooooo',
    '........',
  ],
  b: [
    '........',
    '.......o',
    '......oo',
    '.....ooo',
    '....ooox',
    '....oooo',
    '....oooo',
    '.....ooo',
    '......oo',
    '.....ooo',
    '......oo',
    '......oo',
    '.....ooo',
    '...ooooo',
    '..oooooo',
    '........',
  ],
  q: [
    '........',
    '.......o',
    '..o..o.o',
    '..o..o.o',
    '..oo.ooo',
    '..oooooo',
    '...ooooo',
    '...ooooo',
    '....oooo',
    '....oooo',
    '.....ooo',
    '....oooo',
    '....oooo',
    '...ooooo',
    '..oooooo',
    '........',
  ],
  k: [
    '........',
    '.......o',
    '......oo',
    '.......o',
    '...oo.oo',
    '..oooooo',
    '..oooooo',
    '..oooooo',
    '...ooooo',
    '....oooo',
    '.....ooo',
    '....oooo',
    '....oooo',
    '...ooooo',
    '..oooooo',
    '........',
  ],
};

const KNIGHT: string[] = [
  '................',
  '.......oo.o.....',
  '......ooooo.....',
  '.....ooooooo....',
  '....oooxooooo...',
  '...ooooooooooo..',
  '..oooooooooooo..',
  '..ooooo.oooooo..',
  '...oo..ooooooo..',
  '......oooooooo..',
  '.....oooooooo...',
  '....oooooooo....',
  '....ooooooooo...',
  '...oooooooooo...',
  '..oooooooooooo..',
  '................',
];

const EMPTY = 0;
const LINE = 1;
const FILL = 2;
const SHADE = 3;
const HI = 4;
const DETAIL = 5;

function rows(type: PieceSymbol): string[] {
  if (type === 'n') return KNIGHT;
  return HALF[type].map((half) => half + [...half].reverse().join(''));
}

/** 16x16 codes: outline, body, shade (right/bottom edges), highlight (left/top edges), detail. */
function codes(type: PieceSymbol): Uint8Array {
  const src = rows(type);
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < N && y < N && (src[y] ?? '').charAt(x) !== '.';
  const out = new Uint8Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const ch = (src[y] ?? '').charAt(x);
      let v = EMPTY;
      if (ch === 'x') v = DETAIL;
      else if (ch === 'o') {
        if (!solid(x + 1, y) || !solid(x, y + 1)) v = SHADE;
        else if (!solid(x - 1, y) || !solid(x, y - 1)) v = HI;
        else v = FILL;
      } else if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) v = LINE;
      out[y * N + x] = v;
    }
  }
  return out;
}

function colourOf(code: number, m: Material): string {
  if (code === LINE) return m.line;
  if (code === SHADE) return m.shade;
  if (code === HI) return m.hi;
  if (code === DETAIL) return m.detail;
  return m.fill;
}

export interface Pixel {
  x: number;
  y: number;
  c: string;
}

export interface SpriteSet {
  image(color: Color, type: PieceSymbol): HTMLCanvasElement;
  flash(type: PieceSymbol): HTMLCanvasElement;
  pixels(color: Color, type: PieceSymbol): Pixel[];
}

const TYPES: PieceSymbol[] = ['p', 'n', 'b', 'r', 'q', 'k'];

export function buildSprites(pal: Palette): SpriteSet {
  const images = new Map<string, HTMLCanvasElement>();
  const lists = new Map<string, Pixel[]>();

  const paint = (key: string, px: Pixel[]) => {
    const cv = document.createElement('canvas');
    cv.width = N;
    cv.height = N;
    const g = cv.getContext('2d');
    if (g) {
      for (const p of px) {
        g.fillStyle = p.c;
        g.fillRect(p.x, p.y, 1, 1);
      }
    }
    images.set(key, cv);
  };

  for (const type of TYPES) {
    const grid = codes(type);
    for (const color of ['w', 'b'] as Color[]) {
      const m = color === 'w' ? pal.bone : pal.steel;
      const px: Pixel[] = [];
      grid.forEach((code, i) => {
        if (code !== EMPTY) px.push({ x: i % N, y: Math.floor(i / N), c: colourOf(code, m) });
      });
      lists.set(color + type, px);
      paint(color + type, px);
    }
    const lit: Pixel[] = [];
    grid.forEach((code, i) => {
      if (code !== EMPTY) lit.push({ x: i % N, y: Math.floor(i / N), c: pal.flash });
    });
    paint('f' + type, lit);
  }

  const need = (key: string): HTMLCanvasElement => {
    const cv = images.get(key);
    if (!cv) throw new Error(`no sprite ${key}`);
    return cv;
  };

  return {
    image: (color, type) => need(color + type),
    flash: (type) => need('f' + type),
    pixels: (color, type) => lists.get(color + type) ?? [],
  };
}
