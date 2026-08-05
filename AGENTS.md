# AGENTS.md

> Entry point for AI agents working in this repo. Read this first, then load the
> topic doc relevant to your task. Keep this file lean — deep detail lives in docs/.

## Overview
**omp-plug** is a self-hosted, mobile-first web dashboard to watch, control,
create, and manage live `omp` coding-agent sessions from a browser (typically
over Tailscale). Success = from a phone you can see every session, drive a live
one (prompt/steer/answer/abort), and create/rename/delete sessions and projects.

## Stack
- **Runtime:** Bun 1.3.14 (workspaces: `server`, `web`; lockfile `bun.lock`).
- **Server** (`server/`): `Bun.serve` HTTP + WebSocket, port 7317. Dep: `zod`.
- **Web** (`web/`): React 18 + Vite 6 + strict TypeScript; `react-markdown`.
- **Extension** (`extension/`): `omp-report`, an omp extension (TS).
- **SDK:** `@oh-my-pi/pi-coding-agent` resolved at **runtime**, not built in.

## Quick start
- Setup:  `make setup`
- Dev:    `make dev`   (server; `make dev-web` for the Vite UI with HMR)
- Test:   `make test`
- Verify: `make check`   # web typecheck + tests; the aggregate gate

## Project structure
- `server/src/` — dashboard server. `index.ts` (routes/WS), `live.ts` (live
  registry), `history.ts` (persisted sessions), `spawn.ts` (create sessions),
  `sdk.ts` (runtime SDK), `auth.ts`, `push.ts` (Web Push / VAPID),
  `types.ts` (canonical wire types).
- `web/src/` — React client. `views/` (SessionList, SessionView, Message),
  `api.ts`, `types.ts`, `router.ts`, `push.ts` (subscribe client);
  `web/public/sw.js` (push service worker).
- `extension/index.ts` — the `omp-report` extension (agent side of the wire).
- `scripts/` — `install.sh`, `uninstall.sh`, launchd plist template.
- `docs/` — topic docs (below). `web/dist/` — build output (gitignored).

## Session workflow
**Clock in (session start):**
1. Read `PROGRESS.md` (current verified state, blockers, next steps).
2. Read `DECISIONS.md` (why things are the way they are).
3. Run `make check` to confirm the repo starts consistent.
4. Continue from `PROGRESS.md` "Next priority" / the one `in_progress` feature.

**Clock out (before ending any session that changed code):**
1. Update `PROGRESS.md` (goal, outcome, verification actually run, follow-ups).
2. Update `feature_list.json` states — only to `passing` when verification ran.
3. Run `make check`; leave a clean state (no debug code, no stray artifacts).
4. Commit completed work (atomic; one logical change per commit).

## Definition of Done
A change is done only when verification has actually run — "code is written" is
not done. In order, do not advance a level until the prior one passes:
1. Web typecheck passes (`make lint`).
2. Tests pass (`make test`).
3. End-to-end check when the change crosses the extension↔server↔browser
   boundary: exercise the real path (curl an endpoint, or drive it in a browser).
Report honestly what ran, passed, and was skipped. A skipped test is not passing.

## Work rules
- WIP = 1: exactly one feature `in_progress` at a time. Finish and verify it
  before starting another.
- A feature becomes `passing` only when its verification command actually
  passed. Do not self-declare done; run the verification and let it decide.

## Boundaries
- **Always:** run `make check` before committing; follow `docs/` conventions;
  change every side of a wire shape together (see `docs/wire-contract.md`).
- **Ask first:** adding dependencies; changing the WS/HTTP protocol; changing
  `scripts/` deploy or the launchd/config layout; new stack choices.
- **Never:** commit secrets or `~/.omp-plug.json` tokens; edit the vendored omp
  SDK; kill or delete a live session the server did not spawn; delete failing
  tests to go green.

## Topic docs (load on demand — don't guess)
- `docs/architecture.md` — read when touching routing, the live/spawn/history
  planes, the WS bridges, or SDK loading.
- `docs/wire-contract.md` — read when changing any message/command/event/session
  shape crossing extension↔server↔browser (must update all three + zod).
- `docs/code-style.md` — read before writing or reviewing code here.
- `docs/deploy.md` — read when changing install, run, config, or ports.
