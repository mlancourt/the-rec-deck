// "You sure?" — a static look at a move before it is played. No engine: it only catches the
// two things a beginner most needs caught: a piece left to be taken, and walking into mate in one.

import { Chess, type Color, type PieceSymbol, type Square } from 'chess.js';

export const WORTH: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
export const NAME: Record<PieceSymbol, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

export interface MoveInput {
  from: string;
  to: string;
  promotion?: string;
}

export interface Warning {
  kind: 'hang' | 'mate';
  piece?: PieceSymbol;
  square?: Square;
  text: string;
}

/** What the move leaves on the table, or null if it looks safe. Illegal input returns null. */
export function tripwire(fen: string, move: MoveInput): Warning | null {
  const g = new Chess(fen);
  const me: Color = g.turn();
  let gained = 0;
  try {
    const m = g.move(move);
    gained = m.captured ? WORTH[m.captured] : 0;
  } catch {
    return null;
  }
  if (g.isGameOver()) return null;

  let worst = 0;
  let piece: PieceSymbol | undefined;
  let square: Square | undefined;
  let free = false;
  for (const r of g.moves({ verbose: true })) {
    g.move({ from: r.from, to: r.to, promotion: r.promotion });
    const mated = g.isCheckmate();
    g.undo();
    if (mated) return { kind: 'mate', text: `That walks into checkmate (${r.san}).` };
    if (!r.captured || r.isEnPassant()) continue;
    const defended = g.isAttacked(r.to, me);
    const loss = defended ? WORTH[r.captured] - WORTH[r.piece] : WORTH[r.captured];
    if (loss > worst) {
      worst = loss;
      piece = r.captured;
      square = r.to;
      free = !defended;
    }
  }
  if (!piece || !square || worst < 2 || worst <= gained) return null;
  const what = `Your ${NAME[piece]} on ${square}`;
  return {
    kind: 'hang',
    piece,
    square,
    text: free ? `${what} can be taken for free.` : `${what} can be taken, and you lose material on the trade.`,
  };
}
