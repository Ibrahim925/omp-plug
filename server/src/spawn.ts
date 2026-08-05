// Spawn plane: launch fresh omp sessions on demand as headless `--mode rpc-ui`
// child processes.
//
// rpc-ui is the one non-TTY mode that boots with `hasUI = true`, so the
// installed omp-report extension reports the session to /ws/agent on startup
// (no OMP_PLUG_FORCE needed) and the native `ask` tool activates. The child
// owns stdin as its RPC transport: we keep the pipe open and never write to it,
// so the process idles — driven entirely through the dashboard command plane
// (prompt/steer/abort) that the extension applies via pi.sendUserMessage.
//
// Everything here is process-local: a spawned child is tracked by pid so a
// later delete can terminate it, and a requested title is applied once the
// child registers (see live.ts).
import { existsSync, statSync } from "node:fs";

import type { Subprocess } from "bun";

import { AUTH } from "./auth.ts";

const OMP_BIN = process.env.OMP_PLUG_OMP_BIN || "omp";
const PORT = Number(process.env.PORT || 7317);
// The child connects back to THIS server over loopback regardless of the bind
// host (which may be 0.0.0.0). Overridable for unusual topologies.
const AGENT_URL = process.env.OMP_PLUG_SELF_URL || `ws://127.0.0.1:${PORT}`;

// Detect an immediate crash (bad binary, no configured model, unreadable cwd)
// so the create request fails loudly instead of silently orphaning nothing.
const EARLY_EXIT_MS = 1200;

interface Child {
  proc: Subprocess;
  cwd: string;
  startedAt: number;
  /** Applied via a rename command once the session registers. */
  title?: string;
}

const children = new Map<number, Child>();

export interface SpawnResult {
  pid: number;
}

export class SpawnError extends Error {}

/** Launch a new live session rooted at `cwd`. Rejects on immediate failure. */
export async function spawnSession(opts: { cwd: string; title?: string }): Promise<SpawnResult> {
  const cwd = opts.cwd;
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
    throw new SpawnError(`not a directory: ${cwd}`);
  }

  const env: Record<string, string> = { ...(process.env as Record<string, string>), OMP_PLUG_URL: AGENT_URL };
  if (AUTH) env.OMP_PLUG_TOKEN = AUTH;

  let proc: Subprocess;
  try {
    proc = Bun.spawn([OMP_BIN, "--mode", "rpc-ui"], {
      cwd,
      env,
      // Keep stdin open (rpc transport) so the session idles instead of hitting
      // EOF and exiting. stdout is the RPC frame channel we never read; both it
      // and stderr are ignored to avoid pipe backpressure stalling the child.
      stdin: "pipe",
      stdout: "ignore",
      stderr: "ignore",
    });
  } catch (err) {
    throw new SpawnError(`failed to launch ${OMP_BIN}: ${(err as Error).message}`);
  }

  const pid = proc.pid;
  children.set(pid, { proc, cwd, startedAt: Date.now(), title: opts.title });
  void proc.exited.then(() => {
    children.delete(pid);
  });

  // Catch an immediate crash and surface it as the create failure.
  const exited = await Promise.race([
    proc.exited.then((code) => ({ code }) as const),
    Bun.sleep(EARLY_EXIT_MS).then(() => null),
  ]);
  if (exited) {
    throw new SpawnError(
      `session process exited immediately (code ${exited.code}). ` +
        `Check that \`${OMP_BIN}\` is installed and a default model is configured.`,
    );
  }
  return { pid };
}

/** True when the pid belongs to a session this server launched. */
export function isSpawned(pid: number | undefined): boolean {
  return pid != null && children.has(pid);
}

/**
 * Terminate a spawned child by pid and wait for it to exit. Awaiting matters:
 * a delete that follows must not race a final atomic session rewrite that would
 * resurrect the file. Returns false when the pid is unknown.
 */
export async function stopSpawned(pid: number | undefined): Promise<boolean> {
  if (pid == null) return false;
  const child = children.get(pid);
  if (!child) return false;
  children.delete(pid);
  try {
    child.proc.kill(); // SIGTERM: lets session_shutdown deregister + dispose
    const exited = await Promise.race([
      child.proc.exited.then(() => true),
      Bun.sleep(2000).then(() => false),
    ]);
    if (!exited) {
      child.proc.kill("SIGKILL");
      await child.proc.exited;
    }
  } catch {
    // already gone
  }
  return true;
}

/**
 * Consume the pending title for a freshly registered child, if any. Returns it
 * once, then clears it so a reconnecting session is not renamed again.
 */
export function takePendingTitle(pid: number | undefined): string | undefined {
  if (pid == null) return undefined;
  const child = children.get(pid);
  if (!child?.title) return undefined;
  const title = child.title;
  child.title = undefined;
  return title;
}
