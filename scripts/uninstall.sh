#!/usr/bin/env bash
# Remove omp-plug from this device. Leaves ~/.omp-plug.json and the repo intact.
set -euo pipefail

launchctl bootout "gui/$(id -u)/com.omp-plug.dashboard" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/com.omp-plug.dashboard.plist"
rm -f "$HOME/.omp/agent/extensions/omp-report"

echo "✓ removed launchd dashboard + extension symlink"
echo "· kept ~/.omp-plug.json (delete it manually to drop the saved secret)"
