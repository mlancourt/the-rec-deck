// The only module that talks to the network. The only host it talks to is the Worker.

import type { ResultEnvelope, Scoreboard } from './contract';

export interface ApiConfig {
  base: string;
  token: string;
  fetch?: typeof fetch;
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function request(cfg: ApiConfig, path: string, init: RequestInit = {}): Promise<Response> {
  const f = cfg.fetch ?? globalThis.fetch.bind(globalThis);
  return f(`${cfg.base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
}

export function isConfigured(cfg: ApiConfig): boolean {
  return Boolean(cfg.base && cfg.token);
}

/** Resolves with the raw Response; rejects only on network failure. The queue decides what 2xx means. */
export function postResult(cfg: ApiConfig, envelope: ResultEnvelope): Promise<Response> {
  return request(cfg, '/api/result', { method: 'POST', body: JSON.stringify(envelope) });
}

export async function getStats(cfg: ApiConfig): Promise<Scoreboard> {
  const res = await request(cfg, '/api/stats');
  if (!res.ok) throw new ApiError(res.status, `stats ${res.status}`);
  return (await res.json()) as Scoreboard;
}
