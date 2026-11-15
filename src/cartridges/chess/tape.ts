// The Tape: after a game, the engine looks at every position and we point at the three moves
// that cost the most. Engine only. The coach's prose comes later, on top of this.

import { Chess, type Color } from 'chess.js';
import { MATE, type Engine } from './engine';
import { NAME, tripwire } from './tripwire';

export interface Note {
  /** Index of the move in the game (0 = White's first). */
  ply: number;
  san: string;
  loss: number;
  label: string;
  bestUci: string | null;
  bestSan: string | null;
}

export interface Tape {
  fens: string[];
  sans: string[];
  ucis: string[];
  /** Engine score before each ply and after the last, from the player's side. */
  score: number[];
  notes: Note[];
  accuracy: number;
}

const DEPTH = 8;
const cap = (cp: number) => Math.max(-1200, Math.min(1200, cp));

function label(fen: string, uci: string, best: string | null, before: number, after: number): { text: string; bestSan: string | null } {
  const g = new Chess(fen);
  const legal = g.moves({ verbose: true });
  const b = best ? legal.find((m) => m.from + m.to + (m.promotion ?? '') === best) : undefined;
  const bestSan = b ? b.san : null;
  if (after <= -9000 && before > -9000) return { text: 'Walked into a forced mate', bestSan };
  if (before >= 9000 && after < 9000) return { text: 'Missed a forced mate', bestSan };
  const w = tripwire(fen, { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined });
  if (w?.kind === 'hang' && w.piece && w.square) return { text: `Left your ${NAME[w.piece]} on ${w.square} to be taken`, bestSan };
  if (b?.captured) return { text: `Missed taking the ${NAME[b.captured]}`, bestSan };
  return { text: 'Lost ground', bestSan };
}

/** Run the review. Returns null if cancelled. */
export async function buildTape(
  engine: Engine,
  sans: string[],
  me: Color,
  progress: (done: number, total: number) => void,
  alive: () => boolean,
): Promise<Tape | null> {
  const g = new Chess();
  const fens = [g.fen()];
  const ucis: string[] = [];
  for (const san of sans) {
    const m = g.move(san);
    ucis.push(m.from + m.to + (m.promotion ?? ''));
    fens.push(g.fen());
  }

  const score: number[] = [];
  const best: (string | null)[] = [];
  for (let i = 0; i < fens.length; i++) {
    const pos = new Chess(fens[i]);
    const mine = pos.turn() === me;
    if (pos.isGameOver()) {
      score.push(pos.isCheckmate() ? (mine ? -MATE : MATE) : 0);
      best.push(null);
    } else {
      const a = await engine.analyse(fens[i] ?? '', { depth: DEPTH, multipv: 1 });
      if (!alive()) return null;
      const top = a.lines[0];
      const cp = top ? top.cp : 0;
      score.push(mine ? cp : -cp);
      best.push(top ? top.uci : a.best);
    }
    progress(i + 1, fens.length);
  }

  const all: Note[] = [];
  let sum = 0;
  let count = 0;
  for (let i = 0; i < sans.length; i++) {
    if (new Chess(fens[i]).turn() !== me) continue;
    const before = score[i] ?? 0;
    const after = score[i + 1] ?? 0;
    const uci = ucis[i] ?? '';
    const loss = uci === best[i] ? 0 : Math.max(0, cap(before) - cap(after));
    sum += 100 * Math.exp(-loss / 300);
    count += 1;
    if (loss < 90) continue;
    const l = label(fens[i] ?? '', uci, best[i] ?? null, before, after);
    all.push({ ply: i, san: sans[i] ?? '', loss, label: l.text, bestUci: best[i] ?? null, bestSan: l.bestSan });
  }
  const notes = all
    .sort((a, b) => b.loss - a.loss)
    .slice(0, 3)
    .sort((a, b) => a.ply - b.ply);
  return { fens, sans, ucis, score, notes, accuracy: count ? Math.round(sum / count) : 100 };
}

/** "12. Nf3" / "12... Nf6" */
export function moveLabel(ply: number, san: string): string {
  return `${Math.floor(ply / 2) + 1}${ply % 2 === 0 ? '.' : '...'} ${san}`;
}
