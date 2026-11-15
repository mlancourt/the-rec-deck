// Screens and flow: the ladder, a game, the end panel, the tape.
// Storage, network and the scoreboard belong to the shell; this file only asks ctx for them.

import { Chess, type Color, type Move, type PieceSymbol, type Square } from 'chess.js';
import type { CartridgeContext, Outcome } from '../../shell/contract';
import { BoardView, type Arrow, type Drop, type MoveFx, type Pc, type Trays } from './board';
import { LADDER, choose, toCands } from './bots';
import { Engine } from './engine';
import { alpha, buildPalette } from './palette';
import { makeSfx } from './sfx';
import { buildSprites } from './sprites';
import { buildTape, moveLabel, type Tape } from './tape';
import { tripwire, type MoveInput } from './tripwire';

const ENGINE_URL = `${import.meta.env.BASE_URL}engine/stockfish-19-lite-single.js`;
const PLAYER = 'MAT';
const THINK_MS = 550;

interface Current {
  rung: number;
  color: Color;
  sans: string[];
  coins: number;
  used: number;
  elapsed: number;
}

interface Save {
  v: 1;
  unlocked: number;
  wins: number[];
  games: number[];
  current: Current | null;
}

interface Final {
  rung: number;
  color: Color;
  sans: string[];
}

type Kid = Node | string | null | false | undefined;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k of kids) if (k) e.append(k);
  return e;
}

