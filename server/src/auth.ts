// Shared-secret resolution, used by BOTH the HTTP/browser plane (index.ts) and
// the agent register plane (live.ts). Env wins; otherwise ~/.omp-plug.json —
// the launchd service deliberately carries no token in its environment, so the
// config file is the normal path. Keeping this in one place matters: when the
// two planes resolved the token differently, agent registration ran
// unauthenticated whenever the token lived only in the config file.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function readConfigToken(): string {
  try {
    const raw: unknown = JSON.parse(readFileSync(join(homedir(), ".omp-plug.json"), "utf8"));
    if (raw && typeof raw === "object" && "token" in raw && typeof raw.token === "string") {
      return raw.token;
    }
  } catch {
    // no config file / unreadable -> no token
  }
  return "";
}

/** Resolved shared secret; empty string means auth is disabled. */
export const AUTH = process.env.OMP_PLUG_TOKEN || readConfigToken();
