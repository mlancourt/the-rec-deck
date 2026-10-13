import { describe, expect, it, vi } from 'vitest';
import { postResult } from './api';
import { createQueue, memoryStore, type QueuedResult } from './queue';

const item = (id: string, queued_at = 1): QueuedResult => ({
  result_id: id,
  queued_at,
  game: 'coin-flip',
  date: '2026-01-02',
  outcome: 'win',
  duration_s: 3,
  cartridge: { title: 'COIN FLIP', kind: 'session', scoring: 'winloss' },
});

const cfg = { base: 'http://localhost:8787', token: 'test-token' };

describe('result queue', () => {
  it('keeps a result when fetch fails, then sends and removes it when fetch succeeds', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ deck_streak: 1 }), { status: 201 }));
    const store = memoryStore();
    const q = createQueue(store, () => (r) => postResult({ ...cfg, fetch: fetchMock }, r));

    await q.enqueue(item('a'));
    const first = await q.flush();
    expect(first).toMatchObject({ sent: 0, failed: 1, remaining: 1 });
    expect(await q.size()).toBe(1);

    const second = await q.flush();
    expect(second).toMatchObject({ sent: 1, remaining: 0, lastBody: { deck_streak: 1 } });
    expect(await q.size()).toBe(0);

    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('http://localhost:8787/api/result');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer test-token');
    expect(JSON.parse(init?.body as string)).toMatchObject({ result_id: 'a', game: 'coin-flip' });
  });

  it('keeps results on non-2xx responses', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('nope', { status: 500 }));
    const q = createQueue(memoryStore(), () => (r) => postResult({ ...cfg, fetch: fetchMock }, r));
    await q.enqueue(item('a'));
    await q.enqueue(item('b', 2));
    expect(await q.flush()).toMatchObject({ sent: 0, failed: 2, remaining: 2 });
    expect(await q.size()).toBe(2);
  });

  it('stops after a 401 instead of retrying every item', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 401 }));
    const q = createQueue(memoryStore(), () => (r) => postResult({ ...cfg, fetch: fetchMock }, r));
    await q.enqueue(item('a'));
    await q.enqueue(item('b', 2));
    await q.flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await q.size()).toBe(2);
  });

  it('holds everything when no sender is configured (no token)', async () => {
    const q = createQueue(memoryStore(), () => null);
    await q.enqueue(item('a'));
    expect(await q.flush()).toMatchObject({ sent: 0, remaining: 1 });
  });

  it('sends oldest first and coalesces concurrent flushes', async () => {
    const order: string[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (_u, init) => {
      order.push(JSON.parse(init?.body as string).result_id);
      return new Response('{}', { status: 201 });
    });
    const q = createQueue(memoryStore(), () => (r) => postResult({ ...cfg, fetch: fetchMock }, r));
    await q.enqueue(item('late', 5));
    await q.enqueue(item('early', 1));
    const [a, b] = await Promise.all([q.flush(), q.flush()]);
    expect(a).toBe(b);
    expect(order).toEqual(['early', 'late']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('is idempotent on result_id at the store', async () => {
    const q = createQueue(memoryStore(), () => null);
    await q.enqueue(item('a'));
    await q.enqueue(item('a'));
    expect(await q.size()).toBe(1);
  });
});
