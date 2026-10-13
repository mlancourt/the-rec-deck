import { h } from './dom';
import { prefs } from './prefs';
import { play } from './sound';

/** First-launch marquee. Any tap or key starts; after that this device goes straight to the shelf. */
export function showAttract(root: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    const screen = h(
      'div.attract.chrome',
      { role: 'button', tabindex: 0, 'aria-label': 'Press start' },
      h('div.marquee', {}, h('h1.wordmark', {}, 'THE REC DECK'), h('p.subline', {}, 'a LannyAI console')),
      h('p.press-start', {}, 'PRESS START'),
      h('p.attract-foot', {}, 'tap anywhere'),
    );
    const start = () => {
      prefs.attractSeen = true;
      play('start');
      removeEventListener('keydown', start);
      screen.remove();
      resolve();
    };
    screen.addEventListener('click', start);
    addEventListener('keydown', start);
    root.replaceChildren(screen);
    screen.focus();
  });
}
