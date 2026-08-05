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
  /** Resolves spawnSession's wait with the sessionId once the child registers. */
  onRegister?: (sessionId: string) => void;
}

const children = new Map<number, Child>();

export interface SpawnResult {
  pid: number;
  /** Known when the child's extension registered within the spawn wait. */
  sessionId?: string;
}

export class SpawnError extends Error {}

/**
 * Launch an omp child in `--mode rpc-ui` (the one non-TTY mode with hasUI, so
 * the extension reports on boot), track it by pid, and wait until it registers,
 * exits, or the crash-detection window elapses. Returns the sessionId when the
 * child registered within the wait. Shared by fresh spawns and resumes.
 */
async function launch(cwd: string, extraArgs: string[], title?: string): Promise<SpawnResult> {
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
    throw new SpawnError(`not a directory: ${cwd}`);
  }

  const env: Record<string, string> = { ...(process.env as Record<string, string>), OMP_PLUG_URL: AGENT_URL };
  if (AUTH) env.OMP_PLUG_TOKEN = AUTH;

  let proc: Subprocess;
  try {
    proc = Bun.spawn([OMP_BIN, "--mode", "rpc-ui", ...extraArgs], {
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
  const registered = new Promise<string>((resolve) => {
    children.set(pid, { proc, cwd, startedAt: Date.now(), title, onRegister: resolve });
  });
  void proc.exited.then(() => {
    children.delete(pid);
  });

  // Settle on whichever comes first: the child's extension registers (success —
  // we learn the sessionId so the client can open/attach the session), the
  // process exits (immediate crash — surface it as the failure), or the
  // crash-detection window elapses (alive but slow to register — return just the
  // pid and let the client's burst-refresh pick the session up).
  const outcome = await Promise.race([
    registered.then((sessionId) => ({ kind: "registered", sessionId }) as const),
    proc.exited.then((code) => ({ kind: "exited", code }) as const),
    Bun.sleep(EARLY_EXIT_MS).then(() => ({ kind: "timeout" }) as const),
  ]);
  if (outcome.kind === "exited") {
    throw new SpawnError(
      `session process exited immediately (code ${outcome.code}). ` +
        `Check that \`${OMP_BIN}\` is installed and a default model is configured.`,
    );
  }
  return { pid, sessionId: outcome.kind === "registered" ? outcome.sessionId : undefined };
}

/** Launch a new live session rooted at `cwd`. Rejects on immediate failure. */
export function spawnSession(opts: { cwd: string; title?: string }): Promise<SpawnResult> {
  return launch(opts.cwd, [], opts.title);
}

/**
 * Resume a persisted session headlessly so an otherwise-inactive session
 * becomes controllable again. Its extension re-registers under the same
 * sessionId. Only safe for sessions no other process currently owns (the caller
 * must gate out live ones); rooted at the session's original `cwd`.
 */
export function resumeSession(opts: { id: string; cwd: string }): Promise<SpawnResult> {
  return launch(opts.cwd, ["--resume", opts.id]);
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

/**
 * Correlate a freshly registered session's id back to the pid that spawned it,
 * resolving spawnSession's wait so the create response can carry the sessionId
 * (used to auto-open the new session in the dashboard). No-op for pids this
 * server did not spawn or that already resolved.
 */
export function noteRegistered(pid: number | undefined, sessionId: string): void {
  if (pid == null) return;
  const child = children.get(pid);
  if (!child) return;
  child.onRegister?.(sessionId);
  child.onRegister = undefined;
}
