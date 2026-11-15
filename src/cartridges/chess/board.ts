// The board: one canvas, drawn in device pixels so the sprites stay crisp.
// It knows how chess looks and moves. It does not know the rules; the game tells it what is legal.

import type { Color, PieceSymbol, Square } from 'chess.js';
import { alpha, type Palette } from './palette';
import { N, type SpriteSet } from './sprites';

export interface Pc {
  color: Color;
  type: PieceSymbol;
}

export interface Target {
  to: Square;
  capture: boolean;
}

export interface Drop {
  x: number;
  y: number;
}

export interface MoveFx {
  from: Square;
  to: Square;
  piece: Pc;
  captured?: { piece: Pc; square: Square };
  rook?: { from: Square; to: Square };
  promotion?: PieceSymbol;
  drop?: Drop;
}

export interface Arrow {
  from: Square;
  to: Square;
  color: string;
}

export interface Trays {
  w: Pc[];
  b: Pc[];
}

export interface BoardHooks {
  canPick(sq: Square): boolean;
  legal(sq: Square): Target[];
  onMove(from: Square, to: Square, drop?: Drop): void;
  onImpact(capture: boolean): void;
}

interface Anim {
  fx: MoveFx;
  t0: number;
  a: [number, number];
  b: [number, number];
  ra?: [number, number];
  rb?: [number, number];
  slide: number;
  stop: number;
  settle: number;
  morph: number;
  struck: boolean;
  done: () => void;
}

interface Part {
  x: number;
  y: number;
  vx: number;
  vy: number;
  c: string;
  born: number;
  wait: number;
  hx: number;
  hy: number;
  homed: boolean;
  tx: number;
  ty: number;
}

interface TrayPc extends Pc {
  at: number;
}

const BURST = 240;
const HOME = 380;

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeIn = (t: number) => t * t * t;
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

// A fixed scramble of the 256 sprite cells, for the promotion morph.
const SCRAMBLE = new Float32Array(N * N);
for (let i = 0; i < N * N; i++) SCRAMBLE[i] = ((i * 7919 + 104729) % 256) / 256;

export class BoardView {
  readonly canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private orient: Color = 'w';
  private pieces = new Map<string, Pc>();
  private tray: { w: TrayPc[]; b: TrayPc[] } = { w: [], b: [] };
  private sel: Square | null = null;
  private targets: Target[] = [];
  private drag: { sq: Square; x: number; y: number; sx: number; sy: number; moved: boolean } | null = null;
  private last: [Square, Square] | null = null;
  private check: Square | null = null;
  private arrows: Arrow[] = [];
  private anim: Anim | null = null;
  private parts: Part[] = [];
  private shakeAt = -1e9;
  private word = '';
  private wordAt = 0;
  private fallen: Square | null = null;
  private fallenAt = 0;
  private dimAt = -1;
  private busyUntil = 0;
  private raf = 0;
  private dead = false;
  private sq = 40;
  private oy = 20;
  private trayH = 20;
  private scale = 2;
  private trayScale = 1;
  private ro: ResizeObserver;

  constructor(
    private host: HTMLElement,
    private pal: Palette,
    private sprites: SpriteSet,
    private hooks: BoardHooks,
    private reduced: boolean,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'display:block;touch-action:none;margin:0 auto';
    const g = this.canvas.getContext('2d');
    if (!g) throw new Error('no canvas');
    this.g = g;
    host.append(this.canvas);
    this.canvas.addEventListener('pointerdown', this.down);
    this.canvas.addEventListener('pointermove', this.move);
    this.canvas.addEventListener('pointerup', this.up);
    this.canvas.addEventListener('pointercancel', this.cancel);
    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(host);
    this.layout();
  }

  // ---- what the game tells the board ----

  /** Board width in CSS pixels, so the HUD can line up with it. */
  get width(): number {
    return this.canvas.width / this.ratio();
  }

  setOrientation(c: Color): void {
    this.orient = c;
    this.kick();
  }

  /** Snap to a position. Cancels anything in flight. */
  setPosition(pieces: Map<string, Pc>, opts: { last?: [Square, Square] | null; check?: Square | null; trays?: Trays } = {}): void {
    this.anim = null;
    this.parts = [];
    this.pieces = new Map(pieces);
    this.last = opts.last ?? null;
    this.check = opts.check ?? null;
    if (opts.trays) this.tray = { w: opts.trays.w.map((p) => ({ ...p, at: 0 })), b: opts.trays.b.map((p) => ({ ...p, at: 0 })) };
    this.clearPick();
    this.kick();
  }

