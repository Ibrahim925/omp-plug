// omp-report: reports every interactive omp session to a local omp-plug
// dashboard server and accepts control commands (prompt / steer / abort) from it.
//
// Install once — drop this directory in ~/.omp/agent/extensions/ — and it runs
// in every future session automatically. It is strictly fail-soft: if the
// dashboard is down it retries in the background (via crash-isolated managed
// timers) and never blocks or crashes the session.
//
// Config resolution (first wins): env vars, then ~/.omp-plug.json
// ({ "url": "...", "token": "..." }). The config file is the robust path — it
// works no matter what a session's shell environment looks like.
//   OMP_PLUG_URL     dashboard base ws url         (default ws://127.0.0.1:7317)
//   OMP_PLUG_TOKEN   shared secret, if the server requires one
//   OMP_PLUG_FORCE   report non-interactive (rpc/headless) sessions too
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

// --- wire contract (kept in sync with server/src/types.ts) ---
interface LiveSessionMeta {
  sessionId: string;
  cwd?: string;
  title?: string;
  model?: string;
  pid?: number;
  startedAt?: string;
}
type LiveEvent =
  | { kind: "delta"; channel: "text" | "thinking"; text: string }
  | { kind: "toolStart"; name?: string; intent?: string }
  | { kind: "toolEnd"; name?: string }
  | { kind: "turnStart" }
  | { kind: "turnEnd" }
  | { kind: "idle" };

