import { describe, expect, it } from 'vitest';
import type { CartridgeKind, CartridgeScoring, Outcome } from '../../src/shell/contract';
import {
  addDays,
  bestOf,
  buildScoreboard,
  centralDate,
  chronological,
  currentRun,
  dailyStreak,
  deckStreak,
  gameStats,
  isValidDate,
  longestRun,
  playedDates,
  spark,
  winStreak,
  type ResultRecord,
} from '../src/streaks';

let seq = 0;
function rec(
  date: string,
  outcome: Outcome,
  opts: Partial<ResultRecord> & { kind?: CartridgeKind; scoring?: CartridgeScoring; title?: string } = {},
): ResultRecord {
  const { kind = 'session', scoring = 'winloss', title = 'TEST GAME', ...rest } = opts;
  seq++;
  return {
    result_id: `r-${String(seq).padStart(6, '0')}`,
    game: 'test-game',
    date,
    outcome,
    duration_s: 10,
    cartridge: { title, kind, scoring },
    received_at: `2000-01-01T00:00:${String(seq % 60).padStart(2, '0')}.${String(seq).padStart(3, '0')}Z`,
    ...rest,
  };
}

const TODAY = '2026-03-10';

describe('dates', () => {
  it('centralDate uses America/Chicago, across DST', () => {
    // CDT (UTC-5): 04:30Z is still the previous Central day.
    expect(centralDate(new Date('2026-10-13T04:30:00Z'))).toBe('2026-10-12');
    expect(centralDate(new Date('2026-10-13T05:30:00Z'))).toBe('2026-10-13');
    // CST (UTC-6)
    expect(centralDate(new Date('2026-01-15T05:30:00Z'))).toBe('2026-01-14');
    expect(centralDate(new Date('2026-01-15T06:30:00Z'))).toBe('2026-01-15');
  });

  it('addDays rolls months, years, and leap days', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09'); // DST start day is still one day
    expect(addDays('2026-05-05', 0)).toBe('2026-05-05');
  });

  it('isValidDate rejects malformed and impossible dates', () => {
    expect(isValidDate('2026-02-28')).toBe(true);
    expect(isValidDate('2026-02-30')).toBe(false);
    expect(isValidDate('2026-2-3')).toBe(false);
    expect(isValidDate('nope')).toBe(false);
  });
});

describe('chronological', () => {
  it('orders by date, then arrival, then id, without mutating input', () => {
    const a = rec('2026-03-02', 'win', { received_at: '2026-03-02T10:00:00Z', result_id: 'b' });
    const b = rec('2026-03-01', 'win', { received_at: '2026-03-05T00:00:00Z' }); // late arrival, earlier date
    const c = rec('2026-03-02', 'win', { received_at: '2026-03-02T09:00:00Z' });
    const d = rec('2026-03-02', 'win', { received_at: '2026-03-02T10:00:00Z', result_id: 'a' });
    const input = [a, b, c, d];
    expect(chronological(input)).toEqual([b, c, d, a]);
    expect(input).toEqual([a, b, c, d]);
  });

  it('treats fully identical keys as equal', () => {
    const a = rec('2026-03-02', 'win', { received_at: 'x', result_id: 'same' });
    const b = { ...a, outcome: 'loss' as const };
    expect(chronological([a, b])).toEqual([a, b]);
  });
});

describe('runs of dates', () => {
  it('currentRun counts back from today', () => {
    expect(currentRun(new Set([TODAY, '2026-03-09', '2026-03-08', '2026-03-06']), TODAY)).toBe(3);
  });
  it('currentRun counts back from yesterday when today has nothing yet', () => {
    expect(currentRun(new Set(['2026-03-09', '2026-03-08']), TODAY)).toBe(2);
  });
  it('currentRun is 0 when neither today nor yesterday has play', () => {
    expect(currentRun(new Set(['2026-03-08', '2026-03-07']), TODAY)).toBe(0);
    expect(currentRun(new Set(), TODAY)).toBe(0);
  });
  it('currentRun crosses month boundaries', () => {
    expect(currentRun(new Set(['2026-03-01', '2026-02-28', '2026-02-27']), '2026-03-01')).toBe(3);
  });
  it('longestRun finds the longest run anywhere', () => {
    expect(longestRun(new Set())).toBe(0);
    expect(longestRun(new Set(['2026-01-01']))).toBe(1);
    expect(longestRun(new Set(['2026-01-01', '2026-01-02', '2026-01-05', '2026-01-06', '2026-01-07', '2026-01-09']))).toBe(3);
    expect(longestRun(new Set(['2025-12-30', '2025-12-31', '2026-01-01']))).toBe(3);
  });
});