  setCheck(sq: Square | null): void {
    this.check = sq;
    this.kick();
  }

  setArrows(arrows: Arrow[]): void {
    this.arrows = arrows;
    this.kick();
  }

  /** End of game: dim the board, tip a king over, light the marquee. */
  finale(word: string, fallen: Square | null): void {
    const now = performance.now();
    this.word = word;
    this.wordAt = now + (fallen && !this.reduced ? 500 : 0);
    this.fallen = fallen;
    this.fallenAt = now;
    this.dimAt = now;
    this.clearPick();
    this.kick(2000 + word.length * 60);
  }

  clearFinale(): void {
    this.word = '';
    this.fallen = null;
    this.dimAt = -1;
    this.kick();
  }

  clearPick(): void {
    this.sel = null;
    this.targets = [];
    this.drag = null;
    this.kick();
  }

  /** A piece image at roughly `cssPx`, for pickers outside the canvas. */
  sprite(color: Color, type: PieceSymbol, cssPx: number): HTMLCanvasElement {
    const k = Math.max(1, Math.round((cssPx * this.ratio()) / N));
    const cv = document.createElement('canvas');
    cv.width = cv.height = N * k;
    cv.style.width = cv.style.height = `${(N * k) / this.ratio()}px`;
    const g = cv.getContext('2d');
    if (g) {
      g.imageSmoothingEnabled = false;
      g.drawImage(this.sprites.image(color, type), 0, 0, N * k, N * k);
    }
    return cv;
  }

  /** Play a move. `done` fires when the piece has landed and the board is settled. */
  animate(fx: MoveFx, done: () => void): void {
    const dist = Math.hypot(fx.to.charCodeAt(0) - fx.from.charCodeAt(0), Number(fx.to.charAt(1)) - Number(fx.from.charAt(1)));
    const b = this.cell(fx.to);
    const a: [number, number] = fx.drop ? [fx.drop.x - this.sq / 2, fx.drop.y - this.sq / 2] : this.cell(fx.from);
    const slide = fx.drop ? 70 : this.reduced ? 110 : Math.max(150, Math.min(300, 120 + dist * 28));
    this.pieces.delete(fx.from);
    if (fx.rook) this.pieces.delete(fx.rook.from);
    this.clearPick();
    this.last = [fx.from, fx.to];
    this.anim = {
      fx,
      t0: performance.now(),
      a,
      b,
      ra: fx.rook ? this.cell(fx.rook.from) : undefined,
      rb: fx.rook ? this.cell(fx.rook.to) : undefined,
      slide,
      stop: fx.captured && !this.reduced ? 70 : 0,
      settle: this.reduced ? 0 : 110,
      morph: fx.promotion && !this.reduced ? 340 : 0,
      struck: false,
      done,
    };
    this.kick();
  }

  destroy(): void {
    this.dead = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.canvas.remove();
  }

  // ---- geometry ----

  private ratio(): number {
    return Math.min(3, Math.max(1, devicePixelRatio || 1));
  }

  private layout(): void {
    const hostW = this.host.clientWidth || 320;
    const cap = Math.max(240, Math.min(620, Math.floor(innerHeight * 0.6)));
    const dpr = this.ratio();
    const sq = Math.max(16, Math.floor((Math.min(hostW, cap) * dpr) / 8));
    const trayH = Math.round(sq * 0.5);
    if (sq === this.sq && this.canvas.width === sq * 8 && this.canvas.height === sq * 8 + trayH * 2) return;
    const scale = sq / this.sq;
    if (this.anim) {
      // Re-anchor a move in flight; simplest correct thing is to land it.
      const { fx, done } = this.anim;
      this.anim = null;
      this.land(fx);
      this.parts = [];
      queueMicrotask(done);
    }
    for (const p of this.parts) {
      p.x *= scale;
      p.y *= scale;
    }
    this.sq = sq;
    this.trayH = trayH;
    this.oy = trayH;
    this.scale = Math.max(1, Math.floor((sq * 0.92) / N));
    this.trayScale = Math.max(1, Math.floor((trayH * 0.9) / N));
    this.canvas.width = sq * 8;
    this.canvas.height = sq * 8 + trayH * 2;
    this.canvas.style.width = `${(sq * 8) / dpr}px`;
    this.canvas.style.height = `${this.canvas.height / dpr}px`;
    (this.host.parentElement ?? this.host).style.setProperty('--bw', `${(sq * 8) / dpr}px`);
    this.draw(performance.now());
    this.kick();
  }

