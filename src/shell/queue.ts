// Result queue: every report is persisted BEFORE any network attempt and removed only on a 2xx.
// A result is never lost because the network was down.

import type { ResultEnvelope } from './contract';

export interface QueuedResult extends ResultEnvelope {
  queued_at: number;
}

export interface QueueStore {
  put(item: QueuedResult): Promise<void>;
  all(): Promise<QueuedResult[]>;
  remove(result_id: string): Promise<void>;
}

/** Send one result; resolve with a Response-like object, reject on network failure. */
export type Sender = (item: QueuedResult) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface FlushReport {
  sent: number;
  failed: number;
  remaining: number;
  /** Body of the last successful response (the Worker returns the new scoreboard). */
  lastBody: unknown;
}

export interface ResultQueue {
  enqueue(item: QueuedResult): Promise<void>;
  flush(): Promise<FlushReport>;
  size(): Promise<number>;
}

export function createQueue(store: QueueStore, send: () => Sender | null): ResultQueue {
  let inflight: Promise<FlushReport> | null = null;

  async function runFlush(): Promise<FlushReport> {
    const items = (await store.all()).sort((a, b) => a.queued_at - b.queued_at);
    const sender = send();
    const report: FlushReport = { sent: 0, failed: 0, remaining: items.length, lastBody: null };
    if (!sender) return report;
    for (const item of items) {
      try {
        const res = await sender(item);
        if (res.ok) {
          await store.remove(item.result_id);
          report.sent++;
          report.remaining--;
          report.lastBody = await res.json().catch(() => null);
        } else {
          report.failed++;
          // 401 means every send will fail; stop hammering until the token is fixed.
          if (res.status === 401) break;
        }
      } catch {
        report.failed++;
        break; // offline: try again on the next trigger
      }
    }
    return report;
  }

  return {
    async enqueue(item) {
      await store.put(item);
    },
    flush() {
      // Coalesce concurrent triggers (load + online + report) into one pass.
      inflight ??= runFlush().finally(() => {
        inflight = null;
      });
      return inflight;
    },
    async size() {
      return (await store.all()).length;
    },
  };
}

export function memoryStore(): QueueStore {
  const map = new Map<string, QueuedResult>();
  return {
    async put(item) {
      map.set(item.result_id, structuredClone(item));
    },
    async all() {
      return [...map.values()].map((v) => structuredClone(v));
    },
    async remove(id) {
      map.delete(id);
    },
  };
}

const DB = 'recdeck';
const STORE = 'results';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'result_id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export function idbStore(): QueueStore {
  let db: Promise<IDBDatabase> | null = null;
  const get = () => (db ??= openDb());
  return {
    async put(item) {
      await tx(await get(), 'readwrite', (s) => s.put(item));
    },
    async all() {
      return tx(await get(), 'readonly', (s) => s.getAll() as IDBRequest<QueuedResult[]>);
    },
    async remove(id) {
      await tx(await get(), 'readwrite', (s) => s.delete(id));
    },
  };
}

export function deleteQueueDb(): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(DB);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

export function newResultId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
