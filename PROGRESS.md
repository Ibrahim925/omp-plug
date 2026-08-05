# Progress Log

Session state for AI agents. Read at session start; update before ending any
session that changed code. Keep "Current Verified State" truthful — only record
what a verification command actually confirmed.

## Startup Readiness Checklist
- Setup: `make setup` | Dev: `make dev` (server) / `make dev-web` (Vite HMR) |
  Test: `make test` | Verify: `make check`
- Environment: deps installed + locked (`bun.lock`, Bun 1.3.14); test framework
  = Bun's built-in runner, one smoke test passing; web strict-typechecks clean.
- Runtime note: the `@oh-my-pi/pi-coding-agent` SDK is resolved at runtime from
  the global bun install — it is NOT a workspace dependency (see DECISIONS.md).
- Structure: see `AGENTS.md`; deep topics in `docs/`.

## Current Verified State
- **Branch/commit:** `main`, at the agent-harness initialization checkpoint
  (follows `a5772dc feat: add and remove sessions per project`).
- **Verification status:** `make check` green — `tsc --noEmit` (web) clean;
  `bun test` 1/1 passing (server boots, `/api/health` → `{ok:true}`).
- **App behavior confirmed this session (manual, against a test server on :7399):**
  create/spawn a live session, live + non-live rename, delete (spawned kill +
  file unlink), the 409 guard for externally-live sessions, and per-project
  add/remove — all verified end to end (HTTP + headless browser).
- **Start:** `make dev` then open `http://<host>:7317` (token from
  `~/.omp-plug.json`); or `make dev-web` for the Vite UI with HMR.
- **Next priority:** finish the device-side verification of `push-notifications`
  (serve over HTTPS, enable the bell on a phone), or pick the first remaining
  `not_started` row in `feature_list.json` (suggest `ws-dev-proxy`).
- **Blockers:** none. (Note: `make check` does not typecheck server/extension —
  they are Bun-runtime TS with no author-time SDK types; see DECISIONS.md.)

## Session Records

### 2026-08-05 (feature) — Resume inactive sessions (no read-only dead-ends)
- Outcome: done + verified end to end.
- Did: an inactive session (not controllable, not recently written) can be
  resumed headlessly so it becomes queryable again. `spawn.ts` refactored to a
  shared `launch()` + new `resumeSession({id,cwd})` (`omp --mode rpc-ui
  --resume <id>`); `history.ts` `resumeInfo(id)` resolves id→{cwd,live};
  `POST /api/sessions/:id/resume` (no-op if controllable, 409 if live elsewhere,
  404 if unknown). Web: `api.resumeSession`; `SessionView` auto-resumes on open
  when inactive (once-per-id guard + Resume/Retry affordance) and shows a
  transient "Resuming…" note instead of the old blank dead-end; `.resume-btn`
  CSS. Docs: architecture Resume flow, `session-resume` feature row.
- Verification run: `make check` green (tsc web clean, bun test 1/1). E2E on
  :7399: a real inactive on-disk session (live:false/controllable:false,
  modified 2026-07-24) resumed to controllable:true with 126 messages loaded
  (spawned child killed for cleanup, file left intact); resume on a controllable
  session returned {ok,controllable:true}; unknown id → 404. Did NOT drive the
  browser auto-resume UI this pass (server contract + client wiring verified;
  the effect is a one-shot resumeSession→refetch on inactive load).
- Risks / follow-ups: live-but-not-controllable sessions stay read-only by
  design (recent write ⇒ another process may own the file; resuming would
  double-own it, mirroring the delete 409). Resumed children persist until
  delete/stop or server restart.

### 2026-08-05 (feature) — Auto-open new session on create
- Outcome: done + verified end to end.
- Did: `POST /api/sessions` now returns `{ok,pid,sessionId?}`. `spawnSession`
  races the child's `/ws/agent` register against exit/crash-window
  (`onRegister` resolver on the tracked `Child`, resolved by `noteRegistered`
  in `live.ts`), so the create response carries the sessionId when the child
  registers within the wait. Web `createSession` returns the id; `SessionList`
  create + project-add navigate to `/s/<id>` when present (burst-refresh
  fallback otherwise). Docs: architecture Create flow, `session-create` row.
- Verification run: `make check` green (tsc web clean, bun test 1/1). E2E on
  :7399: POST returned a non-empty sessionId in 0.66s; `GET /api/sessions/<id>`
  served a live+controllable shell (msgs:0) — the exact page the client opens;
  spawned child deleted for cleanup. Did NOT drive the browser navigation in a
  real headless session this pass (server contract + client wiring verified;
  navigation is a one-line `navigate()` on the returned id).

### 2026-08-05 (feature) — Web Push notifications
- Outcome: server path done + verified; device round-trip pending HTTPS.
- Did: added `web-push` dep; `server/src/push.ts` (VAPID keygen persisted to
  `~/.omp-plug-push.json`, subscription store, fail-soft `notify()` fan-out with
  404/410 pruning); `live.ts` `maybePush` triggers on `idle` and `ask` toolStart
  (no wire-shape change); `/api/push/{key,subscribe,unsubscribe,test}` routes;
  web `public/sw.js` service worker + `web/src/push.ts` subscribe client + api
  functions; bell toggle in `SessionList` (states: on/off/denied/insecure/
  unsupported) + CSS. Docs: deploy.md push section, DECISIONS entry, AGENTS
  structure, feature_list `push-notifications` row.
- Verification run: `make check` green (tsc web clean; `bun test` 1/1). Server
  send path proven end-to-end against an isolated HOME + self-signed TLS capture
  endpoint: POST received with `Content-Encoding: aes128gcm`, `Authorization:
  vapid`, `TTL: 600`, 180B encrypted body; VAPID key persisted; subscribe/test
  routes ok. Did NOT run: real browser/phone subscribe->receipt (needs an HTTPS
  secure context; web-push always delivers over https.request).
- Risks / follow-ups: the VAPID keypair in `~/.omp-plug-push.json` must stay
  stable (regenerating invalidates every device). iOS needs Add-to-Home-Screen.

### 2026-08-05 (harness-init) — Initialize agent harness
- Outcome: done.
- Did: brownfield harness init. Added `AGENTS.md` (+`CLAUDE.md` symlink),
  `docs/{architecture,wire-contract,code-style,deploy}.md`, `Makefile`
  (setup/dev/dev-web/build/start/test/lint/check), `server/test/smoke.test.ts`,
  `PROGRESS.md`, `DECISIONS.md`, `feature_list.json`; expanded `.gitignore`.
  Committed the pre-existing verified per-project add/remove UI as its own
  `feat` commit first, then the harness as a separate `chore` commit.
- Verification run: `make setup` (no changes) and `make check` → exit 0
  (tsc web clean; `bun test` 1 pass / 0 fail). Did NOT run: any server/extension
  standalone typecheck (none configured), any live end-to-end this session
  beyond the health smoke test.
- Risks / follow-ups: `feature_list.json` marks shipped capabilities `passing`
  with the manual evidence from earlier this session — future changes to those
  paths should re-verify. Implementation continues in a fresh session, WIP=1.
