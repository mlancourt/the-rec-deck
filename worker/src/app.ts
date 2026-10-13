// rec-deck-api routes: stores results in KV and serves the scoreboard. Single user, bearer-token auth.

import type { CartridgeKind, CartridgeScoring, Outcome, ResultEnvelope, Scoreboard } from '../../src/shell/contract';
import { buildScoreboard, isValidDate, type ResultRecord } from './streaks';
import type { Env } from './types';

export const VERSION = '0.1.0';

const OUTCOMES: Outcome[] = ['win', 'loss', 'draw', 'complete', 'abandon'];
const KINDS: CartridgeKind[] = ['session', 'daily', 'endless'];
const SCORINGS: CartridgeScoring[] = ['winloss', 'score', 'time', 'moves'];

const MONTHS_KEY = 'months';
const SCOREBOARD_KEY = 'scoreboard';
const monthKey = (date: string) => `results:${date.slice(0, 7)}`;

function allowedOrigin(origin: string | null): string | null {
  if (!origin) return null;
  if (origin === 'https://games.lannyai.com') return origin;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  return null;
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = allowedOrigin(req.headers.get('Origin'));
  if (!origin) return { Vary: 'Origin' };
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders(req) },
  });
}

/** Constant-time string compare so the token can't be guessed byte by byte from timing. */
function sameToken(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

function authorized(req: Request, env: Env): boolean {
  const header = req.headers.get('Authorization') ?? '';
  const m = /^Bearer (.+)$/.exec(header);
  return Boolean(env.API_TOKEN && m && sameToken(m[1], env.API_TOKEN));
}

/** Validate a POST body into a stored record, or return a reason. */
export function parseEnvelope(body: unknown): ResultEnvelope | string {
  if (!body || typeof body !== 'object') return 'body must be a JSON object';
  const b = body as Record<string, unknown>;
  if (typeof b.result_id !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(b.result_id)) return 'result_id';
  if (typeof b.game !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(b.game)) return 'game';
  if (typeof b.date !== 'string' || !isValidDate(b.date)) return 'date';
  if (!OUTCOMES.includes(b.outcome as Outcome)) return 'outcome';
  if (typeof b.duration_s !== 'number' || !Number.isFinite(b.duration_s) || b.duration_s < 0) return 'duration_s';
  if (b.score !== undefined && (typeof b.score !== 'number' || !Number.isFinite(b.score))) return 'score';
  if (b.meta !== undefined && (typeof b.meta !== 'object' || b.meta === null || Array.isArray(b.meta))) return 'meta';
  const c = b.cartridge as Record<string, unknown> | undefined;
  if (!c || typeof c.title !== 'string' || !KINDS.includes(c.kind as CartridgeKind) || !SCORINGS.includes(c.scoring as CartridgeScoring))
    return 'cartridge';
  const env: ResultEnvelope = {
    result_id: b.result_id,
    game: b.game,
    date: b.date,
    outcome: b.outcome as Outcome,
    duration_s: b.duration_s,
    cartridge: { title: c.title.slice(0, 64), kind: c.kind as CartridgeKind, scoring: c.scoring as CartridgeScoring },
  };
  if (b.score !== undefined) env.score = b.score as number;
  if (b.meta !== undefined) env.meta = b.meta as Record<string, unknown>;
  return env;
}

async function loadAll(env: Env): Promise<{ months: string[]; byMonth: Map<string, ResultRecord[]> }> {
  const months = (await env.RESULTS.get<string[]>(MONTHS_KEY, 'json')) ?? [];
  const lists = await Promise.all(months.map((m) => env.RESULTS.get<ResultRecord[]>(`results:${m}`, 'json')));
  return { months, byMonth: new Map(months.map((m, i) => [m, lists[i] ?? []])) };
}

async function postResult(req: Request, env: Env, now: Date): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(req, 400, { error: 'invalid JSON' });
  }
  const parsed = parseEnvelope(body);
  if (typeof parsed === 'string') return json(req, 400, { error: `invalid ${parsed}` });

  const { months, byMonth } = await loadAll(env);
  const all = [...byMonth.values()].flat();
  if (all.some((r) => r.result_id === parsed.result_id)) {
    // Idempotent: already stored. 200 with the current scoreboard so the client dequeues it.
    const board = (await env.RESULTS.get<Scoreboard>(SCOREBOARD_KEY, 'json')) ?? buildScoreboard(all, now);
    return json(req, 200, board);
  }

  const record: ResultRecord = { ...parsed, received_at: now.toISOString() };
  const month = parsed.date.slice(0, 7);
  const list = byMonth.get(month) ?? [];
  list.push(record);
  await env.RESULTS.put(monthKey(parsed.date), JSON.stringify(list));
  if (!months.includes(month)) await env.RESULTS.put(MONTHS_KEY, JSON.stringify([...months, month].sort()));

  const board = buildScoreboard([...all, record], now);
  await env.RESULTS.put(SCOREBOARD_KEY, JSON.stringify(board));
  return json(req, 201, board);
}

async function getStats(req: Request, env: Env, now: Date): Promise<Response> {
  // Recompute on read too: streaks depend on "today", which moves even when no results arrive.
  const { byMonth } = await loadAll(env);
  return json(req, 200, buildScoreboard([...byMonth.values()].flat(), now));
}

export async function handle(req: Request, env: Env, now: Date = new Date()): Promise<Response> {
  const { pathname } = new URL(req.url);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (!authorized(req, env)) return json(req, 401, { error: 'unauthorized' });

  if (pathname === '/api/health' && req.method === 'GET') return json(req, 200, { ok: true, version: VERSION });
  if (pathname === '/api/stats' && req.method === 'GET') return getStats(req, env, now);
  if (pathname === '/api/result' && req.method === 'POST') return postResult(req, env, now);
  return json(req, 404, { error: 'not found' });
}
