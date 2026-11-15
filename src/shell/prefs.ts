// Per-device preferences in localStorage. Everything is prefixed so "clear local data" can find it.

const PREFIX = 'recdeck.';

function get(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

function set(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, value);
  } catch {
    /* storage unavailable: preference just won't persist */
  }
}

export interface Prefs {
  sound: boolean;
  reducedEffects: boolean;
  attractSeen: boolean;
  token: string;
  apiBase: string;
}

const DEFAULT_API_BASE: string = import.meta.env.VITE_API_BASE ?? '';

export const prefs = {
  get sound() { return get('sound') === '1'; },
  set sound(v: boolean) { set('sound', v ? '1' : null); },
  get reducedEffects() { return get('reducedEffects') === '1'; },
  set reducedEffects(v: boolean) { set('reducedEffects', v ? '1' : null); },
  get attractSeen() { return get('attractSeen') === '1'; },
  set attractSeen(v: boolean) { set('attractSeen', v ? '1' : null); },
  get token() { return get('token') ?? ''; },
  set token(v: string) { set('token', v.trim() || null); },
  get apiBase() { return (get('apiBase') ?? DEFAULT_API_BASE).replace(/\/+$/, ''); },
  set apiBase(v: string) { set('apiBase', v.trim() || null); },
};

export function readJSON<T>(key: string): T | null {
  const raw = get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeJSON(key: string, value: unknown): void {
  set(key, JSON.stringify(value));
}

export function removeJSON(key: string): void {
  set(key, null);
}

export function clearAllPrefs(): void {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX)) localStorage.removeItem(k);
  } catch {
    /* nothing to clear */
  }
}
