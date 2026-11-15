// Stockfish in a Web Worker, behind one call: analyse(fen) -> candidate moves with scores.
// If the engine can't load, a small built-in search answers instead, so the game always plays.

import { Chess, type Color, type PieceSymbol } from 'chess.js';

export const MATE = 10000;

export interface Line {
  uci: string;
  /** Centipawns from the side to move. Forced mates sit near +/-MATE. */
  cp: number;
}

export interface Analysis {
  best: string;
  lines: Line[];
}

export interface AnalyseOpts {
  depth: number;
  multipv: number;
  elo?: number;
}

const VALUE: Record<PieceSymbol, number> = { p: 100, n: 300, b: 310, r: 500, q: 900, k: 0 };

function material(g: Chess, me: Color): number {
  let s = 0;
  for (const row of g.board()) for (const p of row) if (p) s += p.color === me ? VALUE[p.type] : -VALUE[p.type];
  return s;
}

function centre(sq: string): number {
  const f = sq.charCodeAt(0) - 97;
  const r = Number(sq.charAt(1)) - 1;
  return 12 - 3 * (Math.abs(f - 3.5) + Math.abs(r - 3.5));
}

/** Two-ply material search. Weak, but legal, instant, and never hangs a queen in one. */
export function fallback(fen: string): Analysis {
  const g = new Chess(fen);
  const me = g.turn();
  const out: Line[] = [];
  for (const m of g.moves({ verbose: true })) {
    g.move({ from: m.from, to: m.to, promotion: m.promotion });
    let score: number;
    if (g.isCheckmate()) score = MATE - 10;
    else if (g.isDraw()) score = 0;
    else {
      let worst = Infinity;
      for (const r of g.moves({ verbose: true })) {
        g.move({ from: r.from, to: r.to, promotion: r.promotion });
        const s = g.isCheckmate() ? -MATE + 20 : material(g, me);
        g.undo();
        if (s < worst) worst = s;
      }
      score = worst + centre(m.to);
    }
    g.undo();
    out.push({ uci: m.from + m.to + (m.promotion ?? ''), cp: score });
  }
  out.sort((a, b) => b.cp - a.cp);
  return { best: out[0]?.uci ?? '', lines: out.slice(0, 12) };
}

export class Engine {
  readonly ready: Promise<boolean>;
  private w: Worker | null = null;
  private listener: ((line: string) => void) | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(url: string) {
    this.ready = new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (!ok) this.kill();
        resolve(ok);
      };
      const timer = setTimeout(() => finish(false), 12000);
      try {
        const w = new Worker(url);
        this.w = w;
        w.onerror = () => finish(false);
        w.onmessage = (ev: MessageEvent) => {
          const line = typeof ev.data === 'string' ? ev.data : '';
          if (line === 'uciok') w.postMessage('isready');
          else if (line === 'readyok') finish(true);
          else this.listener?.(line);
        };
        w.postMessage('uci');
      } catch {
        finish(false);
      }
    });
  }

  /** True while the real engine is answering (the fallback can't do a review). */
  get live(): boolean {
    return this.w !== null;
  }

  analyse(fen: string, o: AnalyseOpts): Promise<Analysis> {
    const run = async (): Promise<Analysis> => {
      await this.ready;
      const w = this.w;
      if (!w) return fallback(fen);
      return new Promise<Analysis>((resolve) => {
        const lines = new Map<number, Line>();
        const timer = setTimeout(() => {
          this.kill();
          resolve(fallback(fen));
        }, 20000);
        this.listener = (s) => {
          if (s.startsWith('info ') && s.includes(' pv ')) {
            const sc = /score (cp|mate) (-?\d+)/.exec(s);
            const pv = / pv (\S+)/.exec(s);
            const k = /multipv (\d+)/.exec(s);
            if (sc && pv) {
              const v = Number(sc[2]);
              const cp = sc[1] === 'cp' ? v : v > 0 ? MATE - v * 10 : -MATE - v * 10;
              lines.set(k ? Number(k[1]) : 1, { uci: pv[1] ?? '', cp });
            }
          } else if (s.startsWith('bestmove')) {
            clearTimeout(timer);
            this.listener = null;
            const best = s.split(' ')[1] ?? '';
            if (!best || best === '(none)') {
              resolve(fallback(fen));
              return;
            }
            const out = [...lines.entries()].sort((a, b) => a[0] - b[0]).map(([, l]) => l);
            resolve({ best, lines: out.length ? out : [{ uci: best, cp: 0 }] });
          }
        };
        w.postMessage(`setoption name MultiPV value ${o.multipv}`);
        w.postMessage(`setoption name UCI_LimitStrength value ${o.elo ? 'true' : 'false'}`);
        if (o.elo) w.postMessage(`setoption name UCI_Elo value ${o.elo}`);
        w.postMessage(`position fen ${fen}`);
        w.postMessage(`go depth ${o.depth}`);
      });
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => undefined);
    return p;
  }

  quit(): void {
    this.kill();
  }

  private kill(): void {
    this.listener = null;
    try {
      this.w?.terminate();
    } catch {
      /* already gone */
    }
    this.w = null;
  }
}
