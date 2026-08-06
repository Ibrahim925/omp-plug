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
- **Last shipped:** `voice-input` (composer dictation via the Web Speech API) —
  passing, verified in-browser 2026-08-06.
- **Next priority:** finish the device-side verification of `push-notifications`
  (serve over HTTPS, enable the bell on a phone), or pick the first remaining
  `not_started` row in `feature_list.json` (suggest `ws-dev-proxy`).
- **Blockers:** none. (Note: `make check` does not typecheck server/extension —
  they are Bun-runtime TS with no author-time SDK types; see DECISIONS.md.)

## Session Records

### 2026-08-06 (fix) — Composer typing latency (transcript re-parse on keystroke)
- Outcome: done + measured.
- Problem: typing in the composer was sluggish. `input` lives in `SessionView`,
  so every keystroke re-rendered the whole view, including `<Transcript>` —
  which is un-memoized and re-parses every message through react-markdown +
  rehype-highlight on each render. On a long conversation that is tens of ms of
  synchronous work per character.
- Did: `memo()` around `Transcript` (Message.tsx) and wrapped `onAnswer`/
  `onDismiss` in `SessionView` with `useCallback([id])` so the memo's shallow
  prop compare holds (messages ref + controllable were already stable). Keystrokes
  now change only local composer state; the transcript subtree bails out of
  rendering entirely.
- Verification run: `make check` green (tsc web clean, bun test 1/1). Measured in
  headless Chrome with a React `Profiler` around the REAL `Transcript` (40
  markdown-heavy messages) beside a live textarea: mount commit = 89 ms of render
  work; each of 20 keystrokes = ≤0.1 ms (avg 0.025 ms) — the transcript no longer
  re-parses on keystroke (before, every keystroke paid the full ~89 ms render).
- Risks / follow-ups: a data refetch still rebuilds message objects (new refs),
  so the transcript re-parses then — expected and infrequent (throttled). A
  future win is memoizing `Markdown`/`Message` by text so unchanged messages skip
  re-parse across refetches, but it's not needed for the typing path.

### 2026-08-06 (feature) — Voice input (dictation) in the composer
- Outcome: done + verified end to end.
- Did: added browser-native voice dictation to the session composer. New
  `web/src/speech.ts` `useDictation(onFinal)` hook wraps the Web Speech API
  (`SpeechRecognition`/`webkitSpeechRecognition`): feature-detects + requires a
  secure context, streams interim + final results, restarts the recognizer on
  silence auto-end for continuous hands-free dictation, and surfaces real errors
  (mic permission denied) while ignoring benign `no-speech`/`aborted`. Wired a
  mic toggle into `SessionView`'s composer (new `MicIcon`) that appends each
  finalized chunk to the message box with correct spacing, shows a
  "Listening…"/interim note, stops on submit, and tears down on unmount. CSS for
  `.composer-btn.mic`(+`.on` pulse) and `.dictation-note`. Client-only — no new
  dependency, no server/wire change. Docs: README feature, feature_list
  `voice-input` row.
- Verification run: `make lint` (tsc web clean) + `make test` (bun 1/1) green.
  E2E in headless Chrome against the REAL `useDictation` hook with a fake
  `SpeechRecognition`: support+secure detection true → mic renders; toggle →
  listening + `.on`; interim preview updates; final chunk appends with spacing
  ("hello" → "hello one two three"); silence auto-end restarts the recognizer;
  a post-restart final still appends ("four"); stop clears listening; error path
  shows "Microphone permission denied" on `not-allowed` and ignores `no-speech`.
  Did NOT run: a real device mic over Tailscale HTTPS (needs a phone + secure
  origin), but the browser API path is proven with a faithful fake.
- Risks / follow-ups: recognition quality/availability is the browser's (Chrome
  uses Google's service; iOS Safari supports `webkitSpeechRecognition` from
  ~14.5 but ignores `continuous` — the restart-on-end loop covers that). Over
  plain HTTP the mic is hidden (no secure context), same constraint as push.

### 2026-08-05 (chore) — Open-source readiness
- Outcome: done. Repo prepped for public use/fork/contribution and pushed.
- Did: added `LICENSE` (MIT, © Ibrahim Khawar), root `README.md` (pitch,
  the extension mechanism, features, requirements, quick start, config, push
  caveats, dev loop, security note), `CONTRIBUTING.md` (dev loop + the
  wire-contract-in-lockstep rule + ask-first list), `.github/workflows/ci.yml`
  (Bun 1.3.14 → `bun install --frozen-lockfile` → `make check`),
  `.github/PULL_REQUEST_TEMPLATE.md`, and bug/feature issue templates. Enriched
  root `package.json` (description, license, author, repository, homepage, bugs,
  keywords, engines). Scrubbed a personal Tailscale hostname from
  `scripts/install.sh` → `<dashboard-host>`. Committed a pending, complete
  `sw.js` change (silence push while the dashboard is focused) as its own
  atomic feat commit first. No secrets were ever tracked (token →
  `~/.omp-plug.json`, VAPID → `~/.omp-plug-push.json`).
- Verification run: `make check` green (tsc web clean; `bun test` 1/1). Server
  boots without the global SDK (all `getSdk()` calls are lazy), so CI's health
  smoke test needs nothing global installed. Did NOT run the GitHub Actions
  workflow itself — it runs on push.
- Risks / follow-ups: the macOS `install.sh` path (launchd) is unverified on
  Linux; README documents the manual `make build && make start` route for it.

### 2026-08-05 (feature) — `!` / `!!` shell escapes from the dashboard composer
- Outcome: done + verified end to end.
- Did: the composer now runs omp-style shell escapes. `!cmd` runs a shell
  command on the host (session cwd) and streams the result to the dashboard;
  `!!cmd` is a private peek. Mechanism: `sendUserMessage` bypasses omp's TUI
  input layer where `!`/`/` are parsed (confirmed by reading the SDK:
  input-controller.ts), and the SDK exposes no public slash/bash executor — only
  `pi.exec`. So the extension (`applyCommand`) intercepts a leading `!`, runs
  `pi.exec("/bin/sh",["-c",cmd],{cwd})`, and emits a new `bash` LiveEvent
  `{command,output,code,excluded}`. For `!` (not excluded) it also
  `pi.sendMessage({content,display:false},{deliverAs:"nextTurn"})` so the agent
  gets the output next turn without triggering one; `!!` skips that. Wire change
  applied in all four spots (extension LiveEvent, server types.ts + live.ts zod,
  web types.ts) per wire-contract; web renders `.bash-run` blocks and the
  composer no longer flips to "working" for `!` lines. Docs: wire-contract bash
  event, feature_list `dashboard-shell-escape`.
- Verification run: `make check` green (tsc web clean, bun test 1/1); impeccable
  detector clean. E2E on :7317 in a FRESH session (symlinked extension → new
  code loads): `!echo hello from bash && date +%Y` → un-tagged bash block
  "hello from bash / 2026"; `!!pwd` → PRIVATE dashed block "/private/tmp/
  omp-plug-e2e"; no stuck working indicator; a follow-up model turn quoted the
  `!` output from context and omitted the `!!` output — proving the context feed
  and exclusion. Test session deleted; 0 rpc-ui procs left.
- Risks / follow-ups: bash output is live-only (a `bash` event), not persisted
  in the session file, so it disappears on reload — acceptable for a shell
  peek, but note it. Slash (`/`) and python (`$`) escapes remain unsupported
  (no public SDK executor). Existing already-running sessions won't have the
  feature until they restart (they loaded the old extension).

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
