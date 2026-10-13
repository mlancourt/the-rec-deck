import { prefs } from './prefs';

/** Reflect the reduced-effects preference on <html> so CSS can turn chrome effects off. */
export function applyEffects(): void {
  document.documentElement.toggleAttribute('data-reduced-effects', prefs.reducedEffects);
}
