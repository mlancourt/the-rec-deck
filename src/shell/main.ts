import './styles.css';
import { showAttract } from './attract';
import { renderCabinet } from './cabinet';
import { isMock, onPending, startSync } from './deck';
import { h } from './dom';
import { applyEffects } from './effects';
import { prefs } from './prefs';
import { renderScoreboard } from './scoreboard';
import { renderSettings } from './settings';
import { renderShelf } from './shelf';

const app = document.getElementById('app')!;
applyEffects();

const main = h('main.view');
const queued = h('span.tag.warn', { hidden: true });
const chrome = h(
  'div.frame',
  {},
  h(
    'header.topbar.chrome',
    {},
    h('a.brand', { href: '#/' }, 'THE REC DECK'),
    isMock ? h('span.tag.info', {}, 'MOCK') : null,
    queued,
    h('nav', {}, h('a', { href: '#/scores' }, 'SCORES'), h('a', { href: '#/settings' }, 'SETTINGS')),
  ),
  main,
);

onPending((n) => {
  queued.hidden = n === 0;
  queued.textContent = `${n} QUEUED`;
});

let cleanup: () => void = () => {};

function route(): void {
  cleanup();
  const hash = location.hash.replace(/^#\/?/, '');
  const [section, arg] = hash.split('/');
  document.body.dataset.view = section || 'shelf';
  for (const a of chrome.querySelectorAll('nav a')) a.toggleAttribute('aria-current', a.getAttribute('href') === `#/${section}`);
  if (section === 'play' && arg) cleanup = renderCabinet(main, decodeURIComponent(arg));
  else if (section === 'scores') cleanup = renderScoreboard(main);
  else if (section === 'settings') cleanup = renderSettings(main);
  else cleanup = renderShelf(main);
  scrollTo(0, 0);
}

async function boot(): Promise<void> {
  startSync();
  if (!prefs.attractSeen && !location.hash.startsWith('#/play')) await showAttract(app);
  app.replaceChildren(chrome);
  addEventListener('hashchange', route);
  route();
}

void boot();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  addEventListener('load', () => void navigator.serviceWorker.register('/sw.js'));
}
