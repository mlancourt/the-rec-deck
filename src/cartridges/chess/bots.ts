// The ladder. Each opponent is the same engine with a different taste and a different rate of mistakes.

import { Chess, type PieceSymbol } from 'chess.js';
import type { Line } from './engine';
import { WORTH } from './tripwire';

export interface Cand {
  uci: string;
  cp: number;
  piece: PieceSymbol;
  captured?: PieceSymbol;
  check: boolean;
  castle: boolean;
}

export interface Bot {
  name: string;
  /** How to beat it, in one line. Shown on the ladder. */
  tell: string;
  coins: number;
  tripwire: boolean;
  depth: number;
  multipv: number;
  /** Set = let the engine play at this rating and take its move as is. */
  elo?: number;
  /** Chance per move of picking a deliberately worse move. */
  blunder: number;
  /** How bad that worse move may be, in centipawns lost. */
  window: [number, number];
  /** On a normal move, how much it will give up to follow its taste. */
  slack: number;
  noise: number;
  /** Chance of not seeing its own forced mate. */
  missMate: number;
  style(c: Cand, ply: number): number;
}

export const LADDER: Bot[] = [
  {
    name: 'DECKHAND',
    tell: 'New to the board. Leaves pieces unguarded: look for anything you can take for free.',
    coins: 3,
    tripwire: true,
    depth: 6,
    multipv: 10,
    blunder: 0.38,
    window: [120, 900],
    slack: 150,
    noise: 80,
    missMate: 0.5,
    style: () => 0,
  },
  {
    name: 'MAGPIE',
    tell: 'Grabs anything it can take. Guard your pieces, and offer bait it should not touch.',
    coins: 3,
    tripwire: true,
    depth: 6,
    multipv: 10,
    blunder: 0.22,
    window: [100, 500],
    slack: 220,
    noise: 40,
    missMate: 0.25,
    style: (c) => (c.captured ? 60 * WORTH[c.captured] : 0),
  },
  {
    name: 'HOTSHOT',
    tell: 'Brings the queen out early and swings at your king. Develop, castle, and chase the queen.',
    coins: 2,
    tripwire: true,
    depth: 7,
    multipv: 8,
    blunder: 0.14,
    window: [90, 350],
    slack: 160,
    noise: 30,
    missMate: 0.1,
    style: (c, ply) => (c.piece === 'q' && ply < 16 ? 110 : 0) + (c.check ? 90 : 0),
  },
  {
    name: 'THE TURTLE',
    tell: 'Castles, trades, and waits. It will not beat itself: you need a plan.',
    coins: 2,
    tripwire: false,
    depth: 8,
    multipv: 6,
    blunder: 0.08,
    window: [70, 220],
    slack: 60,
    noise: 15,
    missMate: 0,
    style: (c) => (c.castle ? 120 : 0) + (c.captured && WORTH[c.captured] === WORTH[c.piece] ? 40 : 0),
  },
  {
    name: 'THE ADMIRAL',
    tell: 'Plays it straight. No gifts.',
    coins: 1,
    tripwire: false,
    depth: 10,
    multipv: 1,
    elo: 1320,
    blunder: 0,
    window: [0, 0],
    slack: 0,
    noise: 0,
    missMate: 0,
    style: () => 0,
  },
];

/** Attach what the persona needs to know about each engine line. Lines that aren't legal are dropped. */
export function toCands(fen: string, lines: Line[]): Cand[] {
  const g = new Chess(fen);
  const legal = g.moves({ verbose: true });
  const out: Cand[] = [];
  for (const l of lines) {
    const m = legal.find((x) => x.from + x.to + (x.promotion ?? '') === l.uci);
    if (!m) continue;
    out.push({
      uci: l.uci,
      cp: l.cp,
      piece: m.piece,
      captured: m.captured,
      check: /[+#]$/.test(m.san),
      castle: m.isKingsideCastle() || m.isQueensideCastle(),
    });
  }
  return out;
}

const clamp = (cp: number) => Math.max(-2000, Math.min(2000, cp));

/** Pick the persona's move. `rnd` is injected so this stays testable. */
export function choose(bot: Bot, cands: Cand[], ply: number, rnd: () => number): Cand | null {
  if (!cands.length) return null;
  const best = cands.reduce((a, b) => (b.cp > a.cp ? b : a));
  if (cands.length === 1) return best;
  if (best.cp > 9000 && rnd() >= bot.missMate) return best;

  const loss = (c: Cand) => clamp(best.cp) - clamp(c.cp);
  const taste = new Map<Cand, number>();
  for (const c of cands) taste.set(c, bot.style(c, ply) + (rnd() * 2 - 1) * bot.noise);
  const top = (pool: Cand[], score: (c: Cand) => number) => pool.reduce((a, b) => (score(b) > score(a) ? b : a));

  if (rnd() < bot.blunder) {
    const pool = cands.filter((c) => loss(c) >= bot.window[0] && loss(c) <= bot.window[1]);
    if (pool.length) return top(pool, (c) => taste.get(c) ?? 0);
  }
  const sane = cands.filter((c) => loss(c) <= bot.slack);
  return top(sane.length ? sane : [best], (c) => (taste.get(c) ?? 0) - loss(c));
}
