// Generates the PWA icons: deep-grey tile, orange joystick glyph. Pure Node (zlib), no dependencies.
// Run: npm run icons

import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';

const TILE = [0x1a, 0x1a, 0x1c]; // --bg-chip
const GLYPH = [0xff, 0x8c, 0x1a]; // --accent
const SHADE = [0x2a, 0x2a, 0x2e]; // --line

type Shape = (x: number, y: number) => boolean;
const circle = (cx: number, cy: number, r: number): Shape => (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
const rrect = (x0: number, y0: number, x1: number, y1: number, r: number): Shape => (x, y) => {
  const dx = Math.max(x0 + r - x, 0, x - (x1 - r));
  const dy = Math.max(y0 + r - y, 0, y - (y1 - r));
  return x >= x0 && x <= x1 && y >= y0 && y <= y1 && dx * dx + dy * dy <= r * r;
};

// Glyph in unit space, centred on (0.5, 0.5).
const glyph: Shape[] = [
  circle(0.5, 0.3, 0.13), // ball
  rrect(0.465, 0.3, 0.535, 0.66, 0.02), // stick
  rrect(0.22, 0.62, 0.78, 0.76, 0.05), // base
];
const shadow: Shape = rrect(0.22, 0.7, 0.78, 0.76, 0.05);

function render(size: number, scale: number): Buffer {
  const SS = 4; // supersampling per axis
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let py = 0; py < size; py++) {
    raw[py * (size * 3 + 1)] = 0; // filter: none
    for (let px = 0; px < size; px++) {
      let g = 0;
      let s = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const u = ((px + (sx + 0.5) / SS) / size - 0.5) / scale + 0.5;
          const v = ((py + (sy + 0.5) / SS) / size - 0.5) / scale + 0.5;
          if (glyph.some((f) => f(u, v))) {
            if (shadow(u, v)) s++;
            else g++;
          }
        }
      const n = SS * SS;
      const o = py * (size * 3 + 1) + 1 + px * 3;
      for (let c = 0; c < 3; c++) {
        // base plate's lower strip is darkened orange for a bit of depth (no gradient)
        const dark = Math.round(GLYPH[c] * 0.72 + SHADE[c] * 0.28);
        raw[o + c] = Math.round((TILE[c] * (n - g - s) + GLYPH[c] * g + dark * s) / n);
      }
    }
  }
  return png(size, size, raw);
}

function png(w: number, h: number, raw: Buffer): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = join(import.meta.dirname, '..', 'public', 'icons');
mkdirSync(out, { recursive: true });
const icons: [string, number, number][] = [
  ['apple-touch-icon.png', 180, 0.92],
  ['icon-192.png', 192, 0.92],
  ['icon-512.png', 512, 0.92],
  ['icon-maskable-512.png', 512, 0.72], // keeps the glyph inside the maskable safe zone
];
for (const [name, size, scale] of icons) {
  writeFileSync(join(out, name), render(size, scale));
  console.log(`wrote public/icons/${name}`);
}