interface SessionCtx {
  hasUI: boolean;
  cwd?: string;
  abort(): void;
  sessionManager: unknown;
  model?: unknown;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

interface Header {
  id?: string;
  cwd?: string;
  title?: string;
}

const WS_OPEN = 1;
const RECONNECT_MS = 3000;

function strProp(obj: unknown, key: string): string | undefined {
  if (obj && typeof obj === "object" && key in obj) {
    const value = (obj as Record<string, unknown>)[key];
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

function readHeader(sm: unknown): Header {
  if (sm && typeof sm === "object" && "getHeader" in sm && typeof sm.getHeader === "function") {
    const header: unknown = sm.getHeader();
    return { id: strProp(header, "id"), cwd: strProp(header, "cwd"), title: strProp(header, "title") };
  }
  return {};
}

function modelString(model: unknown): string | undefined {
  const provider = strProp(model, "provider");
  const id = strProp(model, "id");
  const joined = [provider, id].filter(Boolean).join("/");
  if (joined) return joined;
  return typeof model === "string" ? model : undefined;
}

function readConfig(): { url?: string; token?: string } {
  try {
    const raw: unknown = JSON.parse(readFileSync(join(homedir(), ".omp-plug.json"), "utf8"));
    return { url: strProp(raw, "url"), token: strProp(raw, "token") };
  } catch {
    return {};
  }
}

export default function ompReport(pi: ExtensionAPI): void {
  const config = readConfig();
  const base = (process.env.OMP_PLUG_URL || config.url || "ws://127.0.0.1:7317").replace(/\/+$/, "");
  const agentUrl = `${base}/ws/agent`;
  const token = process.env.OMP_PLUG_TOKEN ?? config.token;

  let ctx: SessionCtx | null = null;
  let socket: WebSocket | null = null;
  let reconnect: unknown = null;
  let meta: LiveSessionMeta | null = null;
  let closed = false;

  function announce(): void {
    if (socket?.readyState === WS_OPEN && meta) {
      try {
        socket.send(JSON.stringify({ type: "register", token, meta }));
      } catch {
        // send failed; the close handler will schedule a reconnect.
      }
    }
  }

  function emit(event: LiveEvent): void {
    if (socket?.readyState === WS_OPEN && meta) {
      try {
        socket.send(JSON.stringify({ type: "event", sessionId: meta.sessionId, event }));
      } catch {
        // ignore transient send failures
      }
    }
  }

  function applyCommand(raw: unknown): void {
    if (!raw || typeof raw !== "object" || !("type" in raw)) return;
    const type = (raw as Record<string, unknown>).type;
    try {
      if (type === "abort") {
        ctx?.abort();
        return;
      }
      const text = strProp(raw, "text");
      if (!text) return;
      if (type === "steer") pi.sendUserMessage(text, { deliverAs: "steer" });
      else if (type === "followup") pi.sendUserMessage(text, { deliverAs: "followUp" });
      else if (type === "prompt") pi.sendUserMessage(text);
    } catch {
      // never let a bad command take down the session
    }
  }

  function scheduleReconnect(): void {
    if (closed || !ctx) return;
    ctx.clearTimer(reconnect);
    reconnect = ctx.setTimeout(connect, RECONNECT_MS);
  }

  function connect(): void {
    if (closed || !ctx) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(agentUrl);
    } catch {
      scheduleReconnect();
      return;
    }
    socket = ws;
    ws.onopen = () => announce();
    ws.onmessage = (ev) => {
      try {
        applyCommand(JSON.parse(String(ev.data)));
      } catch {
        // malformed command frame — ignore
      }
    };
    ws.onclose = () => {
      if (socket === ws) socket = null;
      scheduleReconnect();
    };
    ws.onerror = () => {
      try {
        ws.close();
      } catch {
        // already closing
      }
    };
  }

  function refreshMeta(): void {
    if (!ctx) return;
    const header = readHeader(ctx.sessionManager);
    if (!header.id) return;
    meta = {
      sessionId: header.id,
      cwd: ctx.cwd ?? header.cwd,
      title: header.title || pi.getSessionName?.() || undefined,
      model: modelString(ctx.model),
      pid: process.pid,
      startedAt: new Date().toISOString(),
    };
  }

  pi.on("session_start", async (_event, sessionCtx) => {
    ctx = sessionCtx as unknown as SessionCtx;
    if (!ctx.hasUI && !process.env.OMP_PLUG_FORCE) return;
    refreshMeta();
    if (!meta) return;
    if (socket) announce();
    else connect();
  });

  pi.on("session_switch", async () => {
    const previous = meta?.sessionId;
    refreshMeta();
    if (previous && meta && previous !== meta.sessionId && socket?.readyState === WS_OPEN) {
      try {
        socket.send(JSON.stringify({ type: "deregister", sessionId: previous }));
      } catch {
        // ignore
      }
    }
    announce();
  });

  // --- live event forwarding ---
  pi.on("agent_start", async () => emit({ kind: "turnStart" }));
  pi.on("agent_end", async () => emit({ kind: "idle" }));
  pi.on("turn_end", async () => emit({ kind: "turnEnd" }));
  pi.on("message_end", async () => emit({ kind: "turnEnd" }));
  pi.on("message_update", async (event) => {
    const ame = (event as Record<string, unknown>).assistantMessageEvent;
    const type = strProp(ame, "type");
    const delta = strProp(ame, "delta");
    if (!delta) return;
    if (type === "text_delta") emit({ kind: "delta", channel: "text", text: delta });
    else if (type === "thinking_delta") emit({ kind: "delta", channel: "thinking", text: delta });
  });
  pi.on("tool_execution_start", async (event) => {
    emit({ kind: "toolStart", name: strProp(event, "toolName"), intent: strProp(event, "intent") });
  });
  pi.on("tool_execution_end", async (event) => {
    emit({ kind: "toolEnd", name: strProp(event, "toolName") });
  });

  pi.on("session_shutdown", async () => {
    closed = true;
    if (ctx) ctx.clearTimer(reconnect);
    if (socket?.readyState === WS_OPEN && meta) {
      try {
        socket.send(JSON.stringify({ type: "deregister", sessionId: meta.sessionId }));
      } catch {
        // ignore
      }
    }
    try {
      socket?.close();
    } catch {
      // ignore
    }
    socket = null;
  });
}