  private cell(s: Square): [number, number] {
    const f = s.charCodeAt(0) - 97;
    const r = Number(s.charAt(1)) - 1;
    const col = this.orient === 'w' ? f : 7 - f;
    const row = this.orient === 'w' ? 7 - r : r;
    return [col * this.sq, this.oy + row * this.sq];
  }

  private hit(x: number, y: number): Square | null {
    const col = Math.floor(x / this.sq);
    const row = Math.floor((y - this.oy) / this.sq);
    if (col < 0 || col > 7 || row < 0 || row > 7) return null;
    const f = this.orient === 'w' ? col : 7 - col;
    const r = this.orient === 'w' ? 7 - row : row;
    return (String.fromCharCode(97 + f) + String(r + 1)) as Square;
  }

  private traySlot(color: Color, i: number): [number, number] {
    const size = this.trayScale * N;
    const step = Math.min(size * 0.82, (this.sq * 8 - size) / 15);
    const y = color === this.orient ? this.oy + this.sq * 8 + (this.trayH - size) / 2 : (this.trayH - size) / 2;
    return [Math.round(this.sq * 0.12 + i * step), Math.round(y)];
  }

  // ---- input ----

  private point(e: PointerEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    const k = r.width ? this.canvas.width / r.width : 1;
    return [(e.clientX - r.left) * k, (e.clientY - r.top) * k];
  }

  private down = (e: PointerEvent): void => {
    const [x, y] = this.point(e);
    const s = this.hit(x, y);
    if (!s) return;
    if (this.sel && this.targets.some((t) => t.to === s)) {
      const from = this.sel;
      this.clearPick();
      this.hooks.onMove(from, s);
      return;
    }
    if (this.hooks.canPick(s)) {
      this.sel = s;
      this.targets = this.hooks.legal(s);
      this.drag = { sq: s, x, y, sx: x, sy: y, moved: false };
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch {
        /* capture is a nicety */
      }
    } else {
      this.clearPick();
    }
    this.kick();
  };

  private move = (e: PointerEvent): void => {
    if (!this.drag) return;
    const [x, y] = this.point(e);
    this.drag.x = x;
    this.drag.y = y;
    if (!this.drag.moved && Math.hypot(x - this.drag.sx, y - this.drag.sy) > this.sq * 0.18) this.drag.moved = true;
    this.kick();
  };

  private up = (e: PointerEvent): void => {
    const d = this.drag;
    this.drag = null;
    if (d?.moved) {
      const [x, y] = this.point(e);
      const s = this.hit(x, y);
      if (s && this.targets.some((t) => t.to === s)) {
        this.clearPick();
        this.hooks.onMove(d.sq, s, { x, y });
        return;
      }
    }
    this.kick();
  };

  private cancel = (): void => {
    this.drag = null;
    this.kick();
  };

  // ---- the frame loop: runs only while something is moving ----

