# Architecture

> Read this when touching request routing, the live/spawn/history planes, the
> WebSocket bridges, or how the omp SDK is loaded.

omp-plug is a dashboard for live `omp` coding-agent sessions. One Bun process
(`server/`) serves the built web UI and bridges two WebSocket populations; the
browser (`web/`) is a thin client; the `omp-report` extension (`extension/`)
runs *inside every omp session* and is the only thing that can observe or drive
a session.

```
 omp session (extension)  ──ws──▶  server  ──ws──▶  browser (web/)
        ▲  /ws/agent                 │  /ws/client
        └────────  control commands ─┘   (prompt/steer/answer/rename/abort)
```

## The three planes (server/src)

- **History plane — `history.ts`** (read-only, durable). Lists and renders
  persisted sessions straight from `~/.omp/agent/sessions` via the SDK's own
  loader/transcript builder, plus `deleteSession` / `renameSession`. Source of
  truth for anything not currently running.
- **Live plane — `live.ts`** (in-memory, ephemeral). A registry of connected
  agents keyed by `sessionId`. Forwards normalized `LiveEvent`s to subscribed
  browsers and routes `Command`s back to the owning agent socket. Nothing here
  survives a restart.
- **Spawn plane — `spawn.ts`** (process lifecycle). Launches new sessions as
  `omp --mode rpc-ui` children (the one non-TTY mode with `hasUI=true`, so the
  extension reports on boot). Tracks children by pid so a later delete can
  terminate exactly the sessions this server started — never a user's own.

`index.ts` wires them into `Bun.serve`: HTTP routing + static SPA fallback, the
two WS upgrade paths, and token gating (`auth.ts`).

## SDK resolution — `sdk.ts`

`@oh-my-pi/pi-coding-agent` is **not** a build-time dependency. It is resolved
at runtime, preferring normal module resolution then falling back to the global
bun install. We assert against locally-defined type contracts in `types.ts`, not
the SDK's own types. Consequence: server/extension cannot be typechecked against
the SDK at author-time; keep the local contracts (`Sdk`, `SessionInstance`,
`SessionManagerStatic`) accurate by reading the SDK source when you extend them.

## Key flows

- **Create:** `POST /api/sessions {cwd,title?}` → `spawnSession` launches the
  child and waits (bounded by the crash window) for its extension to register on
  `/ws/agent`; that register correlates the pid to the sessionId
  (`noteRegistered`) and applies the pending title (`takePendingTitle`). The
  response returns `{ok,pid,sessionId?}` — the client navigates straight to
  `/s/<sessionId>` to auto-open the new session, falling back to a list
  burst-refresh when registration outran the wait.
- **Control:** `POST /api/sessions/:id/command` or a live `PATCH`/rename →
  `dispatchCommand` → extension `applyCommand` calls `pi.sendUserMessage` /
  `pi.setSessionName` / `ctx.abort`.
- **Resume:** `POST /api/sessions/:id/resume` → no-op if already controllable;
  `409` if the session is live (recently written — likely owned by another
  process, so a headless resume would double-own the file); otherwise
  `resumeSession` launches `omp --mode rpc-ui --resume <id>` in the session's
  cwd so an inactive session re-registers and becomes controllable. The web
  `SessionView` calls this automatically when it opens an inactive session, so a
  session is never a read-only dead-end.
- **Delete:** spawned-by-us → SIGTERM + await exit, *then* unlink (avoids a
  final atomic rewrite resurrecting the file); external-live → `409` (never
  killed); otherwise → file unlink.
- **`ask`:** the extension overrides the builtin `ask` tool and races the
  terminal dialog against a dashboard-provided answer — this is what makes
  answering from the app a genuine native tool result.
