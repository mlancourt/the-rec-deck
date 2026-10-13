// The Cartridge Contract. Cartridges import TYPES from here; they never edit it.

export type CartridgeKind = 'session' | 'daily' | 'endless';
export type CartridgeScoring = 'winloss' | 'score' | 'time' | 'moves';
export type Outcome = 'win' | 'loss' | 'draw' | 'complete' | 'abandon';

export interface CartridgeManifest {
  id: string;
  title: string;
  tagline: string;
  icon: string; // a short glyph rendered in the shelf tile
  kind: CartridgeKind;
  scoring: CartridgeScoring;
  version: string;
}

export interface ThemeTokens {
  bg: string;
  bgRaise: string;
  bgSink: string;
  bgChip: string;
  line: string;
  lineSoft: string;
  text: string;
  textDim: string;
  textFaint: string;
  accent: string;
  good: string;
  warn: string;
  bad: string;
  info: string;
  radius: string;
  fontPixel: string;
  fontBody: string;
}

export interface GameResult {
  game: string;
  date: string; // Central YYYY-MM-DD
  outcome: Outcome;
  score?: number;
  duration_s: number;
  meta?: Record<string, unknown>;
}

export interface CartridgeContext {
  theme: ThemeTokens;
  today: string; // Central YYYY-MM-DD
  seed: number; // stable per (id, today)
  settings: Record<string, unknown>;
  report(result: GameResult): void;
}

export interface Cartridge {
  manifest: CartridgeManifest;
  mount(el: HTMLElement, ctx: CartridgeContext): () => void;
}

// ---- Wire format between shell and Worker ----

/** What the shell POSTs: the GameResult, its idempotency key, and the cartridge facts the Worker needs for scoring. */
export interface ResultEnvelope extends GameResult {
  result_id: string;
  cartridge: { title: string; kind: CartridgeKind; scoring: CartridgeScoring };
}

export interface GameStats {
  id: string;
  title: string;
  plays: number;
  wins: number;
  win_pct: number;
  best: number | null;
  streak: number;
  longest_streak: number;
  last_played: string | null;
  spark: number[]; // 30 entries, oldest first, ending today
}

export interface DailyStats {
  id: string;
  title: string;
  done_today: boolean;
  streak: number;
  longest_streak: number;
}

export interface Scoreboard {
  generated_at: string; // ISO timestamp
  deck_streak: number;
  deck_streak_best: number;
  last_played: string | null;
  today_played: boolean;
  games: GameStats[];
  daily: { games: DailyStats[] } | null;
}