  private kick(ms = 0): void {
    if (ms) this.busyUntil = Math.max(this.busyUntil, performance.now() + ms);
    if (this.raf || this.dead) return;
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (now: number): void => {
    this.raf = 0;
    if (this.dead) return;
    this.step(now);
    this.draw(now);
    const pulsing = this.check !== null && !this.reduced;
    if (this.anim || this.parts.length || this.drag?.moved || pulsing || now < this.busyUntil) this.kick();
  };

  private land(fx: MoveFx): void {
    if (fx.captured) this.pieces.delete(fx.captured.square);
    this.pieces.set(fx.to, fx.promotion ? { color: fx.piece.color, type: fx.promotion } : fx.piece);
    if (fx.rook) this.pieces.set(fx.rook.to, { color: fx.piece.color, type: 'r' });
  }

  private step(now: number): void {
    const an = this.anim;
    if (an) {
      const t = now - an.t0;
      if (!an.struck && t >= an.slide) {
        an.struck = true;
        this.strike(an, now);
      }
      if (t >= an.slide + an.stop + an.settle + an.morph) {
        this.anim = null;
        this.land(an.fx);
        an.done();
      }
    }
    if (this.parts.length) {
      const g = this.sq * 0.000012;
      this.parts = this.parts.filter((p) => now - p.born < BURST + p.wait + HOME);
      for (const p of this.parts) {
        const age = now - p.born;
        if (age < 0) continue;
        if (age < BURST + p.wait) {
          p.x += p.vx * 16;
          p.y += p.vy * 16;
          p.vy += g * 16;
          p.vx *= 0.94;
          p.vy *= 0.97;
        } else if (!p.homed) {
          p.homed = true;
          p.hx = p.x;
          p.hy = p.y;
        }
      }
    }
  }

  /** The moment of contact. */
  private strike(an: Anim, now: number): void {
    const cap = an.fx.captured;
    this.hooks.onImpact(Boolean(cap));
    if (!cap) return;
    this.pieces.delete(cap.square);
    const by = an.fx.piece.color;
    const slot = this.traySlot(by, this.tray[by].length);
    if (this.reduced) {
      this.tray[by].push({ ...cap.piece, at: 0 });
      return;
    }
    this.tray[by].push({ ...cap.piece, at: now + an.stop + BURST + HOME });
    this.shakeAt = now + an.stop;
    this.kick(an.stop + BURST + HOME + 260);
    const [cx, cy] = this.cell(cap.square);
    const size = this.scale * N;
    const ox = cx + (this.sq - size) / 2;
    const oyy = cy + (this.sq - size) / 2;
    const half = (N - 1) / 2;
    const mini = this.trayScale;
    for (const px of this.sprites.pixels(cap.piece.color, cap.piece.type)) {
      const dx = px.x - half;
      const dy = px.y - half;
      const sp = this.sq * (0.0016 + Math.random() * 0.0034);
      const ang = Math.atan2(dy, dx) + (Math.random() - 0.5) * 0.9;
      this.parts.push({
        x: ox + px.x * this.scale,
        y: oyy + px.y * this.scale,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp - this.sq * 0.0012,
        c: px.c,
        born: now + an.stop,
        wait: Math.random() * 120,
        hx: 0,
        hy: 0,
        homed: false,
        tx: slot[0] + px.x * mini,
        ty: slot[1] + px.y * mini,
      });
    }
  }

  // ---- drawing ----

  private blit(img: HTMLCanvasElement, x: number, y: number, o: { k?: number; sx?: number; sy?: number; lift?: number } = {}): void {
    const g = this.g;
    const size = this.scale * N * (o.k ?? 1);
    const w = Math.round(size * (o.sx ?? 1));
    const h = Math.round(size * (o.sy ?? 1));
    const base = y + (this.sq + this.scale * N) / 2; // the piece's feet
    const lift = o.lift ?? 0;
    if (lift > 1) {
      g.fillStyle = 'rgba(0,0,0,0.35)';
      const sw = Math.round(w * 0.7);
      g.fillRect(Math.round(x + (this.sq - sw) / 2), Math.round(base - this.scale * 2), sw, this.scale * 2);
    }
    g.drawImage(img, Math.round(x + (this.sq - w) / 2), Math.round(base - h - lift), w, h);
  }

  private draw(now: number): void {
    const g = this.g;
    const sq = this.sq;
    const pal = this.pal;
    const bw = sq * 8;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const sh = now - this.shakeAt;
    if (sh >= 0 && sh < 190) {
      const amp = (1 - sh / 190) * sq * 0.045;
      g.translate(Math.round(Math.sin(sh * 0.11) * amp), Math.round(Math.cos(sh * 0.17) * amp));
    }

    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        g.fillStyle = (row + col) % 2 === 0 ? pal.light : pal.dark;
        g.fillRect(col * sq, this.oy + row * sq, sq, sq);
      }
    }

    if (this.last) {
      g.fillStyle = pal.last;
      for (const s of this.last) {
        const [x, y] = this.cell(s);
        g.fillRect(x, y, sq, sq);
      }
    }
    if (this.sel) {
      const [x, y] = this.cell(this.sel);
      g.fillStyle = pal.select;
      g.fillRect(x, y, sq, sq);
    }
    if (this.check) {
      const [x, y] = this.cell(this.check);
      const a = this.reduced ? 0.4 : 0.3 + 0.22 * Math.sin(now / 190);
      g.fillStyle = alpha(pal.accent, a);
      g.fillRect(x, y, sq, sq);
    }

    // coordinates, on the edge squares
    g.fillStyle = pal.coord;
    g.font = `${Math.max(8, Math.round(sq * 0.19))}px ${pal.fontBody}`;
    g.textBaseline = 'alphabetic';
    for (let i = 0; i < 8; i++) {
      const file = String.fromCharCode(97 + (this.orient === 'w' ? i : 7 - i));
      const rank = String(this.orient === 'w' ? 8 - i : i + 1);
      g.textAlign = 'right';
      g.fillText(file, (i + 1) * sq - sq * 0.07, this.oy + bw - sq * 0.08);
      g.textAlign = 'left';
      g.fillText(rank, sq * 0.07, this.oy + i * sq + sq * 0.24);
    }

