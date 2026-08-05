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
interface SlashCommand {
  name: string;
  description?: string;
}
interface LiveSessionMeta {
  sessionId: string;
  cwd?: string;
  title?: string;
  model?: string;
  pid?: number;
  startedAt?: string;
  commands?: SlashCommand[];
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
  isIdle(): boolean;
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

function prop(obj: unknown, key: string): unknown {
  if (obj && typeof obj === "object" && key in obj) {
    return (obj as Record<string, unknown>)[key];
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

// --- native ask override --------------------------------------------------
// Replaces the builtin `ask` tool (extension tools override builtins by name)
// with a wrapper that DELEGATES to the real AskTool — same schema, description,
// dialog, timeout, and notification behavior — while racing the terminal
// dialog against a dashboard-provided answer. Whichever side answers first
// yields a genuine ask tool result; the loser is torn down. This is what makes
// answering from the omp-plug app "native" instead of abort-plus-new-message.

interface AskOptionParam {
  label: string;
  description?: string;
}
interface AskQuestionParam {
  id: string;
  question: string;
  options: AskOptionParam[];
  multi?: boolean;
}
/** Structured per-question answer from the dashboard (wire: `answer.results`). */
interface AnswerResultWire {
  id: string;
  selectedOptions: string[];
  customInput?: string;
}
interface RemoteAnswer {
  text: string;
  results?: AnswerResultWire[];
  // Set when the dashboard dismissed the ask (the app's X / esc): every
  // question resolves as cancelled instead of consuming text/results.
  cancelled?: boolean;
}
interface QuestionOutcome {
  id: string;
  question: string;
  options: string[];
  multi: boolean;
  selectedOptions: string[];
  customInput?: string;
}
interface AskToolResult {
  content: { type: "text"; text: string }[];
  details?: unknown;
}
/** Structural slice of the SDK's AskTool that the override consumes. */
interface BuiltinAskTool {
  description: string;
  parameters: unknown;
  execute(
    toolCallId: string,
    params: unknown,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: unknown,
  ): Promise<AskToolResult>;
}
interface NativeAskHooks {
  setRemoteAnswerResolver(fn: ((answer: RemoteAnswer) => void) | null): void;
  acquireGate(): Promise<() => void>;
}

function readAnswerResults(raw: unknown): AnswerResultWire[] | undefined {
  const value = prop(raw, "results");
  if (!Array.isArray(value)) return undefined;
  const out: AnswerResultWire[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const id = strProp(item, "id");
    if (!id) continue;
    const rawSelected = prop(item, "selectedOptions");
    const selectedOptions = Array.isArray(rawSelected)
      ? rawSelected.filter((s): s is string => typeof s === "string")
      : [];
    const customInput = strProp(item, "customInput");
    out.push(customInput !== undefined ? { id, selectedOptions, customInput } : { id, selectedOptions });
  }
  return out.length ? out : undefined;
}

function readQuestions(params: unknown): AskQuestionParam[] {
  const value = prop(params, "questions");
  if (!Array.isArray(value)) return [];
  const out: AskQuestionParam[] = [];
  for (const item of value) {
    const id = strProp(item, "id");
    const question = strProp(item, "question");
    if (!id || !question) continue;
    const rawOptions = prop(item, "options");
    const options: AskOptionParam[] = [];
    if (Array.isArray(rawOptions)) {
      for (const o of rawOptions) {
        const label = strProp(o, "label");
        if (label) options.push({ label });
      }
    }
    out.push({ id, question, options, multi: prop(item, "multi") === true });
  }
  return out;
}

// Mirrors the builtin's formatSingleQuestionResponse (not exported by the SDK).
function formatSingleAnswer(r: QuestionOutcome): string {
  const parts: string[] = [];
  if (r.selectedOptions.length > 0) parts.push(`User selected: ${r.selectedOptions.join(", ")}`);
  if (r.customInput !== undefined) {
    parts.push(
      r.customInput.includes("\n")
        ? `User provided custom input:\n${r.customInput.split("\n").map((l) => `  ${l}`).join("\n")}`
        : `User provided custom input: ${r.customInput}`,
    );
  }
  return parts.length > 0 ? parts.join("\n") : "User cancelled the selection";
}

// Mirrors the builtin's formatQuestionResult (not exported by the SDK).
function formatAnswerLine(r: QuestionOutcome): string {
  if (r.customInput !== undefined) return `${r.id}: "${r.customInput}"`;
  if (r.selectedOptions.length > 0) {
    return r.multi ? `${r.id}: [${r.selectedOptions.join(", ")}]` : `${r.id}: ${r.selectedOptions[0]}`;
  }
  return `${r.id}: (cancelled)`;
}

function remoteAskResult(questions: AskQuestionParam[], answer: RemoteAnswer): AskToolResult {
  const wire = new Map<string, AnswerResultWire>();
  for (const r of answer.results ?? []) wire.set(r.id, r);

  // Legacy text-only answer to a multi-question ask has no per-question
  // mapping — return the combined text verbatim. A dismissal skips this: it
  // carries no text and must resolve every question as cancelled below.
  if (!answer.cancelled && questions.length > 1 && wire.size === 0) {
    return { content: [{ type: "text", text: `User answers:\n${answer.text}` }] };
  }

  const outcomes: QuestionOutcome[] = questions.map((q) => {
    const labels = q.options.map((o) => o.label);
    // Dismissed (esc): no selection, no custom input — the cancelled outcome.
    if (answer.cancelled) {
      return { id: q.id, question: q.question, options: labels, multi: q.multi === true, selectedOptions: [] };
    }
    const w = wire.get(q.id);
    let selectedOptions = (w?.selectedOptions ?? []).filter((l) => labels.includes(l));
    let customInput = w?.customInput?.trim() ? w.customInput : undefined;
    if (!w && questions.length === 1) {
      if (labels.includes(answer.text)) selectedOptions = [answer.text];
      else customInput = answer.text;
    }
    return {
      id: q.id,
      question: q.question,
      options: labels,
      multi: q.multi === true,
      selectedOptions,
      customInput,
    };
  });

  if (outcomes.length === 1) {
    const r = outcomes[0];
    // details mirror AskToolDetails so the TUI's native ask renderer applies.
    return {
      content: [{ type: "text", text: formatSingleAnswer(r) }],
      details: {
        question: r.question,
        options: r.options,
        multi: r.multi,
        selectedOptions: r.selectedOptions,
        customInput: r.customInput,
      },
    };
  }
  return {
    content: [{ type: "text", text: `User answers:\n${outcomes.map(formatAnswerLine).join("\n")}` }],
    details: { results: outcomes },
  };
}

async function raceAsk(
  builtin: BuiltinAskTool,
  hooks: NativeAskHooks,
  toolCallId: string,
  params: unknown,
  signal: AbortSignal | undefined,
  onUpdate: unknown,
  toolCtx: unknown,
): Promise<AskToolResult> {
  const localAbort = new AbortController();
  const combined = signal ? AbortSignal.any([signal, localAbort.signal]) : localAbort.signal;
  // Both settlement paths are captured up front so the losing leg can never
  // surface as an unhandled rejection.
  const local = builtin.execute(toolCallId, params, combined, onUpdate, toolCtx).then(
    (r) => ({ kind: "local" as const, r }),
    (e) => ({ kind: "error" as const, e: e as Error }),
  );
  const remote = new Promise<RemoteAnswer>((resolve) => hooks.setRemoteAnswerResolver(resolve));
  try {
    const winner = await Promise.race([local, remote.then((a) => ({ kind: "remote" as const, a }))]);
    if (winner.kind === "remote") {
      localAbort.abort(); // dismiss the TUI dialog
      await local; // wait for its teardown; the rejection is already captured
      return remoteAskResult(readQuestions(params), winner.a);
    }
    if (winner.kind === "error") throw winner.e;
    return winner.r;
  } finally {
    hooks.setRemoteAnswerResolver(null);
  }
}

function registerNativeAsk(pi: ExtensionAPI, hooks: NativeAskHooks): boolean {
  let builtin: BuiltinAskTool;
  try {
    const sdk = prop(pi, "pi");
    const ctor = prop(sdk, "AskTool");
    const settings = prop(sdk, "settings");
    if (typeof ctor !== "function" || !settings) return false;
    // Library boundary: the SDK is resolved at runtime; assert the constructor
    // against our structural slice after the runtime checks above.
    const AskToolCtor = ctor as unknown as new (session: unknown) => BuiltinAskTool;
    // AskTool reads only `settings` (ask.notify / ask.timeout / speech.enabled)
    // and optional `getPlanModeState` from its ToolSession — shim it with the
    // SDK's disk-backed settings singleton so behavior matches the builtin.
    builtin = new AskToolCtor({ settings, hasUI: true });
    if (typeof builtin.execute !== "function" || !builtin.description || !builtin.parameters) return false;
  } catch {
    // SDK surface changed — skip the override; the abort-based fallback stays.
    return false;
  }
  try {
    const definition = {
      name: "ask",
      label: "Ask",
      description: builtin.description,
      parameters: builtin.parameters, // builtin arktype schema, passed through
      approval: "read",
      // Headless sessions must not expose `ask` (the builtin is gated on
      // hasUI); session_start activates it for interactive sessions only.
      defaultInactive: true,
      execute: async (
        toolCallId: string,
        params: unknown,
        signal: AbortSignal | undefined,
        onUpdate: unknown,
        toolCtx: unknown,
      ): Promise<AskToolResult> => {
        const release = await hooks.acquireGate();
        try {
          return await raceAsk(builtin, hooks, toolCallId, params, signal, onUpdate, toolCtx);
        } finally {
          release();
        }
      },
    };
    // Library boundary: parameters/execute are typed structurally here while
    // registerTool expects the SDK's schema generics.
    pi.registerTool(definition as unknown as Parameters<ExtensionAPI["registerTool"]>[0]);
    return true;
  } catch {
    return false;
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
  // Fallback answer for a pending `ask` when the native override is not in
  // play: aborts the blocked tool, then delivers on agent_end.
  let pendingAnswer: string | null = null;
  // Native path: while the overridden `ask` tool is executing, this resolves
  // its remote-answer race leg with a dashboard-provided answer.
  let resolveRemoteAnswer: ((answer: RemoteAnswer) => void) | null = null;
  // Serializes overridden `ask` executions — the interactive dialog surface
  // has no queue (the builtin runs `concurrency: "exclusive"` for the same
  // reason), so a second concurrent ask must wait for the first.
  let askGate: Promise<void> = Promise.resolve();
  // Set when the ask override registered; gates per-session activation.
  const nativeAsk = registerNativeAsk(pi, {
    setRemoteAnswerResolver: (fn) => {
      resolveRemoteAnswer = fn;
    },
    acquireGate: async () => {
      const prev = askGate;
      let release!: () => void;
      askGate = new Promise<void>((r) => {
        release = r;
      });
      await prev;
      return release;
    },
  });

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

  function readImages(raw: unknown): { type: "image"; data: string; mimeType: string }[] {
    const value = (raw as Record<string, unknown>).images;
    if (!Array.isArray(value)) return [];
    const out: { type: "image"; data: string; mimeType: string }[] = [];
    for (const item of value) {
      const data = strProp(item, "data");
      const mimeType = strProp(item, "mimeType");
      if (data && mimeType) out.push({ type: "image", data, mimeType });
    }
    return out;
  }

  function applyCommand(raw: unknown): void {
    if (!raw || typeof raw !== "object" || !("type" in raw)) return;
    const type = (raw as Record<string, unknown>).type;
    try {
      if (type === "abort") {
        ctx?.abort();
        return;
      }
      if (type === "dismiss") {
        // App's X / esc: only the native override can resolve the blocked ask
        // as cancelled (a genuine "User cancelled the selection" tool result).
        // Without it there is no cancellable dialog to reach, so it's a no-op.
        if (resolveRemoteAnswer) resolveRemoteAnswer({ text: "", cancelled: true });
        return;
      }
      const text = strProp(raw, "text");
      if (type === "answer") {
        if (!text) return;
        // Native path: the overridden `ask` tool is blocked on its dialog race —
        // resolve it directly so the answer becomes a genuine tool result.
        if (resolveRemoteAnswer) {
          resolveRemoteAnswer({ text, results: readAnswerResults(raw) });
          return;
        }
        // Fallback (override unavailable, or the ask resolved in the meantime):
        // mirror what a terminal user does — cancel the blocked dialog and hand
        // the answer to the agent as the next user message; when idle, just send.
        if (ctx && !ctx.isIdle()) {
          pendingAnswer = text;
          ctx.abort();
        } else {
          pi.sendUserMessage(text);
        }
        return;
      }
      if (type === "rename") {
        if (!text) return;
        // Rename through the live instance so the session's own writer persists
        // it (no second writer racing the file), then re-announce so the
        // dashboard list reflects the new title without waiting on the file poll.
        void (async () => {
          try {
            await pi.setSessionName(text);
            if (meta) {
              meta.title = text;
              announce();
            }
          } catch {
            // rename failed (empty/invalid) — leave the existing title
          }
        })();
        return;
      }
      const images = readImages(raw);
      if (!text && images.length === 0) return;
      // Multimodal: when images are attached, build a content array (text block
      // first, then images); otherwise keep the plain-string fast path.
      const content =
        images.length > 0
          ? [...(text ? [{ type: "text" as const, text }] : []), ...images]
          : text;
      if (!content) return;
      if (type === "steer") pi.sendUserMessage(content, { deliverAs: "steer" });
      else if (type === "followup") pi.sendUserMessage(content, { deliverAs: "followUp" });
      else if (type === "prompt") pi.sendUserMessage(content);
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

  // Clamped to the server's wire contract (live.ts): name<=100, description<=400,
  // at most 200 commands. Skill commands routinely carry very long descriptions;
  // an oversized field must never invalidate the whole register frame.
  function readCommands(): SlashCommand[] | undefined {
    try {
      const list = pi.getCommands?.();
      if (!Array.isArray(list)) return undefined;
      const out: SlashCommand[] = [];
      for (const item of list) {
        const name = strProp(item, "name")?.slice(0, 100);
        if (!name) continue;
        const description = strProp(item, "description")?.slice(0, 400);
        out.push(description ? { name, description } : { name });
        if (out.length === 200) break;
      }
      return out.length ? out : undefined;
    } catch {
      return undefined;
    }
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
      commands: readCommands(),
    };
  }

  // The overriding `ask` registers defaultInactive so headless sessions never
  // expose it (matching the builtin's hasUI gate); activate it here.
  async function ensureAskActive(): Promise<void> {
    if (!nativeAsk || !ctx?.hasUI) return;
    try {
      const active = pi.getActiveTools();
      if (!active.includes("ask")) await pi.setActiveTools([...active, "ask"]);
    } catch {
      // activation failed — the tool stays inactive; the fallback answer path
      // (abort + user message) still functions.
    }
  }

  pi.on("session_start", async (_event, sessionCtx) => {
    ctx = sessionCtx as unknown as SessionCtx;
    await ensureAskActive();
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
    await ensureAskActive();
    announce();
  });

  // --- live event forwarding ---
  pi.on("agent_start", async () => emit({ kind: "turnStart" }));
  pi.on("agent_end", async () => {
    emit({ kind: "idle" });
    if (pendingAnswer !== null) {
      const text = pendingAnswer;
      pendingAnswer = null;
      // Let the aborted turn fully unwind before starting the answer turn.
      ctx?.setTimeout(() => pi.sendUserMessage(text), 250);
    }
  });
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
