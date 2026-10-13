import type { Scoreboard } from './contract';
import { centralStamp } from './dates';
import { findCartridge, onSnapshot, refreshScoreboard, type Snapshot } from './deck';
import { h, sparkline } from './dom';

const dash = (v: string | number | null | undefined) => (v === null || v === undefined ? '—' : v);

function board(b: Scoreboard): HTMLElement[] {
  const rows = b.games.map((g) =>
    h(
      'tr',
      {},
      h('th.game', { scope: 'row' }, findCartridge(g.id)?.manifest.title ?? g.title),
      h('td.digits', { 'data-label': 'PLAYS' }, g.plays),
      h('td.digits', { 'data-label': 'WINS' }, g.wins),
      h('td.digits', { 'data-label': 'WIN%' }, `${g.win_pct}%`),
      h('td.digits', { 'data-label': 'BEST' }, dash(g.best)),
      h('td.digits', { 'data-label': 'STREAK' }, `${g.streak}/${g.longest_streak}`),
      h('td.date', { 'data-label': 'LAST' }, dash(g.last_played)),
      h('td.sparkcell', { 'data-label': '30 DAYS' }, sparkline(g.spark)),
    ),
  );

  const daily = b.daily?.games.length
    ? h(
        'div.daily',
        {},
        h('h3.section-title', {}, 'DAILIES'),
        ...b.daily.games.map((d) =>
          h(
            'div.daily-row',
            {},
            h('span', {}, findCartridge(d.id)?.manifest.title ?? d.title),
            h(d.done_today ? 'span.tag.good' : 'span.tag.warn', {}, d.done_today ? 'DONE TODAY' : 'NOT YET'),
            h('span.digits', {}, `${d.streak}`),
            h('small.dim', {}, `best ${d.longest_streak}`),
          ),
        ),
      )
    : null;

  return [
    h(
      'div.deck-streak',
      {},
      h('span.label', {}, 'DECK STREAK'),
      h('span.big.digits', {}, b.deck_streak),
      h(
        'span.deck-meta',
        {},
        h('span', {}, `BEST ${b.deck_streak_best}`),
        h(b.today_played ? 'span.tag.good' : 'span.tag.warn', {}, b.today_played ? 'TODAY ✓' : 'PLAY TODAY'),
      ),
    ),
    h(
      'div.table-wrap',
      {},
      h(
        'table.hiscore',
        {},
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            ...['GAME', 'PLAYS', 'WINS', 'WIN%', 'BEST', 'STREAK', 'LAST', '30 DAYS'].map((t) => h('th', { scope: 'col' }, t)),
          ),
        ),
        h('tbody', {}, ...rows),
      ),
    ),
    ...(daily ? [daily] : []),
  ];
}

export function renderScoreboard(main: HTMLElement): () => void {
  const status = h('p.stamp-line');
  const body = h('div.scoreboard');
  main.replaceChildren(h('h2.section-title', {}, 'HIGH SCORES'), status, body);
  void refreshScoreboard();

  return onSnapshot((s: Snapshot) => {
    const parts = [
      s.board ? `as of ${centralStamp(s.board.generated_at)}` : 'no snapshot yet',
      s.note,
      s.stale && s.board && !s.mock ? 'STALE' : null,
    ].filter(Boolean);
    status.textContent = parts.join(' · ');
    status.classList.toggle('warn', s.stale && !s.mock);
    body.replaceChildren(...(s.board ? board(s.board) : [h('p.empty', {}, 'Nothing here yet. Play something.')]));
  });
}
