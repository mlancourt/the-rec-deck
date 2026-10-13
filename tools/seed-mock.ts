// POSTs INVENTED results to a LOCAL `wrangler dev` so the real scoreboard has something to show.
// Refuses any non-localhost URL: this must never touch the deployed Worker.
//
//   npm run dev:worker            # in one terminal (reads API_TOKEN from worker/.dev.vars)
//   npm run seed:mock -- --days 21 [--url http://localhost:8787]

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const args = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const url = new URL(arg('url', 'http://localhost:8787'));
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
  console.error(`Refusing to seed ${url.origin}: seed-mock only talks to a local wrangler dev.`);
  process.exit(1);
}

function devToken(): string {
  if (process.env.API_TOKEN) return process.env.API_TOKEN;
  try {
    const vars = readFileSync(join(import.meta.dirname, '..', 'worker', '.dev.vars'), 'utf8');
    const m = /^API_TOKEN\s*=\s*"?([^"\n]+)"?/m.exec(vars);
    if (m) return m[1].trim();
  } catch {
    /* fall through */
  }
  console.error('No token: set API_TOKEN or create worker/.dev.vars with API_TOKEN=<local dev token>.');
  process.exit(1);
}

const central = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' });
const addDays = (date: string, n: number) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

const token = devToken();
const days = Number(arg('days', '14'));
const today = central.format(new Date());
let sent = 0;

for (let i = days - 1; i >= 0; i--) {
  const date = addDays(today, -i);
  if (Math.random() < 0.15) continue; // leave some gaps so streaks are interesting
  const games = 1 + Math.floor(Math.random() * 4);
  for (let g = 0; g < games; g++) {
    const r = Math.random();
    const body = {
      result_id: randomUUID(),
      game: 'coin-flip',
      date,
      outcome: r < 0.05 ? 'abandon' : r < 0.52 ? 'win' : 'loss',
      duration_s: 2 + Math.floor(Math.random() * 6),
      meta: { seeded: true },
      cartridge: { title: 'COIN FLIP', kind: 'session', scoring: 'winloss' },
    };
    const res = await fetch(new URL('/api/result', url), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error(`POST failed: ${res.status} ${await res.text()}`);
      process.exit(1);
    }
    sent++;
  }
}

const stats = await (await fetch(new URL('/api/stats', url), { headers: { Authorization: `Bearer ${token}` } })).json();
console.log(`Seeded ${sent} invented results into ${url.origin}. deck_streak=${stats.deck_streak}`);
