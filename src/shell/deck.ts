// Shell state: the cartridge list, the scoreboard snapshot, and the result queue.

import * as registry from '../cartridges/_registry';
import { getStats, isConfigured, postResult, type ApiConfig } from './api';
import type { Cartridge, GameResult, ResultEnvelope, Scoreboard } from './contract';
import { centralToday } from './dates';
import { prefs, readJSON, writeJSON } from './prefs';
import { createQueue, idbStore, newResultId } from './queue';

export const isMock: boolean =
  import.meta.env.VITE_MOCK === '1' || new URLSearchParams(location.search).has('mock');

export const cartridges: Cartridge[] = (Object.values(registry) as Cartridge[]).sort((a, b) =>
  a.manifest.title.localeCompare(b.manifest.title),
);

export function findCartridge(id: string): Cartridge | undefined {
  return cartridges.find((c) => c.manifest.id === id);
}

/** FNV-1a: stable 32-bit seed per (cartridge id, Central date). */
export function seedFor(id: string, today: string): number {
  let h = 0x811c9dc5;
  for (const ch of `${id}:${today}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// ---- scoreboard snapshot ----

export interface Snapshot {
  board: Scoreboard | null;
  /** True when we're showing a cached copy because the Worker couldn't be reached. */
  stale: boolean;
  mock: boolean;
  note: string | null;
}

const listeners = new Set<(s: Snapshot) => void>();
let snapshot: Snapshot = { board: readJSON<Scoreboard>('stats'), stale: true, mock: isMock, note: null };

function setSnapshot(next: Partial<Snapshot>): void {
  snapshot = { ...snapshot, ...next };
  for (const fn of listeners) fn(snapshot);
}

export function onSnapshot(fn: (s: Snapshot) => void): () => void {
  listeners.add(fn);
  fn(snapshot);
  return () => listeners.delete(fn);
}

function apiConfig(): ApiConfig {
  return { base: prefs.apiBase, token: prefs.token };
}

function acceptBoard(board: Scoreboard): void {
  writeJSON('stats', board);
  setSnapshot({ board, stale: false, note: null });
}

export async function refreshScoreboard(): Promise<void> {
  if (isMock) {
    const { fakeScoreboard } = await import('../../tools/fake-scoreboard');
    setSnapshot({ board: fakeScoreboard(centralToday()), stale: false, mock: true, note: 'MOCK DATA' });
    return;
  }
  const cfg = apiConfig();
  if (!isConfigured(cfg)) {
    setSnapshot({ stale: true, note: 'NO TOKEN — set one in Settings' });
    return;
  }
  try {
    acceptBoard(await getStats(cfg));
  } catch (e) {
    const status = (e as { status?: number }).status;
    setSnapshot({ stale: true, note: status === 401 ? 'TOKEN REJECTED' : 'OFFLINE' });
  }
}

// ---- result queue ----

const pendingListeners = new Set<(n: number) => void>();

export const queue = createQueue(idbStore(), () => {
  const cfg = apiConfig();
  if (isMock || !isConfigured(cfg)) return null;
  return (item) => postResult(cfg, item);
});

async function announcePending(): Promise<void> {
  const n = await queue.size().catch(() => 0);
  for (const fn of pendingListeners) fn(n);
}

export function onPending(fn: (n: number) => void): () => void {
  pendingListeners.add(fn);
  void announcePending();
  return () => pendingListeners.delete(fn);
}

export async function flushQueue(): Promise<void> {
  try {
    const report = await queue.flush();
    const body = report.lastBody as Scoreboard | null;
    if (body && typeof body === 'object' && 'deck_streak' in body) acceptBoard(body);
  } catch {
    /* store unavailable; results stay where they are */
  }
  await announcePending();
}

export async function submitResult(cart: Cartridge, result: GameResult): Promise<void> {
  const m = cart.manifest;
  const envelope: ResultEnvelope = {
    ...result,
    game: m.id,
    date: /^\d{4}-\d{2}-\d{2}$/.test(result.date) ? result.date : centralToday(),
    result_id: newResultId(),
    cartridge: { title: m.title, kind: m.kind, scoring: m.scoring },
  };
  await queue.enqueue({ ...envelope, queued_at: Date.now() });
  await announcePending();
  await flushQueue();
}

export function startSync(): void {
  void flushQueue().then(refreshScoreboard);
  addEventListener('online', () => void flushQueue().then(refreshScoreboard));
}