    // where the picked piece can go: square pips, and brackets on captures
    const u = Math.max(1, this.scale);
    for (const t of this.targets) {
      const [x, y] = this.cell(t.to);
      g.fillStyle = pal.dot;
      if (t.capture) {
        const L = Math.round(sq * 0.24);
        const th = u * 2;
        g.fillRect(x, y, L, th);
        g.fillRect(x, y, th, L);
        g.fillRect(x + sq - L, y, L, th);
        g.fillRect(x + sq - th, y, th, L);
        g.fillRect(x, y + sq - th, L, th);
        g.fillRect(x, y + sq - L, th, L);
        g.fillRect(x + sq - L, y + sq - th, L, th);
        g.fillRect(x + sq - th, y + sq - L, th, L);
      } else {
        const d = u * 4;
        g.fillRect(Math.round(x + (sq - d) / 2), Math.round(y + (sq - d) / 2), d, d);
      }
    }

    const dragging = this.drag?.moved ? this.drag.sq : null;
    for (const [s, p] of this.pieces) {
      if (s === dragging || s === this.fallen) continue;
      const [x, y] = this.cell(s as Square);
      this.blit(this.sprites.image(p.color, p.type), x, y);
    }

    for (const ar of this.arrows) this.arrow(ar);

    if (this.anim) this.drawAnim(this.anim, now);

    if (this.dimAt >= 0) {
      g.fillStyle = alpha(pal.bg, 0.55 * clamp01((now - this.dimAt) / 400));
      g.fillRect(0, this.oy, bw, bw);
    }
    if (this.fallen) this.drawFallen(now);

    for (const p of this.parts) {
      const age = now - p.born;
      if (age < 0) continue;
      let x = p.x;
      let y = p.y;
      let s = this.scale;
      if (p.homed) {
        const k = easeIn(clamp01((age - BURST - p.wait) / HOME));
        x = p.hx + (p.tx - p.hx) * k;
        y = p.hy + (p.ty - p.hy) * k;
        s = this.scale + (this.trayScale - this.scale) * k;
      }
      g.fillStyle = p.c;
      g.fillRect(Math.round(x), Math.round(y), Math.ceil(s), Math.ceil(s));
    }

    if (this.drag?.moved) {
      const p = this.pieces.get(this.drag.sq);
      if (p) this.blit(this.sprites.image(p.color, p.type), this.drag.x - sq / 2, this.drag.y - sq / 2, { k: 1.15, lift: sq * 0.18 });
    }

    if (this.word && now >= this.wordAt) this.marquee(now);

