import type { CartridgeContext, GameResult } from './contract';
import { centralToday } from './dates';
import { findCartridge, seedFor, submitResult } from './deck';
import { h } from './dom';
import { prefs, readJSON, removeJSON, writeJSON } from './prefs';
import { play } from './sound';
import { readTheme } from './theme';

/** Slot a cartridge into the cabinet. The game surface stays clean: no effects over gameplay. */
export function renderCabinet(main: HTMLElement, id: string): () => void {
  const cart = findCartridge(id);
  if (!cart) {
    main.replaceChildren(h('p.empty', {}, `No cartridge "${id}". `, h('a', { href: '#/' }, 'Back to the shelf')));
    return () => {};
  }
  const m = cart.manifest;
  const surface = h('div.surface', { 'data-cartridge': m.id });
  const cabinet = h(
    'section.cabinet',
    {},
    h(
      'header.cabinet-bar',
      {},
      h('a.back', { href: '#/', 'aria-label': 'Back to shelf', onclick: () => play('back') }, '‹ SHELF'),
      h('span.cabinet-title', {}, m.title),
    ),
    h('div.bezel', {}, surface),
  );
  main.replaceChildren(cabinet);
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches && !prefs.reducedEffects) cabinet.classList.add('slot-in');

  const today = centralToday();
  const ctx: CartridgeContext = {
    theme: readTheme(),
    today,
    seed: seedFor(m.id, today),
    settings: { sound: prefs.sound, reducedEffects: prefs.reducedEffects },
    save: {
      read: <T>() => readJSON<T>(`save.${m.id}`),
      write: (value: unknown) => writeJSON(`save.${m.id}`, value),
      clear: () => removeJSON(`save.${m.id}`),
    },
    report(result: GameResult) {
      if (result.outcome === 'win') play('win');
      else if (result.outcome === 'loss') play('loss');
      void submitResult(cart, result);
    },
  };

  play('start');
  let unmount: () => void = () => {};
  try {
    unmount = cart.mount(surface, ctx);
  } catch (e) {
    surface.replaceChildren(h('p.empty', {}, `Cartridge crashed: ${(e as Error).message}`));
  }
  return () => {
    try {
      unmount();
    } finally {
      surface.replaceChildren();
    }
  };
}
