// Throwaway proof cartridge: proves shelf → cabinet → report → queue → Worker → scoreboard.
// Delete when chess ships.

import type { CartridgeContext, CartridgeManifest } from '../../shell/contract';

export const manifest: CartridgeManifest = {
  id: 'coin-flip',
  title: 'COIN FLIP',
  tagline: 'Call it in the air.',
  icon: '◐',
  kind: 'session',
  scoring: 'winloss',
  version: '0.1.0',
};

export function mount(el: HTMLElement, ctx: CartridgeContext): () => void {
  const t = ctx.theme;
  const root = document.createElement('div');
  root.style.cssText = `display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px;height:100%;min-height:320px;font-family:${t.fontBody};color:${t.text}`;

  const coin = document.createElement('div');
  coin.style.cssText = `width:120px;height:120px;border-radius:50%;border:4px solid ${t.accent};display:flex;align-items:center;justify-content:center;font-family:${t.fontPixel};font-size:28px;color:${t.accent};transition:transform 600ms ease-in-out`;
  coin.textContent = '?';

  const msg = document.createElement('div');
  msg.style.cssText = `font-family:${t.fontPixel};font-size:14px;letter-spacing:1px;color:${t.textDim};min-height:1.5em`;
  msg.textContent = 'HEADS OR TAILS?';

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:12px';
  const button = (label: string) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = `font:inherit;font-size:16px;padding:14px 22px;border-radius:${t.radius};border:1px solid ${t.line};background:${t.bgChip};color:${t.text};cursor:pointer`;
    return b;
  };
  const heads = button('Heads');
  const tails = button('Tails');
  row.append(heads, tails);
  root.append(coin, msg, row);
  el.append(root);

  let started = performance.now();
  let flips = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const call = (guess: 'H' | 'T') => {
    heads.disabled = tails.disabled = true;
    msg.textContent = '…';
    flips += 1;
    coin.style.transform = `rotateY(${flips * 1080}deg)`;
    timer = setTimeout(() => {
      const side = Math.random() < 0.5 ? 'H' : 'T';
      const won = side === guess;
      coin.textContent = side;
      msg.textContent = won ? 'YOU WIN' : 'YOU LOSE';
      msg.style.color = won ? t.good : t.bad;
      ctx.report({
        game: manifest.id,
        date: ctx.today,
        outcome: won ? 'win' : 'loss',
        duration_s: Math.max(1, Math.round((performance.now() - started) / 1000)),
        meta: { guess, side },
      });
      heads.disabled = tails.disabled = false;
      started = performance.now();
    }, 600);
  };
  heads.onclick = () => call('H');
  tails.onclick = () => call('T');

  return () => {
    clearTimeout(timer);
    root.remove();
  };
}
