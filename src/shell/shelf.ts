import type { Cartridge, GameStats } from './contract';
import { cartridges, onSnapshot } from './deck';
import { h } from './dom';

function cornerStat(cart: Cartridge, s: GameStats | undefined): HTMLElement {
  if (!s || s.plays === 0) return h('span.corner.dim', {}, 'NEW');
  if (cart.manifest.scoring === 'winloss' || cart.manifest.kind === 'daily')
    return h('span.corner', { title: `Longest ${s.longest_streak}` }, h('small', {}, 'STREAK'), h('b.digits', {}, s.streak));
  return h('span.corner', {}, h('small', {}, 'BEST'), h('b.digits', {}, s.best ?? '—'));
}

export function renderShelf(main: HTMLElement): () => void {
  const grid = h('div.shelf');
  main.replaceChildren(h('h2.section-title', {}, 'CARTRIDGES'), grid);

  return onSnapshot(({ board }) => {
    grid.replaceChildren(
      ...cartridges.map((cart) => {
        const m = cart.manifest;
        const stats = board?.games.find((g) => g.id === m.id);
        return h(
          'a.card',
          { href: `#/play/${m.id}`, 'aria-label': `Play ${m.title}` },
          h('span.card-icon', { 'aria-hidden': 'true' }, m.icon),
          h('span.card-body', {}, h('span.card-title', {}, m.title), h('span.card-tagline', {}, m.tagline)),
          cornerStat(cart, stats),
          h('span.stamp', {}, stats?.last_played ? `LAST ${stats.last_played}` : 'NEVER PLAYED'),
        );
      }),
    );
  });
}