describe('deck streak', () => {
  it('ignores abandon-only days', () => {
    const rs = [rec(TODAY, 'abandon'), rec('2026-03-09', 'loss'), rec('2026-03-08', 'draw')];
    expect([...playedDates(rs)].sort()).toEqual(['2026-03-08', '2026-03-09']);
    // today was abandon-only, so the streak ends at yesterday and is still alive
    expect(deckStreak(rs, TODAY)).toEqual({ current: 2, longest: 2 });
  });
  it('a gap breaks it; longest remembers the past', () => {
    const rs = ['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-09', TODAY].map((d) => rec(d, 'complete'));
    expect(deckStreak(rs, TODAY)).toEqual({ current: 2, longest: 4 });
  });
  it('is 0 when the last play was two days ago', () => {
    expect(deckStreak([rec('2026-03-08', 'win')], TODAY)).toEqual({ current: 0, longest: 1 });
  });
  it('counts multiple games on one day once', () => {
    expect(deckStreak([rec(TODAY, 'win'), rec(TODAY, 'loss', { game: 'other' })], TODAY).current).toBe(1);
  });
});

describe('per-game win streak', () => {
  it('wins extend, losses break', () => {
    const rs = ['win', 'win', 'win', 'loss', 'win', 'win'].map((o, i) => rec(addDays('2026-03-01', i), o as Outcome));
    expect(winStreak(rs)).toEqual({ current: 2, longest: 3 });
  });
  it('draws neither extend nor break', () => {
    const rs = ['win', 'draw', 'win', 'draw'].map((o, i) => rec(addDays('2026-03-01', i), o as Outcome));
    expect(winStreak(rs)).toEqual({ current: 2, longest: 2 });
  });
  it('abandons break nothing', () => {
    const rs = ['win', 'abandon', 'abandon', 'win'].map((o, i) => rec(addDays('2026-03-01', i), o as Outcome));
    expect(winStreak(rs)).toEqual({ current: 2, longest: 2 });
  });
  it("'complete' is neutral too", () => {
    const rs = ['win', 'complete', 'win'].map((o, i) => rec(addDays('2026-03-01', i), o as Outcome));
    expect(winStreak(rs)).toEqual({ current: 2, longest: 2 });
  });
  it('uses chronological order, not arrival order', () => {
    const late = rec('2026-03-01', 'loss', { received_at: '2026-03-09T00:00:00Z' }); // queued offline, synced late
    const rs = [rec('2026-03-02', 'win'), rec('2026-03-03', 'win'), late];
    expect(winStreak(rs)).toEqual({ current: 2, longest: 2 });
  });
  it('a loss at the end resets current only', () => {
    const rs = ['win', 'win', 'loss'].map((o, i) => rec(addDays('2026-03-01', i), o as Outcome));
    expect(winStreak(rs)).toEqual({ current: 0, longest: 2 });
  });
  it('is zero with no results', () => {
    expect(winStreak([])).toEqual({ current: 0, longest: 0 });
  });
});

describe('daily streak', () => {
  it('counts consecutive dates with win or complete', () => {
    const rs = [
      rec('2026-03-06', 'win'),
      rec('2026-03-07', 'loss'), // fails the day
      rec('2026-03-08', 'complete'),
      rec('2026-03-09', 'win'),
      rec(TODAY, 'abandon'),
    ];
    expect(dailyStreak(rs, TODAY)).toEqual({ current: 2, longest: 2, doneToday: false });
  });
  it('doneToday once today is won', () => {
    const rs = [rec('2026-03-09', 'win'), rec(TODAY, 'loss'), rec(TODAY, 'win')];
    expect(dailyStreak(rs, TODAY)).toEqual({ current: 2, longest: 2, doneToday: true });
  });
});

describe('bestOf', () => {
  it('winloss has no best', () => {
    expect(bestOf([rec(TODAY, 'win')], 'winloss')).toBeNull();
  });
  it('score: highest, ignoring abandons and missing scores', () => {
    const rs = [rec(TODAY, 'complete', { score: 120 }), rec(TODAY, 'abandon', { score: 999 }), rec(TODAY, 'loss', { score: 300 }), rec(TODAY, 'complete')];
    expect(bestOf(rs, 'score')).toBe(300);
    expect(bestOf([rec(TODAY, 'complete')], 'score')).toBeNull();
  });
  it('time: lowest among finished games, score overrides duration', () => {
    const rs = [
      rec(TODAY, 'win', { duration_s: 90 }),
      rec(TODAY, 'complete', { duration_s: 200, score: 75 }),
      rec(TODAY, 'loss', { duration_s: 5 }),
    ];
    expect(bestOf(rs, 'time')).toBe(75);
    expect(bestOf([rec(TODAY, 'loss')], 'time')).toBeNull();
  });
  it('moves: lowest score among finished games; no score means no value', () => {
    expect(bestOf([rec(TODAY, 'win', { score: 41 }), rec(TODAY, 'win', { score: 38 }), rec(TODAY, 'win')], 'moves')).toBe(38);
    expect(bestOf([rec(TODAY, 'win')], 'moves')).toBeNull();
  });
});

