import { flushQueue, isMock, onPending, refreshScoreboard } from './deck';
import { h } from './dom';
import { applyEffects } from './effects';
import { clearAllPrefs, prefs } from './prefs';
import { deleteQueueDb } from './queue';

function toggle(label: string, hint: string, get: () => boolean, set: (v: boolean) => void): HTMLElement {
  const input = h('input', { type: 'checkbox', role: 'switch' });
  input.checked = get();
  input.addEventListener('change', () => set(input.checked));
  return h('label.setting', {}, h('span', {}, h('b', {}, label), h('small', {}, hint)), input);
}

export function renderSettings(main: HTMLElement): () => void {
  const token = h('input', { type: 'password', autocomplete: 'off', placeholder: prefs.token ? '•••••• saved' : 'paste token', 'aria-label': 'API token' });
  const base = h('input', { type: 'url', placeholder: 'https://rec-deck-api.example.workers.dev', 'aria-label': 'API endpoint' });
  base.value = prefs.apiBase;
  const saved = h('small.dim', {}, '');
  const pending = h('span.digits', {}, '0');

  const save = () => {
    if (token.value.trim()) prefs.token = token.value;
    prefs.apiBase = base.value;
    token.value = '';
    token.placeholder = prefs.token ? '•••••• saved' : 'paste token';
    saved.textContent = 'Saved.';
    void flushQueue().then(refreshScoreboard);
  };

  const clear = async () => {
    const n = Number(pending.textContent);
    const warn = n > 0 ? `\n\n${n} result(s) have NOT synced yet and will be lost.` : '';
    if (!confirm(`Clear all local data on this device (token, settings, cached scores, queue)?${warn}`)) return;
    clearAllPrefs();
    await deleteQueueDb();
    location.reload();
  };

  main.replaceChildren(
    h('h2.section-title', {}, 'SETTINGS'),
    h(
      'div.settings',
      {},
      toggle('Sound', 'Short chiptune cues', () => prefs.sound, (v) => (prefs.sound = v)),
      toggle('Reduced effects', 'No scanlines, no slot-in animation, no blinking', () => prefs.reducedEffects, (v) => {
        prefs.reducedEffects = v;
        applyEffects();
      }),
      h(
        'div.setting.stack',
        {},
        h('span', {}, h('b', {}, 'Scoreboard API'), h('small', {}, 'Token is stored on this device only.')),
        base,
        token,
        h('div.row', {}, h('button.btn', { onclick: save }, 'Save'), saved),
      ),
      h(
        'div.setting',
        {},
        h('span', {}, h('b', {}, 'Queued results'), h('small', {}, isMock ? 'Mock mode: results are held, never sent.' : 'Waiting to sync.')),
        h('span.row', {}, pending, h('button.btn', { onclick: () => void flushQueue() }, 'Sync now')),
      ),
      h(
        'div.setting',
        {},
        h('span', {}, h('b', {}, 'Clear local data'), h('small', {}, 'Token, settings, cached scores, and the queue.')),
        h('button.btn.danger', { onclick: () => void clear() }, 'Clear'),
      ),
    ),
  );

  return onPending((n) => (pending.textContent = String(n)));
}
