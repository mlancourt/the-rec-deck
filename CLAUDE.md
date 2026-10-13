# THE REC DECK — repo rules

A personal game console: a static PWA "shell" hosting pluggable game "cartridges", plus the `rec-deck-api` Cloudflare Worker that stores results and computes streaks. Single user. **Public repo.**

## The no-real-data rule
- ZERO real data in this repo, ever: no real results, scores, dates of play, tokens, KV ids you'd mind leaking, or personal info.
- Mock/dev data is invented only: `tools/fake-scoreboard.ts` (mock mode) and `tools/seed-mock.ts` (local `wrangler dev` only; refuses non-localhost URLs).
- The API token lives in a Worker secret (`wrangler secret put API_TOKEN`) and in the user's localStorage. Never in code, config, tests, or docs. Local dev uses `worker/.dev.vars` (gitignored).

## Stack (non-negotiable)
- Vite + vanilla TypeScript. NO UI framework (no React/Vue/Svelte/Tailwind/shadcn). Plain DOM, CSS custom properties.
- Dependencies: vite, typescript, vitest, wrangler, @vitest/coverage-v8. **Ask before adding any other dependency.**
- Static `dist/` deployed to GitHub Pages by `.github/workflows/pages.yml` on push to `main`. Custom domain `games.lannyai.com` (`public/CNAME`), `base: '/'`.
- PWA: `public/manifest.webmanifest` + a service worker generated at build time from `src/shell/sw-template.js` (precache app shell, network-first `/api/*`, cache-first assets). Must install on iOS and play fully offline.
- No CDNs, no external fonts, no analytics, no trackers. Self-contained assets only. The ONLY network calls the page makes are to the Worker, and only from `src/shell/api.ts`.

## Dates
- Central time, `YYYY-MM-DD` strings from `Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' })` (`src/shell/dates.ts`, `worker/src/streaks.ts`).
- NEVER `new Date("YYYY-MM-DD")`. Date arithmetic goes through `addDays`. Render date strings verbatim.

## The Cartridge Contract (`src/shell/contract.ts`)
- A cartridge is `src/cartridges/<id>/index.ts` exporting exactly `manifest: CartridgeManifest` and `mount(el, ctx): () => void` (returns unmount).
- A cartridge NEVER touches fetch, storage, the URL, or the DOM outside `el`. It calls `ctx.report()` once per finished game. The shell does everything else.
- Registered by ONE line in `src/cartridges/_registry.ts`. `src/cartridges/contract.test.ts` checks every entry's shape and scans sources for forbidden APIs.
- **A cartridge PR never edits `src/shell/`.** If a cartridge needs something from the shell, that's a separate shell PR first.

## How to add a cartridge
1. `mkdir src/cartridges/<id>` (kebab-case; folder name = `manifest.id`).
2. Write `index.ts` exporting `manifest` (`id, title, tagline, icon, kind, scoring, version`) and `mount(el, ctx)`.
3. Render only inside `el`; style with `ctx.theme` tokens; seed daily puzzles from `ctx.seed`.
4. Call `ctx.report({ game: manifest.id, date: ctx.today, outcome, score?, duration_s, meta? })` once per finished game.
5. Return an unmount function that clears timers and listeners.
6. Add one line to `_registry.ts`: `export * as myGame from './my-game';`
7. `npm test` (contract test must pass). Don't touch `src/shell/`.

## Skin
- Colours ONLY from the tokens in `:root` (`src/shell/styles.css`); no colour literal elsewhere except `rgba(0,0,0,…)` shadows. Tints are `color-mix(in srgb, var(--tone) N%, var(--bg-raise))`.
- Near-black matte cabinet, warm off-white text, ONE orange (`--accent`, the marquee light). No neon rainbow, no glow on anything but the accent, no gradients.
- ONE pixel font (Press Start 2P, OFL, `public/fonts/`, see `THIRD_PARTY.md`) for the marquee, cartridge titles, and scoreboard digits only. Body text is the system stack.
- Scanlines ≤4% opacity on shell chrome only, never over a game surface, off under `prefers-reduced-motion` and the reduced-effects setting. The game surface is always clean.
- One ≤300ms cabinet slot-in animation; none under reduced motion. Icons come from `npm run icons` (`tools/gen-icons.ts`).

## The Worker (`worker/`)
- Routes (all need `Authorization: Bearer <token>`, 401 otherwise; CORS for `https://games.lannyai.com` + localhost): `POST /api/result` (idempotent on `result_id`, 201 + scoreboard), `GET /api/stats`, `GET /api/health`.
- KV: `results:<YYYY-MM>` arrays, `months` index, `scoreboard` cache.
- Streak math lives ONLY in `worker/src/streaks.ts`: pure functions, 100% covered (enforced by `npm test`).
- The POST body is the `GameResult` + `result_id` + `cartridge: { title, kind, scoring }` (the Worker needs kind/scoring for dailies and "best").

## Commands
`npm run dev` · `npm run dev:mock` · `npm test` · `npm run build` · `npm run typecheck` · `npm run icons` · `npm run dev:worker` · `npm run seed:mock` · `npm run deploy:worker`
