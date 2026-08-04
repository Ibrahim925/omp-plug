#!/usr/bin/env bash
# Install omp-plug on this device. Idempotent — safe to re-run after git pull.
#
#   ./scripts/install.sh --token <secret> [--url ws://host:7317] [--no-dashboard]
#
# Steps:
#   1. symlink the omp-report extension into ~/.omp/agent/extensions
#   2. write ~/.omp-plug.json (url + shared secret) — the single source of truth
#   3. (unless --no-dashboard) render + load the launchd dashboard service
#
# On a machine that only RUNS omp (not the dashboard host), pass
# --no-dashboard and point --url at the host, e.g.
#   ./scripts/install.sh --no-dashboard --url ws://stans-macbook-pro.tail871ce3.ts.net:7317 --token <secret>
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUN="$(command -v bun || true)"
[ -n "$BUN" ] || { echo "error: bun not found in PATH" >&2; exit 1; }

URL="${OMP_PLUG_URL:-ws://127.0.0.1:7317}"
TOKEN="${OMP_PLUG_TOKEN:-}"
DASHBOARD=1
while [ $# -gt 0 ]; do
  case "$1" in
    --no-dashboard) DASHBOARD=0 ;;
    --url) URL="$2"; shift ;;
    --token) TOKEN="$2"; shift ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "error: unknown argument '$1'" >&2; exit 1 ;;
  esac
  shift
done

# 1. extension symlink
mkdir -p "$HOME/.omp/agent/extensions"
ln -sfn "$REPO/extension" "$HOME/.omp/agent/extensions/omp-report"
echo "✓ extension  -> ~/.omp/agent/extensions/omp-report"

# 2. config file (single source of truth for url + secret)
CONFIG="$HOME/.omp-plug.json"
if [ -n "$TOKEN" ]; then
  printf '{\n  "url": "%s",\n  "token": "%s"\n}\n' "$URL" "$TOKEN" > "$CONFIG"
  chmod 600 "$CONFIG"
  echo "✓ config     -> ~/.omp-plug.json (url=$URL)"
elif [ -f "$CONFIG" ]; then
  echo "✓ config     -> ~/.omp-plug.json (kept existing; pass --token to change)"
else
  echo "error: no secret. Pass --token <secret> or set OMP_PLUG_TOKEN." >&2
  exit 1
fi

# 3. dashboard service (host only)
if [ "$DASHBOARD" = 1 ]; then
  echo "· building dashboard (bun install + web build)…"
  ( cd "$REPO" && bun install >/dev/null 2>&1 && cd web && bun run build >/dev/null 2>&1 ) \
    || { echo "error: build failed — run 'cd $REPO && bun install && (cd web && bun run build)' to see why" >&2; exit 1; }
  mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
  PLIST="$HOME/Library/LaunchAgents/com.omp-plug.dashboard.plist"
  sed -e "s#__BUN__#$BUN#g" -e "s#__REPO__#$REPO#g" -e "s#__HOME__#$HOME#g" \
    "$REPO/scripts/com.omp-plug.dashboard.plist.tmpl" > "$PLIST"
  # bootout is asynchronous; retry bootstrap until the old instance is gone.
  launchctl bootout "gui/$(id -u)/com.omp-plug.dashboard" 2>/dev/null || true
  loaded=0
  for _ in 1 2 3 4 5 6; do
    if launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null; then loaded=1; break; fi
    sleep 1
  done
  [ "$loaded" = 1 ] || { echo "error: launchctl bootstrap failed (try: launchctl bootout gui/$(id -u)/com.omp-plug.dashboard; then rerun)" >&2; exit 1; }
  echo "✓ dashboard  -> launchd com.omp-plug.dashboard (runs now + every login)"
else
  echo "· dashboard  -> skipped (--no-dashboard)"
fi

echo "done."
