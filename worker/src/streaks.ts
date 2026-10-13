// ALL streak and scoreboard math lives here. Pure functions only: no I/O, no clock reads.
// Dates are Central YYYY-MM-DD strings; results carry their own `date` and we trust it.

import type { CartridgeScoring, DailyStats, GameStats, ResultEnvelope, Scoreboard } from '../../src/shell/contract';

export interface ResultRecord extends ResultEnvelope {
  received_at: string; // ISO instant the Worker accepted it; orders results within a day
}

const central = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Chicago',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Central calendar date of an instant. */
export function centralDate(now: Date): string {
  return central.format(now);
}

/** Calendar arithmetic on YYYY-MM-DD without ever parsing it as a Date string. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function isValidDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && addDays(date, 0) === date;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Oldest first: by Central date, then arrival, then id (total order, deterministic). */
export function chronological<T extends ResultRecord>(records: readonly T[]): T[] {
  return [...records].sort((a, b) => cmp(a.date, b.date) || cmp(a.received_at, b.received_at) || cmp(a.result_id, b.result_id));
}

/** Consecutive dates ending at `today` or, if today has none yet, at yesterday. */
export function currentRun(dates: ReadonlySet<string>, today: string): number {
  let day = dates.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (dates.has(day)) {
    n++;
    day = addDays(day, -1);
  }
  return n;
}

/** Longest run of consecutive dates anywhere in the set. */
export function longestRun(dates: ReadonlySet<string>): number {
  let best = 0;
  for (const d of dates) {
    if (dates.has(addDays(d, -1))) continue; // only start counting at the beginning of a run
    let n = 0;
    let day = d;
    while (dates.has(day)) {
      n++;
      day = addDays(day, 1);
    }
    best = Math.max(best, n);
  }
  return best;
}

/** Dates with at least one result whose outcome isn't 'abandon'. */
export function playedDates(records: readonly ResultRecord[]): Set<string> {
  return new Set(records.filter((r) => r.outcome !== 'abandon').map((r) => r.date));
}

export function deckStreak(records: readonly ResultRecord[], today: string): { current: number; longest: number } {
  const dates = playedDates(records);
  return { current: currentRun(dates, today), longest: longestRun(dates) };
}

/**
 * Per-game win streak over results in chronological order.
 * win extends · loss breaks · draw/complete neither extend nor break · abandon breaks nothing (a play only).
 */
export function winStreak(records: readonly ResultRecord[]): { current: number; longest: number } {
  let current = 0;
  let longest = 0;
  for (const r of chronological(records)) {
    if (r.outcome === 'win') longest = Math.max(longest, ++current);
    else if (r.outcome === 'loss') current = 0;
  }
  return { current, longest };
}

/** Daily-kind streak: consecutive dates with a 'win' or 'complete'. */
export function dailyStreak(
  records: readonly ResultRecord[],
  today: string,
): { current: number; longest: number; doneToday: boolean } {
  const dates = new Set(records.filter((r) => r.outcome === 'win' || r.outcome === 'complete').map((r) => r.date));
  return { current: currentRun(dates, today), longest: longestRun(dates), doneToday: dates.has(today) };
}

/** Best result for the cartridge's scoring: highest score, or lowest time/moves among finished games. */
export function bestOf(records: readonly ResultRecord[], scoring: CartridgeScoring): number | null {
  if (scoring === 'winloss') return null;
  if (scoring === 'score') {
    const scores = records.filter((r) => r.outcome !== 'abandon' && typeof r.score === 'number').map((r) => r.score as number);
    return scores.length ? Math.max(...scores) : null;
  }
  const finished = records.filter((r) => r.outcome === 'win' || r.outcome === 'complete');
  const values = finished
    .map((r) => (typeof r.score === 'number' ? r.score : scoring === 'time' ? r.duration_s : null))
    .filter((v): v is number => v !== null);
  return values.length ? Math.min(...values) : null;
}

/** Plays per day for the 30 Central dates ending today, oldest first. */
export function spark(records: readonly ResultRecord[], today: string): number[] {
  const index = new Map(Array.from({ length: 30 }, (_, i) => [addDays(today, i - 29), i] as const));
  const out = new Array<number>(30).fill(0);
  for (const r of records) {
    const i = index.get(r.date);
    if (i !== undefined) out[i]++;
  }
  return out;
}

function maxDate(records: readonly ResultRecord[]): string | null {
  return records.reduce<string | null>((m, r) => (m === null || r.date > m ? r.date : m), null);
}

export function gameStats(id: string, records: readonly ResultRecord[], today: string): GameStats {
  const ordered = chronological(records);
  const latest = ordered[ordered.length - 1];
  const plays = records.length;
  const wins = records.filter((r) => r.outcome === 'win').length;
  const decided = records.filter((r) => r.outcome !== 'abandon').length;
  const s = winStreak(records);
  return {
    id,
    title: latest?.cartridge.title ?? id,
    plays,
    wins,
    win_pct: decided ? Math.round((wins / decided) * 100) : 0,
    best: latest ? bestOf(records, latest.cartridge.scoring) : null,
    streak: s.current,
    longest_streak: s.longest,
    last_played: maxDate(records),
    spark: spark(records, today),
  };
}

export function buildScoreboard(records: readonly ResultRecord[], now: Date): Scoreboard {
  const today = centralDate(now);
  const byGame = new Map<string, ResultRecord[]>();
  for (const r of records) {
    const list = byGame.get(r.game);
    if (list) list.push(r);
    else byGame.set(r.game, [r]);
  }

  const games = [...byGame.entries()]
    .map(([id, rs]) => gameStats(id, rs, today))
    .sort((a, b) => cmp(String(b.last_played), String(a.last_played)) || cmp(a.title, b.title));

  const daily: DailyStats[] = [];
  for (const [id, rs] of byGame) {
    const latest = chronological(rs)[rs.length - 1];
    if (latest.cartridge.kind !== 'daily') continue;
    const d = dailyStreak(rs, today);
    daily.push({ id, title: latest.cartridge.title, done_today: d.doneToday, streak: d.current, longest_streak: d.longest });
  }
  daily.sort((a, b) => cmp(a.title, b.title));

  const deck = deckStreak(records, today);
  return {
    generated_at: now.toISOString(),
    deck_streak: deck.current,
    deck_streak_best: deck.longest,
    last_played: maxDate(records),
    today_played: playedDates(records).has(today),
    games,
    daily: daily.length ? { games: daily } : null,
  };
}
