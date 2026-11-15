// Every colour on the board is derived from the shell's theme tokens. No literals of our own.

import type { ThemeTokens } from '../../shell/contract';

type RGB = [number, number, number];

function parse(c: string): RGB {
  const s = c.trim();
  const six = /^#([0-9a-f]{6})$/i.exec(s);
  if (six) {
    const n = parseInt(six[1] ?? '0', 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const three = /^#([0-9a-f]{3})$/i.exec(s);
  if (three) {
    const h = three[1] ?? '000';
    return [0, 1, 2].map((i) => parseInt(h.charAt(i) + h.charAt(i), 16)) as RGB;
  }
  const n = s.match(/[\d.]+/g);
  if (n && n.length >= 3) return [Number(n[0]), Number(n[1]), Number(n[2])];
  return [128, 128, 128];
}

/** Blend a toward b by t (0..1). */
export function mix(a: string, b: string, t: number): string {
  const x = parse(a);
  const y = parse(b);
  const ch = (i: 0 | 1 | 2) => Math.round(x[i] + (y[i] - x[i]) * t);
  return `rgb(${ch(0)},${ch(1)},${ch(2)})`;
}

export function alpha(c: string, a: number): string {
  const [r, g, b] = parse(c);
  return `rgba(${r},${g},${b},${a})`;
}

export interface Material {
  fill: string;
  shade: string;
  hi: string;
  line: string;
  detail: string;
}

export interface Palette {
  light: string;
  dark: string;
  coord: string;
  select: string;
  dot: string;
  last: string;
  accent: string;
  text: string;
  dim: string;
  good: string;
  bad: string;
  bg: string;
  flash: string;
  bone: Material;
  steel: Material;
  fontPixel: string;
  fontBody: string;
}

export function buildPalette(t: ThemeTokens): Palette {
  const steel = mix(t.info, t.bg, 0.62);
  return {
    light: mix(t.bgChip, t.text, 0.2),
    dark: mix(t.bgRaise, t.bgChip, 0.5),
    coord: alpha(t.text, 0.3),
    select: alpha(t.text, 0.2),
    dot: alpha(t.text, 0.34),
    last: alpha(t.accent, 0.16),
    accent: t.accent,
    text: t.text,
    dim: t.textDim,
    good: t.good,
    bad: t.bad,
    bg: t.bg,
    flash: t.text,
    bone: {
      fill: mix(t.text, t.bg, 0.1),
      shade: mix(t.text, t.bg, 0.4),
      hi: t.text,
      line: t.bgSink,
      detail: mix(t.text, t.bg, 0.72),
    },
    steel: {
      fill: steel,
      shade: mix(steel, t.bgSink, 0.5),
      hi: mix(steel, t.text, 0.3),
      line: mix(t.text, t.bg, 0.3),
      detail: mix(t.text, t.bg, 0.2),
    },
    fontPixel: t.fontPixel,
    fontBody: t.fontBody,
  };
}