    g.setTransform(1, 0, 0, 1, 0, 0);
    for (const c of ['w', 'b'] as Color[]) {
      this.tray[c].forEach((p, i) => {
        if (now < p.at) return;
        const [x, y] = this.traySlot(c, i);
        const size = this.trayScale * N;
        g.drawImage(this.sprites.image(p.color, p.type), x, y, size, size);
      });
    }
  }

  private drawAnim(an: Anim, now: number): void {
    const t = now - an.t0;
    const fx = an.fx;
    const img = this.sprites.image(fx.piece.color, fx.piece.type);
    const sq = this.sq;
    const [bx, by] = an.b;

    if (an.ra && an.rb) {
      const p = easeInOut(clamp01(t / an.slide));
      const rook = this.sprites.image(fx.piece.color, 'r');
      const hop = this.reduced ? 0 : Math.sin(Math.PI * p) * sq * 0.5;
      this.blit(rook, an.ra[0] + (an.rb[0] - an.ra[0]) * p, an.ra[1] + (an.rb[1] - an.ra[1]) * p, { lift: hop });
    }

    if (t < an.slide) {
      const p = easeInOut(clamp01(t / an.slide));
      const arc = this.reduced || fx.drop ? 0 : Math.sin(Math.PI * p) * sq * (fx.piece.type === 'n' ? 0.5 : 0.12);
      const k = this.reduced ? 1 : 1 + 0.1 * Math.sin(Math.PI * p);
      this.blit(img, an.a[0] + (bx - an.a[0]) * p, an.a[1] + (by - an.a[1]) * p, { k, lift: arc });
      return;
    }
    if (t < an.slide + an.stop) {
      // hit-stop: both pieces frozen at the point of contact, the victim lit up
      if (fx.captured) {
        const [vx, vy] = this.cell(fx.captured.square);
        this.blit(this.sprites.flash(fx.captured.piece.type), vx, vy);
      }
      this.blit(img, bx, by, { k: 1.12 });
      return;
    }
    const ts = t - an.slide - an.stop;
    if (ts < an.settle) {
      const s = 1 - ts / an.settle;
      this.blit(img, bx, by, { sx: 1 + 0.16 * s, sy: 1 - 0.2 * s });
      return;
    }
    if (fx.promotion && an.morph) {
      const m = clamp01((ts - an.settle) / an.morph);
      const size = this.scale * N;
      const x0 = Math.round(bx + (sq - size) / 2);
      const y0 = Math.round(by + (sq - size) / 2);
      const g = this.g;
      const paint = (type: PieceSymbol, show: (th: number) => boolean) => {
        for (const px of this.sprites.pixels(fx.piece.color, type)) {
          if (!show(SCRAMBLE[px.y * N + px.x] ?? 0)) continue;
          g.fillStyle = px.c;
          g.fillRect(x0 + px.x * this.scale, y0 + px.y * this.scale, this.scale, this.scale);
        }
      };
      paint(fx.piece.type, (th) => th >= m);
      paint(fx.promotion, (th) => th < m);
      return;
    }
    this.blit(img, bx, by);
  }

  private drawFallen(now: number): void {
    const s = this.fallen;
    const p = s ? this.pieces.get(s) : undefined;
    if (!s || !p) return;
    const [x, y] = this.cell(s);
    const g = this.g;
    const t = clamp01((now - this.fallenAt - 250) / 520);
    // fall, one small bounce, rest
    const fall = this.reduced ? 1 : t < 0.7 ? easeIn(t / 0.7) : 1 - 0.12 * Math.sin(Math.PI * ((t - 0.7) / 0.3));
    const size = this.scale * N;
    const dir = x > this.sq * 4 ? -1 : 1;
    g.save();
    g.translate(Math.round(x + this.sq / 2 + dir * size * 0.3 * fall), Math.round(y + (this.sq + size) / 2));
    g.rotate(dir * fall * (Math.PI / 2));
    g.drawImage(this.sprites.image(p.color, p.type), -size / 2, -size, size, size);
    g.restore();
  }

  private marquee(now: number): void {
    const g = this.g;
    const bw = this.sq * 8;
    const shown = this.reduced ? this.word.length : Math.min(this.word.length, Math.floor((now - this.wordAt) / 55) + 1);
    const px = Math.floor(Math.min(this.sq * 0.62, (bw * 0.86) / this.word.length));
    const h = Math.round(px * 2.6);
    const y = Math.round(this.oy + (bw - h) / 2);
    g.fillStyle = alpha(this.pal.bg, 0.9);
    g.fillRect(0, y, bw, h);
    g.fillStyle = this.pal.accent;
    g.fillRect(0, y, bw, Math.max(1, this.scale));
    g.fillRect(0, y + h - Math.max(1, this.scale), bw, Math.max(1, this.scale));
    g.font = `${px}px ${this.pal.fontPixel}`;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    const full = g.measureText(this.word).width;
    g.fillText(this.word.slice(0, shown), Math.round((bw - full) / 2), Math.round(y + h / 2 + px * 0.06));
  }

  private arrow(ar: Arrow): void {
    const g = this.g;
    const h = this.sq / 2;
    const [ax, ay] = this.cell(ar.from);
    const [bx, by] = this.cell(ar.to);
    const x1 = ax + h;
    const y1 = ay + h;
    const x2 = bx + h;
    const y2 = by + h;
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (!len) return;
    const ux = (x2 - x1) / len;
    const uy = (y2 - y1) / len;
    const head = this.sq * 0.34;
    const w = this.sq * 0.13;
    g.save();
    g.globalAlpha = 0.85;
    g.fillStyle = ar.color;
    g.strokeStyle = ar.color;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(x1 + ux * this.sq * 0.2, y1 + uy * this.sq * 0.2);
    g.lineTo(x2 - ux * head, y2 - uy * head);
    g.stroke();
    g.beginPath();
    g.moveTo(x2, y2);
    g.lineTo(x2 - ux * head - uy * head * 0.55, y2 - uy * head + ux * head * 0.55);
    g.lineTo(x2 - ux * head + uy * head * 0.55, y2 - uy * head - ux * head * 0.55);
    g.closePath();
    g.fill();
    g.restore();
  }
}
