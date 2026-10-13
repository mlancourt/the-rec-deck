import { beforeEach, describe, expect, it } from 'vitest';
import type { Scoreboard } from '../../src/shell/contract';
import { handle, parseEnvelope, VERSION } from '../src/app';
import type { Env, KVNamespace } from '../src/types';

function memoryKV(): KVNamespace & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    async get<T>(key: string) {
      const v = data.get(key);
      return v === undefined ? null : (JSON.parse(v) as T);
    },
    async put(key: string, value: string) {
      data.set(key, value);
    },
  };
}

const TOKEN = 'test-token-not-real';
const NOW = new Date('2026-10-13T17:00:00Z'); // 2026-10-13 Central
let env: Env & { RESULTS: ReturnType<typeof memoryKV> };

beforeEach(() => {
  env = { RESULTS: memoryKV(), API_TOKEN: TOKEN };
});

function req(path: string, init: RequestInit & { token?: string | null; origin?: string } = {}): Request {
  const { token = TOKEN, origin, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (token !== null) headers.set('Authorization', `Bearer ${token}`);
  if (origin) headers.set('Origin', origin);
  return new Request(`https://rec-deck-api.example.workers.dev${path}`, { ...rest, headers });
}

const result = (over: Record<string, unknown> = {}) => ({
  result_id: '11111111-2222-4333-8444-555555555555',
  game: 'coin-flip',
  date: '2026-10-13',
  outcome: 'win',
  duration_s: 4,
  meta: { guess: 'H' },
  cartridge: { title: 'COIN FLIP', kind: 'session', scoring: 'winloss' },
  ...over,
});

const post = (body: unknown) => handle(req('/api/result', { method: 'POST', body: JSON.stringify(body) }), env, NOW);

describe('auth', () => {
  it('rejects missing, wrong, and unconfigured tokens with 401', async () => {
    expect((await handle(req('/api/health', { token: null }), env, NOW)).status).toBe(401);
    expect((await handle(req('/api/health', { token: 'wrong' }), env, NOW)).status).toBe(401);
    expect((await handle(req('/api/health'), { ...env, API_TOKEN: '' }, NOW)).status).toBe(401);
  });
  it('health responds with a valid token', async () => {
    const res = await handle(req('/api/health'), env, NOW);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, version: VERSION });
  });
  it('unknown routes are 404', async () => {
    expect((await handle(req('/api/nope'), env, NOW)).status).toBe(404);
  });
});

describe('CORS', () => {
  it('answers preflight for the production origin and localhost', async () => {
    for (const origin of ['https://games.lannyai.com', 'http://localhost:5173', 'http://127.0.0.1:4173']) {
      const res = await handle(req('/api/result', { method: 'OPTIONS', token: null, origin }), env, NOW);
      expect(res.status).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe(origin);
      expect(res.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
    }
  });
  it('does not allow other origins', async () => {
    const res = await handle(req('/api/stats', { origin: 'https://evil.example' }), env, NOW);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
  it('includes CORS headers on 401s so the browser can read them', async () => {
    const res = await handle(req('/api/stats', { token: null, origin: 'https://games.lannyai.com' }), env, NOW);
    expect(res.status).toBe(401);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://games.lannyai.com');
  });
});

describe('POST /api/result', () => {
  it('stores the result in its month and returns the new scoreboard with 201', async () => {
    const res = await post(result());
    expect(res.status).toBe(201);
    const board = (await res.json()) as Scoreboard;
    expect(board.deck_streak).toBe(1);
    expect(board.games[0]).toMatchObject({ id: 'coin-flip', title: 'COIN FLIP', plays: 1, wins: 1 });
    expect(JSON.parse(env.RESULTS.data.get('results:2026-10')!)).toHaveLength(1);
    expect(JSON.parse(env.RESULTS.data.get('months')!)).toEqual(['2026-10']);
    expect(JSON.parse(env.RESULTS.data.get('scoreboard')!)).toEqual(board);
  });

  it('is idempotent on result_id', async () => {
    await post(result());
    const again = await post(result());
    expect(again.status).toBe(200);
    expect(((await again.json()) as Scoreboard).games[0].plays).toBe(1);
    expect(JSON.parse(env.RESULTS.data.get('results:2026-10')!)).toHaveLength(1);
  });

  it('recomputes the scoreboard if the cached copy is missing on a duplicate', async () => {
    await post(result());
    env.RESULTS.data.delete('scoreboard');
    const again = await post(result());
    expect(((await again.json()) as Scoreboard).games[0].plays).toBe(1);
  });

  it('files results by their own Central date, keeping the month index sorted', async () => {
    await post(result());
    await post(result({ result_id: 'aaaaaaaa-0000-4000-8000-000000000001', date: '2026-09-30', outcome: 'loss' }));
    expect(JSON.parse(env.RESULTS.data.get('months')!)).toEqual(['2026-09', '2026-10']);
    expect(JSON.parse(env.RESULTS.data.get('results:2026-09')!)).toHaveLength(1);
  });

  it('rejects bad bodies with 400', async () => {
    const bad = await handle(req('/api/result', { method: 'POST', body: '{nope' }), env, NOW);
    expect(bad.status).toBe(400);
    for (const over of [
      { result_id: 'x' },
      { game: 'Not Kebab' },
      { date: '2026-02-30' },
      { outcome: 'victory' },
      { duration_s: -1 },
      { score: 'lots' },
      { meta: [1] },
      { cartridge: { title: 'X', kind: 'forever', scoring: 'winloss' } },
    ]) {
      expect((await post(result(over))).status, JSON.stringify(over)).toBe(400);
    }
    expect(env.RESULTS.data.size).toBe(0);
  });
});

describe('parseEnvelope', () => {
  it('drops unknown fields and keeps optional ones', () => {
    const parsed = parseEnvelope({ ...result({ score: 12 }), extra: 'ignored' });
    expect(parsed).toMatchObject({ score: 12, meta: { guess: 'H' } });
    expect(parsed).not.toHaveProperty('extra');
    expect(parseEnvelope(null)).toBe('body must be a JSON object');
  });
});

describe('GET /api/stats', () => {
  it('recomputes against the request day', async () => {
    await post(result());
    const tomorrow = await handle(req('/api/stats'), env, new Date('2026-10-14T17:00:00Z'));
    expect(((await tomorrow.json()) as Scoreboard).deck_streak).toBe(1); // yesterday still counts
    const later = await handle(req('/api/stats'), env, new Date('2026-10-15T17:00:00Z'));
    const board = (await later.json()) as Scoreboard;
    expect(board.deck_streak).toBe(0);
    expect(board.deck_streak_best).toBe(1);
  });
  it('is empty before anything is played', async () => {
    const res = await handle(req('/api/stats'), env, NOW);
    expect(((await res.json()) as Scoreboard).games).toEqual([]);
  });
});
