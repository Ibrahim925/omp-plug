# Deploy & Run

> Read this when changing how the dashboard is installed, started, configured,
> or how the extension attaches to omp.

## Topology

- **Dashboard host** (one machine): runs the `server/` process, serves the built
  `web/dist`. Default `HOST=0.0.0.0 PORT=7317`. Usually reached over Tailscale.
- **Agent machines** (any machine running omp, may be the same host): the
  `omp-report` extension is symlinked into `~/.omp/agent/extensions/` and
  connects back to the dashboard's `/ws/agent`.

## Config — `~/.omp-plug.json` (single source of truth)

```json
{ "url": "ws://127.0.0.1:7317", "token": "<shared-secret>" }
```

- `token` — shared secret. When set, **every** `/api/*` route and `/ws/client`
  require it (`x-omp-token` header, `?token=` query, or `omp_token` cookie);
  `/api/health` and static assets stay open. The agent WS authenticates via the
  same token in its register frame. Empty/absent token = open server.
- `url` — where the extension dials the dashboard. Env `OMP_PLUG_URL` /
  `OMP_PLUG_TOKEN` override the file. Resolution is unified in `server/src/auth.ts`
  and the extension's `readConfig()` — keep them in agreement.
- Spawned sessions (`spawn.ts`) are handed `OMP_PLUG_URL=ws://127.0.0.1:<PORT>`
  explicitly so they always dial *this* server regardless of the config file.

## Install — `scripts/install.sh` (macOS, idempotent)

```
./scripts/install.sh --token <secret> [--url ws://host:7317] [--no-dashboard]
```

1. Symlinks `extension/` → `~/.omp/agent/extensions/omp-report`.
2. Writes `~/.omp-plug.json` (chmod 600).
3. Unless `--no-dashboard`: `bun install` + `bun run build`, renders
   `scripts/com.omp-plug.dashboard.plist.tmpl` (substituting `__BUN__`,
   `__REPO__`, `__HOME__`) into a launchd agent `com.omp-plug.dashboard`
   (`RunAtLoad` + `KeepAlive`), logging to `~/Library/Logs/omp-plug.log`.

Agent-only machine: `--no-dashboard --url ws://<host>:7317 --token <secret>`.
Uninstall: `scripts/uninstall.sh`. Never hand-edit the installed plist — rerun
the script (the template is the source).

## Local development

- `make dev` — server with `--watch` (serves an existing `web/dist`).
- `make dev-web` — Vite dev server with HMR; proxies `/api` → `:7317`.
  Note: the Vite proxy covers `/api` only, not `/ws/*` (see `feature_list.json`).
- `make build` — produce `web/dist`. `make start` — run the built app.
