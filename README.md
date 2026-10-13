# THE REC DECK

*a LannyAI console.* A personal game console: one arcade-style shell (an installable, offline PWA) that hosts pluggable game cartridges, plus a small Cloudflare Worker that keeps results and streaks. Live at `games.lannyai.com`.

## Run it

```bash
npm install
npm run dev:mock      # full UI with invented scoreboard data, no Worker needed
npm test              # contract, queue, Worker + streak tests (100% coverage on streaks)
npm run build         # static PWA in dist/
```

Against a local Worker: copy `worker/.dev.vars.example` to `worker/.dev.vars`, run `npm run dev:worker`, optionally `npm run seed:mock`, then open the app and paste the dev token in Settings.

## Add a cartridge

Create `src/cartridges/<id>/index.ts` exporting `manifest` and `mount(el, ctx)`, call `ctx.report()` once per finished game, and add one line to `src/cartridges/_registry.ts`. Never edit `src/shell/` in a cartridge PR. Full rules are in [CLAUDE.md](CLAUDE.md#how-to-add-a-cartridge).

## No real data

This repo is public. It holds **no real data, ever**: no results, no tokens, no personal info. Mock data is invented (`tools/fake-scoreboard.ts`), and the API token lives only in a Worker secret and your device's local storage.
