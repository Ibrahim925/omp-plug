# Contributing to omp-plug

Thanks for looking under the hood. This is a small, self-hosted tool with a
clear shape, and it's easy to work on once you know where things live.

## Get set up

```sh
git clone https://github.com/Ibrahim925/omp-plug.git
cd omp-plug
make setup     # bun install (Bun 1.3.14+)
make check     # confirm a clean checkout is green before you touch anything
```

You'll also need `omp` installed globally so the server can resolve the
`@oh-my-pi/pi-coding-agent` SDK at runtime. The dev loop:

```sh
make dev       # server with --watch, serves an existing web/dist
make dev-web    # Vite dev server with HMR (proxies /api -> :7317)
```

`make dev-web` is what you want for UI work — the server keeps running and the
Vite proxy forwards `/api`. Note the proxy covers `/api` only, not `/ws/*`, so
live WebSocket features need a running server on `:7317`.

## The map

Read [`AGENTS.md`](AGENTS.md) first — it's the orientation doc, and it points at
the topic docs in `docs/`. Load the one that matches your change:

- [`docs/architecture.md`](docs/architecture.md) — routing, the live/spawn/history planes, the WS bridges, SDK loading.
- [`docs/wire-contract.md`](docs/wire-contract.md) — anything that crosses extension ↔ server ↔ browser.
- [`docs/code-style.md`](docs/code-style.md) — read before writing code here.
- [`docs/deploy.md`](docs/deploy.md) — install, config, ports, push.

## The one rule that bites people

The WebSocket wire contract is hand-mirrored across three files with no shared
build to hold it together: `extension/index.ts`, `server/src/types.ts`, and
`web/src/types.ts`, with zod validation in `server/src/live.ts`. If you add or
change a message, command, event, or session shape, you change **all** of them
in the same PR. `docs/wire-contract.md` walks through it. Skipping a side won't
fail a typecheck — it'll silently break controllability at runtime.

## Before you open a PR

1. `make check` passes — web typechecks clean and the test suite is green. CI
   runs the same gate.
2. If your change crosses the extension ↔ server ↔ browser boundary, exercise
   the real path (curl an endpoint, or drive it in a browser). "It compiles"
   isn't done for wire changes.
3. Don't delete a failing test to go green. Fix the cause or say why the test
   is wrong.
4. Keep commits atomic — one logical change each, with a message that explains
   *why*. History here uses conventional prefixes (`feat:`, `fix:`, `chore:`,
   `docs:`); match that.
5. Never commit secrets. The shared token lives in `~/.omp-plug.json` and the
   VAPID keys in `~/.omp-plug-push.json` — both stay out of the repo.

## Please ask first

Open an issue before you spend real time on any of these — they change the
project's contract with everyone else running it:

- Adding a dependency.
- Changing the WebSocket or HTTP protocol.
- Changing `scripts/` (install, uninstall, the launchd layout) or the ports.
- Introducing a new stack choice.

## Reporting bugs and asking for features

Open an [issue](https://github.com/Ibrahim925/omp-plug/issues). For a bug,
include your OS, Bun version, how you're reaching the dashboard (loopback vs.
Tailscale, HTTP vs. HTTPS), and what you expected versus what happened. Logs
from `~/Library/Logs/omp-plug.log` (macOS launchd install) help a lot.
