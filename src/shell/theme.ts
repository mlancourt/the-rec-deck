import type { ThemeTokens } from './contract';

const VARS: Record<keyof ThemeTokens, string> = {
  bg: '--bg',
  bgRaise: '--bg-raise',
  bgSink: '--bg-sink',
  bgChip: '--bg-chip',
  line: '--line',
  lineSoft: '--line-soft',
  text: '--text',
  textDim: '--text-dim',
  textFaint: '--text-faint',
  accent: '--accent',
  good: '--good',
  warn: '--warn',
  bad: '--bad',
  info: '--info',
  radius: '--radius',
  fontPixel: '--font-pixel',
  fontBody: '--font-body',
};

/** Resolved token values, read from :root so the CSS stays the single source of truth. */
export function readTheme(): ThemeTokens {
  const cs = getComputedStyle(document.documentElement);
  const out = {} as ThemeTokens;
  for (const [k, v] of Object.entries(VARS)) out[k as keyof ThemeTokens] = cs.getPropertyValue(v).trim();
  return out;
}
