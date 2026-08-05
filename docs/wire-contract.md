# Wire Contract

> Read this (and obey it) whenever you change any message, command, event, or
> session shape that crosses the extension ↔ server ↔ browser boundary.

The three processes exchange JSON over WebSockets and HTTP. Their type
definitions are **hand-mirrored, not shared** — there is no common package. A
shape that changes in one place and not the others fails silently (a dropped
frame, an ignored command, an invisible session), so:

## The rule

**Any change to a wire shape MUST be applied in all three files in the same
change:**

| File | Role |
|---|---|
| `server/src/types.ts` | canonical definitions + the server's own view |
| `extension/index.ts` | the agent side (interfaces near the top: `LiveEvent`, `LiveSessionMeta`, `SlashCommand`; commands read structurally in `applyCommand`) |
| `web/src/types.ts` | the browser side |

And validation lives in `server/src/live.ts` as zod schemas — update it too, or
the new field is stripped before anyone sees it.

## The shapes

- `Command` (browser → server → extension): `prompt` · `steer` · `followup` ·
  `answer` · `rename` · `abort` · `dismiss`. Validated by `commandSchema` in
  `live.ts`.
- `LiveEvent` (extension → server → browser): `delta` · `toolStart` · `toolEnd`
  · `turnStart` · `turnEnd` · `idle` · `bash`. The `bash` event carries a
  dashboard shell escape (`!cmd` / `!!cmd`) run by the extension via `pi.exec`:
  `{ command, output, code, excluded }`. `excluded` (the `!!` variant) means the
  output was NOT fed to the agent's context. Validated by `liveEventSchema`.
- `AgentInbound` (extension → server): `register` · `event` · `deregister`.
- `ClientInbound` (browser → server): `subscribe`.
- `ServerToClient` (server → browser): `event` · `live`.
- `SessionListItem` / `TranscriptResponse` (HTTP JSON) — mirrored in
  `server/src/types.ts` and `web/src/types.ts`.

## Conventions that keep the contract robust

- **Validate inbound, clamp don't reject.** zod schemas *slice* oversized names/
  descriptions/command lists rather than failing the whole frame — one long
  skill description must never invalidate a register frame (it silently killed
  controllability once; see `DECISIONS.md`).
- **Fail-soft on the agent side.** The extension must never crash or block a
  real omp session: swallow send errors, guard every handler, reconnect via the
  session's managed timers.
- **New command types** need: the union (3 files), the zod variant
  (`commandSchema`), and an `applyCommand` branch in the extension.

Quick audit — every command type appears in all three files:

    for t in prompt steer followup answer rename abort dismiss; do
      echo "$t:" $(grep -rl "\"$t\"\|'$t'\|literal(\"$t\")" server/src/types.ts server/src/live.ts extension/index.ts web/src/types.ts | wc -l) "files"
    done
    # expect 3-4 files each; a count of 1-2 means the mirror is broken
