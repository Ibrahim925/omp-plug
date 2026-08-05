# Design Decisions

Load-bearing decisions this codebase embodies. Backfilled during harness init
from code comments, `scripts/install.sh`, and git history — all confirmed
against the source, not inferred.

## 2026-08-05: Resolve the omp SDK at runtime, not as a build dependency
- Reason: `@oh-my-pi/pi-coding-agent` is large and already present in the global
  bun install; vendoring its dep tree into this workspace is wasteful.
  `server/src/sdk.ts` prefers normal resolution, then falls back to the global
  install path.
- Rejected alternative: add the SDK as a workspace dependency.
- Constraint: server/extension cannot be typechecked against the SDK at
  author-time. The slice we use is redeclared as local contracts in
  `server/src/types.ts` (`Sdk`, `SessionInstance`, `SessionManagerStatic`) — keep
  them accurate by reading the SDK source when extending them.

## 2026-08-05: Spawn new sessions as `omp --mode rpc-ui`
- Reason: `rpc-ui` is the only non-TTY mode that boots with `hasUI=true`, so the
  installed `omp-report` extension reports the session on startup (no
  `OMP_PLUG_FORCE`) and the native `ask` override activates. stdin is kept open
  as the idle RPC transport so the process waits for dashboard commands.
- Rejected: interactive TTY mode (needs a pty the server can't easily allocate);
  plain `rpc` (`hasUI=false` → extension would not report).
- Constraint: a created session is driven entirely through the extension command
  plane (`pi.sendUserMessage`, etc.), never over the child's stdio.

## 2026-08-05: Hand-mirror the wire contract across three files
- Reason: the extension loads from `~/.omp/agent/extensions/`, the web app builds
  separately, and the server runs standalone — there is no natural shared build
  to hold a common types package.
- Rejected: a shared types package.
- Constraint: every wire shape must be edited in `server/src/types.ts`,
  `extension/index.ts`, and `web/src/types.ts` together, with zod validation in
  `server/src/live.ts`. See `docs/wire-contract.md`.

## 2026-08-05: Clamp oversized register fields instead of rejecting the frame
- Reason: omp skill commands carry very long descriptions; one oversized field
  once invalidated the whole register frame and silently killed controllability.
- Constraint: inbound zod schemas `slice` names/descriptions/command lists rather
  than failing — a partial-but-valid frame always registers.

## 2026-08-05: Only terminate sessions the server itself spawned
- Reason: never kill a user's own running terminal session out from under them.
- Constraint: `DELETE` of a live session not tracked by `spawn.ts` returns `409`
  (reported as "skipped" for project removal); it is refused, never forced.

## 2026-08-05: Single shared secret in ~/.omp-plug.json, unified resolution
- Reason: the launchd service deliberately carries no token in its environment,
  so the config file is the robust path. When the HTTP plane and the agent-WS
  plane resolved the token differently, agent registration ran unauthenticated.
- Constraint: `server/src/auth.ts` and the extension's `readConfig()` must resolve
  the token the same way (env overrides file); keep them in agreement.

## 2026-08-05: Web Push notifications via the `web-push` library
- Reason: getting a notification to a phone while the app is backgrounded needs
  the Web Push API (service worker + VAPID + RFC 8291 payload encryption). The
  `web-push` npm package is the battle-tested sender; hand-rolling the crypto was
  the rejected alternative (approved dependency add, WIP=1).
- Triggers reuse existing live events — no wire-shape change: `idle` (agent
  finished) and a `toolStart` whose name is `ask` (agent needs input). Hooked in
  `live.ts` `maybePush`, fired fire-and-forget through `push.ts` `notify()`.
- Constraint: the browser only accepts a subscription in a **secure context**, so
  push requires serving over HTTPS (Tailscale Serve / `tailscale cert`); over
  plain HTTP the UI disables the toggle. web-push always issues the delivery over
  `https.request`, so real push endpoints must be HTTPS (they always are).
- State (VAPID keypair + subscriptions) persists to `~/.omp-plug-push.json`,
  deliberately separate from the token config; the keypair must stay stable or
  every device has to re-subscribe.