describe('spark', () => {
  it('30 days ending today, oldest first, counting every play', () => {
    const rs = [rec(TODAY, 'win'), rec(TODAY, 'abandon'), rec('2026-02-09', 'win'), rec('2026-02-08', 'win'), rec('2026-03-11', 'win')];
    const s = spark(rs, TODAY);
    expect(s).toHaveLength(30);
    expect(s[29]).toBe(2);
    expect(s[0]).toBe(1); // 2026-02-09 is 29 days before today
    expect(s.reduce((a, b) => a + b, 0)).toBe(3); // 02-08 too old, 03-11 in the future
  });
});

describe('gameStats', () => {
  it('summarises one game', () => {
    const rs = [
      rec('2026-03-08', 'win', { scoring: 'score', score: 10, title: 'OLD TITLE' }),
      rec('2026-03-09', 'loss', { scoring: 'score', score: 50, title: 'NEW TITLE' }),
      rec('2026-03-09', 'abandon', { scoring: 'score', title: 'NEW TITLE' }),
    ];
    const g = gameStats('test-game', rs, TODAY);
    expect(g).toMatchObject({
      id: 'test-game',
      title: 'NEW TITLE',
      plays: 3,
      wins: 1,
      win_pct: 50, // abandons don't count against win %
      best: 50,
      streak: 0,
      longest_streak: 1,
      last_played: '2026-03-09',
    });
  });
  it('handles an empty list and all-abandon lists', () => {
    expect(gameStats('ghost', [], TODAY)).toMatchObject({ title: 'ghost', plays: 0, win_pct: 0, best: null, last_played: null });
    expect(gameStats('quit', [rec(TODAY, 'abandon')], TODAY)).toMatchObject({ plays: 1, win_pct: 0 });
  });
});

describe('buildScoreboard', () => {
  const now = new Date('2026-03-10T18:00:00Z'); // 2026-03-10 in Central (CDT)

  it('an empty store gives an empty board', () => {
    expect(buildScoreboard([], now)).toEqual({
      generated_at: '2026-03-10T18:00:00.000Z',
      deck_streak: 0,
      deck_streak_best: 0,
      last_played: null,
      today_played: false,
      games: [],
      daily: null,
    });
  });

  it('one coin-flip today gives deck_streak 1', () => {
    const b = buildScoreboard([rec(TODAY, 'win', { game: 'coin-flip', title: 'COIN FLIP' })], now);
    expect(b).toMatchObject({ deck_streak: 1, deck_streak_best: 1, today_played: true, last_played: TODAY, daily: null });
    expect(b.games).toHaveLength(1);
    expect(b.games[0]).toMatchObject({ id: 'coin-flip', plays: 1, wins: 1, win_pct: 100, streak: 1 });
  });

  it('groups games, sorts by last played then title, and lists dailies', () => {
    const rs = [
      rec('2026-03-08', 'win', { game: 'zeta', title: 'ZETA' }),
      rec('2026-03-09', 'win', { game: 'beta', title: 'BETA' }),
      rec('2026-03-09', 'loss', { game: 'alpha', title: 'ALPHA' }),
      rec('2026-03-09', 'complete', { game: 'word', title: 'WORD', kind: 'daily', scoring: 'moves', score: 4 }),
      rec(TODAY, 'complete', { game: 'word', title: 'WORD', kind: 'daily', scoring: 'moves', score: 3 }),
      rec('2026-03-09', 'complete', { game: 'cross', title: 'CROSS', kind: 'daily', scoring: 'time' }),
    ];
    const b = buildScoreboard(rs, now);
    expect(b.games.map((g) => g.id)).toEqual(['word', 'alpha', 'beta', 'cross', 'zeta']);
    expect(b.deck_streak).toBe(3);
    expect(b.daily).toEqual({
      games: [
        { id: 'cross', title: 'CROSS', done_today: false, streak: 1, longest_streak: 1 },
        { id: 'word', title: 'WORD', done_today: true, streak: 2, longest_streak: 2 },
      ],
    });
    expect(b.games.find((g) => g.id === 'word')?.best).toBe(3);
  });

  it('uses the Central date of `now`, not UTC', () => {
    // 2026-03-11T03:00Z is still 2026-03-10 in Chicago.
    const b = buildScoreboard([rec(TODAY, 'win')], new Date('2026-03-11T03:00:00Z'));
    expect(b.today_played).toBe(true);
    expect(b.games[0].spark[29]).toBe(1);
  });
});
