// CHESS — climb a ladder of five opponents. Board, pieces and motion are ours; rules are chess.js;
// the opponent and the post-game tape are Stockfish.

import type { CartridgeContext, CartridgeManifest } from '../../shell/contract';
import { start } from './game';

export const manifest: CartridgeManifest = {
  id: 'chess',
  title: 'CHESS',
  tagline: 'Five opponents. Climb the ladder.',
  icon: '♞',
  kind: 'session',
  scoring: 'winloss',
  version: '1.0.0',
};

export function mount(el: HTMLElement, ctx: CartridgeContext): () => void {
  return start(el, ctx, manifest.id);
}
