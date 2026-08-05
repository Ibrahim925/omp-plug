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
- **Next priority:** implementation is a separate phase — pick the first
  `not_started` row in `feature_list.json` (suggest `ws-dev-proxy`).
- **Blockers:** none. (Note: `make check` does not typecheck server/extension —
  they are Bun-runtime TS with no author-time SDK types; see DECISIONS.md.)

## Session Records

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
