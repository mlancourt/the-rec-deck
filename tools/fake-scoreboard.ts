// Invented scoreboard for dev/mock mode (?mock=1 or VITE_MOCK=1). NO real data, ever.
// Deterministic for a given `today` so screenshots are stable.

import type { Scoreboard } from '../src/shell/contract';
import { addDays } from '../src/shell/dates';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function spark(r: () => number, density: number): number[] {
  return Array.from({ length: 30 }, () => (r() < density ? 1 + Math.floor(r() * 5) : 0));
}

export function fakeScoreboard(today: string, now: Date = new Date()): Scoreboard {
  const r = rng(42);
  return {
    generated_at: new Date(now.getTime() - 7 * 60_000).toISOString(),
    deck_streak: 6,
    deck_streak_best: 19,
    last_played: today,
    today_played: true,
    games: [
      {
        id: 'coin-flip',
        title: 'COIN FLIP',
        plays: 87,
        wins: 45,
        win_pct: 52,
        best: null,
        streak: 3,
        longest_streak: 7,
        last_played: today,
        spark: spark(r, 0.7),
      },
      {
        id: 'mock-blocks',
        title: 'MOCK BLOCKS',
        plays: 23,
        wins: 0,
        win_pct: 0,
        best: 48210,
        streak: 0,
        longest_streak: 0,
        last_played: addDays(today, -2),
        spark: spark(r, 0.35),
      },
      {
        id: 'mock-daily',
        title: 'MOCK DAILY',
        plays: 41,
        wins: 38,
        win_pct: 93,
        best: 3,
        streak: 12,
        longest_streak: 25,
        last_played: addDays(today, -1),
        spark: spark(r, 0.9).map((n) => Math.min(n, 1)),
      },
    ],
    daily: {
      games: [{ id: 'mock-daily', title: 'MOCK DAILY', done_today: false, streak: 12, longest_streak: 25 }],
    },
  };
}