function button(label: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', `rdc-btn ${cls}`.trim(), label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

function loadSave(ctx: CartridgeContext): Save {
  const raw = ctx.save.read<Partial<Save>>();
  const n = LADDER.length;
  const nums = (a: unknown): number[] =>
    Array.from({ length: n }, (_, i) => (Array.isArray(a) && typeof a[i] === 'number' ? (a[i] as number) : 0));
  const c = raw?.current;
  const ok =
    c &&
    typeof c.rung === 'number' &&
    c.rung >= 0 &&
    c.rung < n &&
    (c.color === 'w' || c.color === 'b') &&
    Array.isArray(c.sans) &&
    c.sans.every((s) => typeof s === 'string') &&
    typeof c.coins === 'number' &&
    typeof c.used === 'number' &&
    typeof c.elapsed === 'number';
  const unlocked = typeof raw?.unlocked === 'number' ? Math.max(0, Math.min(n - 1, Math.floor(raw.unlocked))) : 0;
  return { v: 1, unlocked, wins: nums(raw?.wins), games: nums(raw?.games), current: ok ? c : null };
}

function piecesOf(g: Chess): Map<string, Pc> {
  const out = new Map<string, Pc>();
  for (const row of g.board()) for (const p of row) if (p) out.set(p.square, { color: p.color, type: p.type });
  return out;
}

function traysOf(log: Move[]): Trays {
  const t: Trays = { w: [], b: [] };
  for (const m of log) if (m.captured) t[m.color].push({ color: m.color === 'w' ? 'b' : 'w', type: m.captured });
  return t;
}

function checkSquare(g: Chess): Square | null {
  return g.inCheck() ? (g.findPiece({ type: 'k', color: g.turn() })[0] ?? null) : null;
}

function fxOf(m: Move, drop?: Drop): MoveFx {
  const rank = m.from.charAt(1);
  const them: Color = m.color === 'w' ? 'b' : 'w';
  return {
    from: m.from,
    to: m.to,
    piece: { color: m.color, type: m.piece },
    captured: m.captured
      ? { piece: { color: them, type: m.captured }, square: m.isEnPassant() ? ((m.to.charAt(0) + rank) as Square) : m.to }
      : undefined,
    rook: m.isKingsideCastle()
      ? { from: `h${rank}` as Square, to: `f${rank}` as Square }
      : m.isQueensideCastle()
        ? { from: `a${rank}` as Square, to: `d${rank}` as Square }
        : undefined,
    promotion: m.promotion,
    drop,
  };
}

function pgnOf(g: Chess, me: Color, bot: string, date: string, result: string): string {
  g.setHeader('Event', 'The Rec Deck');
  g.setHeader('Date', date.replace(/-/g, '.'));
  g.setHeader('White', me === 'w' ? PLAYER : bot);
  g.setHeader('Black', me === 'b' ? PLAYER : bot);
  g.setHeader('Result', result);
  return g.pgn();
}

const CSS = `
.rdc{position:relative;display:flex;flex-direction:column;align-items:center;min-height:60dvh;padding:14px 10px 18px;
  color:var(--t);font-family:var(--fb);font-size:14px;line-height:1.4;-webkit-user-select:none;user-select:none}
.rdc-view{width:100%;display:flex;flex-direction:column;align-items:center;gap:10px}
.rdc .px{font-family:var(--fp);letter-spacing:.04em}
.rdc-h{font-size:14px;color:var(--a);margin:6px 0 0}
.rdc-sub{color:var(--td);font-size:13px;margin:0 0 4px;text-align:center}
.rdc-hud{width:100%;max-width:var(--bw,560px);display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:30px;flex-wrap:wrap}
.rdc-name{font-size:11px}
.rdc-status{font-size:9px;color:var(--td)}
.rdc-blink{animation:rdc-blink 1s steps(2,jump-none) infinite}
@keyframes rdc-blink{50%{opacity:.35}}
.rdc-btn{font:inherit;font-size:12px;font-weight:600;letter-spacing:.06em;padding:10px 11px;border-radius:var(--r);
  border:1px solid var(--ln);background:var(--chip);color:var(--t);cursor:pointer}
.rdc-btn:disabled{opacity:.38;cursor:default}
.rdc-btn.go{border-color:var(--a);color:var(--a)}
.rdc-row{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}
.rdc-coins{display:flex;gap:5px;align-items:center}
.rdc-coin{width:11px;height:11px;background:var(--a);box-shadow:inset -2px -2px 0 rgba(0,0,0,.35)}
.rdc-coin.spent{background:none;box-shadow:inset 0 0 0 1px var(--ln)}
.rdc-stage{width:100%;line-height:0}
.rdc-panel{width:100%;max-width:var(--bw,560px);display:flex;flex-direction:column;align-items:center;gap:10px}
.rdc-big{font-size:18px;margin-top:4px}
.rdc-win{color:var(--good)}.rdc-loss{color:var(--bad)}
.rdc-over{position:absolute;inset:0;z-index:3;display:flex;justify-content:center;align-items:flex-start;
  background:color-mix(in srgb,var(--bg) 80%,transparent)}
.rdc-card{position:sticky;top:22%;margin:22% 12px 12px;max-width:300px;padding:16px;display:flex;flex-direction:column;gap:12px;
  text-align:center;background:var(--raise);border:1px solid var(--ln);border-radius:calc(var(--r)*2);
  box-shadow:0 10px 30px rgba(0,0,0,.55)}
.rdc-pick{display:flex;gap:8px;justify-content:center}
.rdc-pick button{padding:6px;background:var(--chip);border:1px solid var(--ln);border-radius:var(--r);cursor:pointer;line-height:0}
.rdc-rungs{width:100%;max-width:560px;display:flex;flex-direction:column;gap:8px}
.rdc-rung{display:grid;grid-template-columns:auto 1fr auto;gap:4px 12px;align-items:center;text-align:left;width:100%;
  padding:12px;font:inherit;color:inherit;background:var(--raise);border:1px solid var(--ln);border-radius:var(--r);cursor:pointer}
.rdc-rung[disabled]{cursor:default;opacity:.45}
.rdc-rung.top{border-color:var(--a)}
.rdc-num{font-size:16px;color:var(--tf);grid-row:span 2}
.rdc-rung.top .rdc-num{color:var(--a)}
.rdc-rname{font-size:11px}
.rdc-tell{grid-column:2/4;color:var(--td);font-size:13px}
.rdc-side{display:flex;flex-direction:column;align-items:flex-end;gap:6px}
.rdc-rec{font-size:8px;color:var(--tf)}
.rdc-bar{width:100%;height:6px;background:var(--chip)}
.rdc-bar i{display:block;height:100%;background:var(--a);width:0}
.rdc-graph{display:block;touch-action:none;cursor:pointer}
.rdc-note{display:flex;flex-direction:column;gap:2px;text-align:left;width:100%;padding:10px 12px;font:inherit;color:inherit;
  background:var(--raise);border:1px solid var(--ln);border-radius:var(--r);cursor:pointer}
.rdc-note b{font-size:10px;color:var(--bad);font-weight:400}
.rdc-note span{color:var(--td);font-size:13px}
.rdc-detail{min-height:2.8em;text-align:center;color:var(--td);font-size:13px}
.rdc-nav{display:flex;align-items:center;gap:10px}
.rdc-nav .px{font-size:10px;min-width:9.5em;text-align:center}
@media (prefers-reduced-motion:reduce){.rdc-blink{animation:none}}
`;

export function start(host: HTMLElement, ctx: CartridgeContext, id: string): () => void {
  const t = ctx.theme;
  const pal = buildPalette(t);
  const sprites = buildSprites(pal);
  const reduced = ctx.settings.reducedEffects === true || matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sfx = makeSfx(ctx.settings.sound === true);

  const root = el('div', 'rdc');
  const vars: Record<string, string> = {
    '--t': t.text, '--td': t.textDim, '--tf': t.textFaint, '--a': t.accent, '--bg': t.bg, '--raise': t.bgRaise,
    '--chip': t.bgChip, '--ln': t.line, '--good': t.good, '--bad': t.bad, '--r': t.radius, '--fp': t.fontPixel, '--fb': t.fontBody,
  };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  const style = el('style');
  style.textContent = CSS;
  const view = el('div', 'rdc-view');
  root.append(style, view);
  host.append(root);

  const save = loadSave(ctx);
  const write = () => ctx.save.write(save);

  let gen = 0; // bumps on every screen change; anything async checks it before touching the screen
  let engine: Engine | null = null;
  let board: BoardView | null = null;
  let overlay: { node: HTMLElement; close: () => void } | null = null;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const later = (fn: () => void, ms: number): void => {
    const h = setTimeout(() => {
      timers.delete(h);
      fn();
    }, ms);
    timers.add(h);
  };
  const sleep = (ms: number) => new Promise<void>((r) => later(r, ms));

  function clear(): void {
    gen += 1;
    for (const h of timers) clearTimeout(h);
    timers.clear();
    overlay?.close();
    board?.destroy();
    board = null;
    view.replaceChildren();
  }

  /** A card over the cartridge. Resolves with the pressed button's value, or `fallback` if the screen changes. */
  function modal<T>(fallback: T, build: (done: (v: T) => void) => Kid[]): Promise<T> {
    overlay?.close();
    return new Promise<T>((resolve) => {
      const node = el('div', 'rdc-over');
      const close = (v: T) => {
        if (overlay?.node !== node) return;
        overlay = null;
        node.remove();
        resolve(v);
      };
      node.append(el('div', 'rdc-card', ...build(close)));
      overlay = { node, close: () => close(fallback) };
      root.append(node);
    });
  }

  const ask = (text: string, yes: string, no: string): Promise<boolean> =>
    modal<boolean>(false, (done) => [
      el('div', '', text),
      el('div', 'rdc-row', button(no, '', () => done(false)), button(yes, 'go', () => done(true))),
    ]);

  // ---------------------------------------------------------------- ladder

  function ladder(): void {
    clear();
    view.append(el('h2', 'rdc-h px', 'THE LADDER'), el('p', 'rdc-sub', 'Beat an opponent to unlock the next.'));
    const cur = save.current;
    if (cur) {
      const name = LADDER[cur.rung]?.name ?? '';
      view.append(button(`RESUME vs ${name} · move ${Math.floor(cur.sans.length / 2) + 1}`, 'go', () => play(cur)));
    }
    const list = el('div', 'rdc-rungs');
    for (let i = LADDER.length - 1; i >= 0; i--) {
      const bot = LADDER[i];
      if (!bot) continue;
      const locked = i > save.unlocked;
      const coins = el('div', 'rdc-coins');
      for (let c = 0; c < bot.coins; c++) coins.append(el('i', 'rdc-coin'));
      const below = LADDER[i - 1]?.name ?? '';
      const card = el(
        'button',
        `rdc-rung${i === save.unlocked ? ' top' : ''}`,
        el('span', 'rdc-num px', String(i + 1)),
        el('span', 'rdc-rname px', bot.name),
        el('span', 'rdc-side', coins, locked ? null : el('span', 'rdc-rec px', `${save.wins[i] ?? 0}W / ${save.games[i] ?? 0}`)),
        el('span', 'rdc-tell', locked ? `Locked. Beat ${below} first.` : bot.tell),
      );
      card.type = 'button';
      card.disabled = locked;
      card.addEventListener('click', () => void pick(i));
      list.append(card);
    }
    view.append(list);
  }

  async function pick(rung: number): Promise<void> {
    const cur = save.current;
    if (cur) {
      const name = LADDER[cur.rung]?.name ?? '';
      if (!(await ask(`Abandon your game against ${name}?`, 'ABANDON', 'KEEP IT'))) return;
      abandon(cur);
    }
    begin(rung);
  }

  function abandon(cur: Current): void {
    const bot = LADDER[cur.rung];
    if (bot && cur.sans.length >= 2) {
      const g = new Chess();
      try {
        for (const s of cur.sans) g.move(s);
      } catch {
        /* a save we can't replay just gets dropped */
      }
      ctx.report({
        game: id,
        date: ctx.today,
        outcome: 'abandon',
        duration_s: Math.max(1, Math.round(cur.elapsed)),
        meta: { pgn: pgnOf(g, cur.color, bot.name, ctx.today, '*'), rung: cur.rung + 1, opponent: bot.name, color: cur.color },
      });
      save.games[cur.rung] = (save.games[cur.rung] ?? 0) + 1;
    }
    save.current = null;
    write();
  }

  function begin(rung: number): void {
    const bot = LADDER[rung];
    if (!bot) return ladder();
    const color: Color = (save.games[rung] ?? 0) % 2 === 0 ? 'w' : 'b';
    const cur: Current = { rung, color, sans: [], coins: bot.coins, used: 0, elapsed: 0 };
    save.current = cur;
    write();
    play(cur);
  }

  // ------------------------------------------------------------------ game

  function play(cur: Current): void {
    clear();
    const my = gen;
    const bot = LADDER[cur.rung];
    const chess = new Chess();
    try {
      for (const s of cur.sans) chess.move(s);
    } catch {
      save.current = null;
      write();
      return ladder();
    }
    if (!bot) return ladder();
    engine ??= new Engine(ENGINE_URL);
    const eng = engine;
    const me = cur.color;

    let interactive = false;
    let busy = false;
    let over = false;
    let clock = performance.now();
    const elapsed = () => cur.elapsed + (performance.now() - clock) / 1000;
    const log = () => chess.history({ verbose: true });

    const status = el('span', 'rdc-status px');
    const coins = el('div', 'rdc-coins');
    const back = button('TAKE BACK', '', () => takeBack());
    const resign = button('RESIGN', '', () => void giveUp());
    const leave = button('LADDER', '', () => {
      if (!over) persist();
      ladder();
    });
    const stage = el('div', 'rdc-stage');
    const bottom = el('div', 'rdc-hud', coins, el('div', 'rdc-row', back, resign, leave));
    const panel = el('div', 'rdc-panel');
    view.append(el('div', 'rdc-hud', el('span', 'rdc-name px', bot.name), status), stage, bottom, panel);

    const b = new BoardView(
      stage,
      pal,
      sprites,
      {
        canPick: (sq) => interactive && !busy && !overlay && chess.get(sq)?.color === me,
        legal: (sq) => {
          const seen = new Set<string>();
          return chess
            .moves({ square: sq, verbose: true })
            .filter((m) => !seen.has(m.to) && seen.add(m.to))
            .map((m) => ({ to: m.to, capture: m.isCapture() }));
        },
        onMove: (from, to, drop) => void attempt(from, to, drop),
        onImpact: (capture) => sfx.play(capture ? 'capture' : 'move'),
      },
      reduced,
    );
    board = b;
    b.setOrientation(me);

    function persist(): void {
      cur.sans = chess.history();
      cur.elapsed = elapsed();
      clock = performance.now();
      save.current = cur;
      write();
    }

    function hud(text: string, blink = false): void {
      status.textContent = text;
      status.classList.toggle('rdc-blink', blink);
      coins.replaceChildren();
      for (let i = 0; i < bot.coins; i++) coins.append(el('i', `rdc-coin${i < cur.coins ? '' : ' spent'}`));
      back.disabled = over || !interactive || cur.coins <= 0 || !log().some((m) => m.color === me);
      resign.disabled = over;
    }

    function sync(): void {
      const moves = log();
      const lastMove = moves[moves.length - 1];
      b.setPosition(piecesOf(chess), {
        last: lastMove ? [lastMove.from, lastMove.to] : null,
        check: checkSquare(chess),
        trays: traysOf(moves),
      });
    }

    function turn(): void {
      if (gen !== my) return;
      if (chess.isGameOver()) return finish();
      if (chess.turn() === me) {
        interactive = true;
        hud(chess.inCheck() ? 'CHECK' : 'YOUR MOVE');
      } else {
        interactive = false;
        hud('THINKING', true);
        void think();
      }
    }

    function commit(mv: MoveInput, drop?: Drop): void {
      let m: Move;
      try {
        m = chess.move(mv);
      } catch {
        b.clearPick();
        return;
      }
      interactive = false;
      busy = true;
      persist();
      hud(status.textContent ?? '');
      b.animate(fxOf(m, drop), () => {
        if (gen !== my) return;
        busy = false;
        const sq = checkSquare(chess);
        b.setCheck(sq);
        if (sq) sfx.play('check');
        turn();
      });
    }

    async function attempt(from: Square, to: Square, drop?: Drop): Promise<void> {
      const options = chess.moves({ square: from, verbose: true }).filter((m) => m.to === to);
      if (!options.length) return;
      const mv: MoveInput = { from, to };
      if (options.some((m) => m.promotion)) {
        const choice = await modal<PieceSymbol | null>(null, (done) => [
          el('div', 'px', 'PROMOTE TO'),
          el(
            'div',
            'rdc-pick',
            ...(['q', 'r', 'b', 'n'] as PieceSymbol[]).map((p) => {
              const pb = el('button', '', b.sprite(me, p, 44));
              pb.type = 'button';
              pb.addEventListener('click', () => done(p));
              return pb;
            }),
          ),
          button('CANCEL', '', () => done(null)),
        ]);
        if (!choice || gen !== my) return;
        mv.promotion = choice;
        drop = undefined;
      }
      if (bot.tripwire) {
        const w = tripwire(chess.fen(), mv);
        if (w) {
          sfx.play('warn');
          const go = await ask(`${w.text} You sure?`, 'PLAY IT', 'TAKE IT BACK');
          if (!go || gen !== my) return;
          drop = undefined;
        }
      }
      commit(mv, drop);
    }

    async function think(): Promise<void> {
      const fen = chess.fen();
      const ply = chess.history().length;
      const [a] = await Promise.all([eng.analyse(fen, { depth: bot.depth, multipv: bot.multipv, elo: bot.elo }), sleep(THINK_MS)]);
      if (gen !== my || chess.fen() !== fen) return;
      let uci = a.best;
      if (!bot.elo) uci = choose(bot, toCands(fen, a.lines), ply, Math.random)?.uci ?? a.best;
      const legal = chess.moves({ verbose: true });
      const m = legal.find((x) => x.from + x.to + (x.promotion ?? '') === uci) ?? legal[Math.floor(Math.random() * legal.length)];
      if (m) commit({ from: m.from, to: m.to, promotion: m.promotion });
    }

    function takeBack(): void {
      if (!interactive || busy || over || overlay || cur.coins <= 0) return;
      const moves = log();
      let mine = -1;
      moves.forEach((m, i) => {
        if (m.color === me) mine = i;
      });
      if (mine < 0) return;
      for (let i = moves.length; i > mine; i--) chess.undo();
      cur.coins -= 1;
      cur.used += 1;
      sfx.play('coin');
      persist();
      sync();
      turn();
    }

    async function giveUp(): Promise<void> {
      if (over || busy) return;
      if (!(await ask('Resign this game?', 'RESIGN', 'KEEP PLAYING')) || gen !== my || over) return;
      finish(true);
    }

    function finish(resigned = false): void {
      over = true;
      interactive = false;
      let outcome: Outcome = 'draw';
      let word = 'DRAW';
      let fallen: Square | null = null;
      let result = '1/2-1/2';
      const loser: Color | null = resigned ? me : chess.isCheckmate() ? chess.turn() : null;
      if (loser) {
        outcome = loser === me ? 'loss' : 'win';
        word = resigned ? 'RESIGNED' : 'CHECKMATE';
        fallen = chess.findPiece({ type: 'k', color: loser })[0] ?? null;
        result = loser === 'w' ? '0-1' : '1-0';
      } else if (chess.isStalemate()) word = 'STALEMATE';

      b.finale(word, fallen);
      const sans = chess.history();
      ctx.report({
        game: id,
        date: ctx.today,
        outcome,
        duration_s: Math.max(1, Math.round(elapsed())),
        meta: {
          pgn: pgnOf(chess, me, bot.name, ctx.today, result),
          rung: cur.rung + 1,
          opponent: bot.name,
          color: me,
          plies: sans.length,
          coins_used: cur.used,
          ending: word.toLowerCase(),
        },
      });
      save.games[cur.rung] = (save.games[cur.rung] ?? 0) + 1;
      const climbed = outcome === 'win' && cur.rung === save.unlocked && cur.rung < LADDER.length - 1;
      if (outcome === 'win') {
        save.wins[cur.rung] = (save.wins[cur.rung] ?? 0) + 1;
        if (climbed) save.unlocked = cur.rung + 1;
      }
      save.current = null;
      write();
      hud(word);
      const final: Final = { rung: cur.rung, color: me, sans };
      later(() => endPanel(outcome, climbed, final), reduced ? 500 : 1500);
    }

    function endPanel(outcome: Outcome, climbed: boolean, final: Final): void {
      bottom.replaceChildren();
      const next = LADDER[final.rung + 1];
      const head =
        outcome === 'win'
          ? el('div', 'rdc-big rdc-win px', 'YOU WIN')
          : outcome === 'loss'
            ? el('div', 'rdc-big rdc-loss px', 'YOU LOSE')
            : el('div', 'rdc-big px', 'DRAW');
      const sub =
        outcome === 'win' && climbed && next
          ? `Unlocked: ${next.name}.`
          : outcome === 'win' && !next
            ? 'Top of the ladder.'
            : outcome === 'win'
              ? `${bot.name} is beaten.`
              : `${bot.name} holds the rung.`;
      panel.replaceChildren(
        head,
        el('div', 'rdc-sub', sub),
        el(
          'div',
          'rdc-row',
          eng.live && final.sans.length >= 2 ? button('ROLL THE TAPE', 'go', () => void tape(final)) : null,
          button('REMATCH', '', () => begin(final.rung)),
          outcome === 'win' && next ? button(`NEXT: ${next.name}`, '', () => begin(final.rung + 1)) : null,
        ),
      );
    }

    // -------------------------------------------------------------- tape

    async function tape(final: Final): Promise<void> {
      const fill = el('i');
      const count = el('div', 'rdc-status px', 'REWINDING THE TAPE');
      panel.replaceChildren(count, el('div', 'rdc-bar', fill));
      const tp = await buildTape(
        eng,
        final.sans,
        final.color,
        (done, total) => {
          if (gen === my) fill.style.width = `${Math.round((done / total) * 100)}%`;
        },
        () => gen === my,
      );
      if (!tp || gen !== my) return;
      showTape(tp, final);
    }

    function showTape(tp: Tape, final: Final): void {
      const n = tp.sans.length;
      let k = tp.notes[0]?.ply ?? n;
      b.clearFinale();
      hud('THE TAPE');
      leave.textContent = 'LADDER';
      bottom.replaceChildren(el('div', 'rdc-row', button('REMATCH', '', () => begin(final.rung)), leave));

      const graph = el('canvas', 'rdc-graph');
      const label = el('span', 'px');
      const detail = el('div', 'rdc-detail');
      const prev = button('◀', '', () => show(k - 1));
      const nextB = button('▶', '', () => show(k + 1));

      const paint = (): void => {
        const w = Math.round(b.width);
        const h = 54;
        const dpr = Math.min(3, devicePixelRatio || 1);
        graph.width = w * dpr;
        graph.height = h * dpr;
        graph.style.width = `${w}px`;
        graph.style.height = `${h}px`;
        const g = graph.getContext('2d');
        if (!g) return;
        g.scale(dpr, dpr);
        g.fillStyle = t.bgChip;
        g.fillRect(0, 0, w, h);
        const bw = w / (n + 1);
        const mid = h / 2;
        const flagged = new Set(tp.notes.map((x) => x.ply + 1));
        tp.score.forEach((cp, i) => {
          const v = (Math.max(-800, Math.min(800, cp)) / 800) * (mid - 3);
          g.fillStyle = flagged.has(i) ? t.bad : v >= 0 ? alpha(t.text, 0.75) : alpha(t.textDim, 0.6);
          const bh = Math.max(1, Math.abs(v));
          g.fillRect(i * bw, v >= 0 ? mid - bh : mid, Math.max(1, bw - 1), bh);
        });
        g.fillStyle = t.line;
        g.fillRect(0, mid, w, 1);
        g.fillStyle = t.accent;
        g.fillRect(Math.round(k * bw + bw / 2) - 1, 0, 2, h);
      };

      const show = (to: number): void => {
        k = Math.max(0, Math.min(n, to));
        const pos = new Chess(tp.fens[k]);
        const replay = new Chess();
        for (let i = 0; i < k; i++) replay.move(tp.sans[i] ?? '');
        const moves = replay.history({ verbose: true });
        const lastMove = moves[moves.length - 1];
        b.setPosition(piecesOf(pos), {
          last: lastMove ? [lastMove.from, lastMove.to] : null,
          check: checkSquare(pos),
          trays: traysOf(moves),
        });
        const note = tp.notes.find((x) => x.ply === k);
        const arrows: Arrow[] = [];
        const uci = tp.ucis[k];
        if (uci) {
          arrows.push({ from: uci.slice(0, 2) as Square, to: uci.slice(2, 4) as Square, color: note ? pal.bad : pal.dim });
          if (note?.bestUci && note.bestUci !== uci) {
            arrows.push({ from: note.bestUci.slice(0, 2) as Square, to: note.bestUci.slice(2, 4) as Square, color: pal.good });
          }
        }
        b.setArrows(arrows);
        label.textContent = k < n ? moveLabel(k, tp.sans[k] ?? '') : 'END';
        detail.textContent = note ? `${note.label}.${note.bestSan ? ` Better was ${note.bestSan}.` : ''}` : '';
        prev.disabled = k === 0;
        nextB.disabled = k === n;
        paint();
      };

      const scrub = (e: PointerEvent): void => {
        const r = graph.getBoundingClientRect();
        if (r.width) show(Math.floor(((e.clientX - r.left) / r.width) * (n + 1)));
      };
      graph.addEventListener('pointerdown', (e) => {
        try {
          graph.setPointerCapture(e.pointerId);
        } catch {
          /* capture is a nicety */
        }
        scrub(e);
      });
      graph.addEventListener('pointermove', (e) => {
        if (e.buttons) scrub(e);
      });

      const notes = tp.notes.map((x) => {
        const nb = el('button', 'rdc-note', el('b', 'px', `${moveLabel(x.ply, x.san)} ?`), el('span', '', x.label));
        nb.type = 'button';
        nb.addEventListener('click', () => show(x.ply));
        return nb;
      });

      panel.replaceChildren(
        el('div', 'rdc-status px', `ACCURACY ${tp.accuracy}%`),
        graph,
        el('div', 'rdc-nav', prev, label, nextB),
        detail,
        ...(notes.length ? notes : [el('div', 'rdc-sub', 'Clean game. Nothing worth flagging.')]),
      );
      show(k);
    }

    sync();
    turn();
  }

  if (save.current) play(save.current);
  else ladder();

  return () => {
    gen += 1;
    for (const h of timers) clearTimeout(h);
    timers.clear();
    overlay?.close();
    board?.destroy();
    engine?.quit();
    sfx.close();
    root.remove();
  };
}
