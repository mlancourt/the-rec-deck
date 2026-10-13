// Hand-written minimal Workers types: only what this Worker uses.

export interface KVNamespace {
  get<T = unknown>(key: string, type: 'json'): Promise<T | null>;
  put(key: string, value: string): Promise<void>;
}

export interface Env {
  RESULTS: KVNamespace;
  API_TOKEN: string; // `wrangler secret put API_TOKEN` — never in code or wrangler.toml
}
