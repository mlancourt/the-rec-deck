import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as registry from './_registry';
import type { Cartridge } from '../shell/contract';

const entries = Object.entries(registry) as [string, Cartridge][];
const dir = join(import.meta.dirname, '.');
const folders = readdirSync(dir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
  .map((d) => d.name);

// Things a cartridge must never reach for: network, storage, the URL, or DOM outside its `el`.
const FORBIDDEN = [
  /\bfetch\s*\(/,
  /XMLHttpRequest/,
  /WebSocket/,
  /sendBeacon/,
  /localStorage/,
  /sessionStorage/,
  /indexedDB/,
  /document\.cookie/,
  /\blocation\b/,
  /\bhistory\./,
  /document\.(body|head|documentElement|querySelector|querySelectorAll|getElementById|getElementsBy)/,
  /\bwindow\.(open|top|parent)\b/,
];

function sources(folder: string): string[] {
  const out: string[] = [];
  const walk = (p: string) => {
    for (const d of readdirSync(p, { withFileTypes: true })) {
      const full = join(p, d.name);
      if (d.isDirectory()) walk(full);
      else if (/\.ts$/.test(d.name) && !/\.test\.ts$/.test(d.name)) out.push(full);
    }
  };
  walk(join(dir, folder));
  return out;
}

describe('cartridge registry', () => {
  it('has at least one cartridge', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it('registers every cartridge folder exactly once', () => {
    const ids = entries.map(([, c]) => c.manifest.id).sort();
    expect(ids).toEqual([...folders].sort());
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe.each(entries)('cartridge %s', (_name, cart) => {
  const m = cart.manifest;

  it('exports a well-formed manifest', () => {
    expect(Object.keys(m).sort()).toEqual(['icon', 'id', 'kind', 'scoring', 'tagline', 'title', 'version']);
    expect(m.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(m.title).toBeTypeOf('string');
    expect(m.title.length).toBeGreaterThan(0);
    expect(m.tagline).toBeTypeOf('string');
    expect(m.icon).toBeTypeOf('string');
    expect(m.icon.length).toBeGreaterThan(0);
    expect(['session', 'daily', 'endless']).toContain(m.kind);
    expect(['winloss', 'score', 'time', 'moves']).toContain(m.scoring);
    expect(m.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('exports mount(el, ctx)', () => {
    expect(cart.mount).toBeTypeOf('function');
    expect(cart.mount.length).toBe(2);
  });

  it('exports nothing beyond manifest and mount', () => {
    expect(Object.keys(cart).sort()).toEqual(['manifest', 'mount']);
  });

  it('never touches network, storage, the URL, or DOM outside its element', () => {
    for (const file of sources(m.id)) {
      const src = readFileSync(file, 'utf8').replace(/\/\/.*$/gm, '');
      for (const re of FORBIDDEN) expect(src, `${file} matches ${re}`).not.toMatch(re);
    }
  });
});
