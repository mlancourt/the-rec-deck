import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { LADDER, choose, toCands, type Bot, type Cand } from './bots';
import { fallback } from './engine';
import { tripwire } from './tripwire';

const cand = (uci: string, cp: number, extra: Partial<Cand> = {}): Cand => ({ uci, cp, piece: 'p', check: false, castle: false, ...extra });
const bot = (i: number): Bot => {
  const b = LADDER[i];
  if (!b) throw new Error('no such rung');
  return b;
};
/** rnd() that replays a fixed list, then 0.5 forever. */
const script = (...vals: number[]) => () => vals.shift() ?? 0.5;

describe('the ladder', () => {
  it('has five rungs, coins never increasing as you climb', () => {
    expect(LADDER).toHaveLength(5);
    const coins = LADDER.map((b) => b.coins);
    expect([...coins].sort((a, b) => b - a)).toEqual(coins);
  });

  it('plays the best move when it is not blundering and has no taste', () => {
    const turtle = { ...bot(3), noise: 0 };
    const pick = choose(turtle, [cand('a2a3', 10), cand('e2e4', 40), cand('h2h4', -300)], 4, script(0.99));
    expect(pick?.uci).toBe('e2e4');
  });

  it('blunders inside its window, never outside it', () => {
    const deckhand = { ...bot(0), noise: 0 };
    const cands = [cand('best', 50), cand('slip', -200), cand('disaster', -1500)];
    // noise draws (3), then the blunder roll
    const pick = choose(deckhand, cands, 10, script(0.5, 0.5, 0.5, 0));
    expect(pick?.uci).toBe('slip');
  });

  it('Magpie takes material it is offered, within its slack', () => {
    const magpie = { ...bot(1), noise: 0 };
    const cands = [cand('quiet', 30), cand('grab', -120, { captured: 'n' }), cand('poison', -900, { captured: 'q' })];
    const pick = choose(magpie, cands, 10, script(0.5, 0.5, 0.5, 0.99));
    expect(pick?.uci).toBe('grab');
  });

  it('Hotshot brings the queen out early, then stops caring', () => {
    const hotshot = { ...bot(2), noise: 0 };
    const cands = [cand('develop', 30, { piece: 'n' }), cand('queen', -40, { piece: 'q' })];
    expect(choose(hotshot, cands, 3, script(0.5, 0.5, 0.99))?.uci).toBe('queen');
    expect(choose(hotshot, cands, 30, script(0.5, 0.5, 0.99))?.uci).toBe('develop');
  });

  it('takes a forced mate unless it fails to see it', () => {
    const cands = [cand('mate', 9990), cand('other', 0)];
    expect(choose(bot(3), cands, 20, script(0.5))?.uci).toBe('mate');
  });

  it('drops engine lines that are not legal moves', () => {
    const fen = new Chess().fen();
    const out = toCands(fen, [{ uci: 'e2e4', cp: 20 }, { uci: 'e2e5', cp: 99 }]);
    expect(out.map((c) => c.uci)).toEqual(['e2e4']);
    expect(out[0]?.piece).toBe('p');
  });
});

describe('tripwire', () => {
  it('stays quiet on a sound opening move', () => {
    expect(tripwire(new Chess().fen(), { from: 'e2', to: 'e4' })).toBeNull();
  });

  it('catches a piece left to be taken for free', () => {
    // 1.e4 e5 2.Nf3 Nc6 — White plays Nxe5?? and the c6 knight takes it.
    const g = new Chess();
    for (const s of ['e4', 'e5', 'Nf3', 'Nc6']) g.move(s);
    const w = tripwire(g.fen(), { from: 'f3', to: 'e5' });
    expect(w?.kind).toBe('hang');
    expect(w?.piece).toBe('n');
    expect(w?.square).toBe('e5');
  });

  it('does not fire on an even trade', () => {
    const g = new Chess();
    for (const s of ['e4', 'd5']) g.move(s);
    expect(tripwire(g.fen(), { from: 'e4', to: 'd5' })).toBeNull();
  });

  it("catches walking into mate in one (fool's mate)", () => {
    const g = new Chess();
    for (const s of ['f3', 'e5']) g.move(s);
    expect(tripwire(g.fen(), { from: 'g2', to: 'g4' })?.kind).toBe('mate');
  });

  it('returns null for an illegal move', () => {
    expect(tripwire(new Chess().fen(), { from: 'e2', to: 'e5' })).toBeNull();
  });
});

describe('fallback engine', () => {
  it('finds mate in one', () => {
    const g = new Chess();
    for (const s of ['f3', 'e5', 'g4']) g.move(s);
    expect(fallback(g.fen()).best).toBe('d8h4');
  });

  it('takes a free queen', () => {
    expect(fallback('4k3/8/8/3q4/4P3/8/8/4K3 w - - 0 1').best).toBe('e4d5');
  });
});
