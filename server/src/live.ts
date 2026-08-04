// Live plane: an in-memory registry of running omp sessions.
//
// Each session's `omp-report` extension connects to /ws/agent, registers, and
// forwards normalized live events. Browsers connect to /ws/client, subscribe to
// a session id, and receive that session's event stream. Control commands
// (prompt/steer/abort) are routed back to the owning agent socket.
//
// Everything here is process-local and ephemeral — the file-based history plane
// remains the source of truth for durable transcripts.
import { z } from "zod";

import type { ServerWebSocket } from "bun";

import type { Command, LiveEvent, LiveSessionMeta } from "./types.ts";

export type WsData =
  | { role: "agent"; sessionId?: string }
  | { role: "client"; subs: Set<string> };

type Ws = ServerWebSocket<WsData>;

interface Agent {
  meta: LiveSessionMeta;
  ws: Ws;
}

const agents = new Map<string, Agent>();
const clients = new Set<Ws>();
const TOKEN = process.env.OMP_PLUG_TOKEN ?? "";

const metaSchema = z.object({
  sessionId: z.string().min(1),
  cwd: z.string().optional(),
  title: z.string().optional(),
  model: z.string().optional(),
  pid: z.number().optional(),
  startedAt: z.string().optional(),
});

const liveEventSchema: z.ZodType<LiveEvent> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("delta"), channel: z.enum(["text", "thinking"]), text: z.string() }),
  z.object({ kind: z.literal("toolStart"), name: z.string().optional(), intent: z.string().optional() }),
  z.object({ kind: z.literal("toolEnd"), name: z.string().optional() }),
  z.object({ kind: z.literal("turnStart") }),
  z.object({ kind: z.literal("turnEnd") }),
  z.object({ kind: z.literal("idle") }),
]);

const agentInboundSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("register"), token: z.string().optional(), meta: metaSchema }),
  z.object({ type: z.literal("event"), sessionId: z.string(), event: liveEventSchema }),
  z.object({ type: z.literal("deregister"), sessionId: z.string() }),
]);

const clientInboundSchema = z.object({ type: z.literal("subscribe"), sessionId: z.string() });

const imageSchema = z.object({
  // base64 payload, no data: prefix. Cap ~8MB decoded (base64 is ~4/3 of raw).
  mimeType: z.string().min(1).max(100),
  data: z.string().min(1).max(11_000_000),
});
const imagesSchema = z.array(imageSchema).max(8).optional();

export const commandSchema: z.ZodType<Command> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("prompt"), text: z.string().min(1), images: imagesSchema }),
  z.object({ type: z.literal("steer"), text: z.string().min(1), images: imagesSchema }),
  z.object({ type: z.literal("followup"), text: z.string().min(1), images: imagesSchema }),
  z.object({ type: z.literal("answer"), text: z.string().min(1) }),
  z.object({ type: z.literal("abort") }),
]);

function parse(raw: string | Buffer): unknown {
  try {
    return JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8"));
  } catch {
    return undefined;
  }
}

function send(ws: Ws, payload: unknown): void {
  try {
    ws.send(JSON.stringify(payload));
  } catch {
    // Socket closing mid-send — drop; close handler cleans up registry state.
  }
}

function broadcastLive(): void {
  const sessionIds = [...agents.keys()];
  for (const client of clients) send(client, { type: "live", sessionIds });
}

export function isControllable(sessionId: string): boolean {
  return agents.has(sessionId);
}

export function liveMeta(): LiveSessionMeta[] {
  return [...agents.values()].map((a) => a.meta);
}

export function dispatchCommand(sessionId: string, command: Command): boolean {
  const agent = agents.get(sessionId);
  if (!agent) return false;
  send(agent.ws, command);
  return true;
}

export function handleAgentMessage(ws: Ws, raw: string | Buffer): void {
  const parsed = agentInboundSchema.safeParse(parse(raw));
  if (!parsed.success) return;
  const msg = parsed.data;

  if (msg.type === "register") {
    if (TOKEN && msg.token !== TOKEN) {
      send(ws, { type: "error", error: "unauthorized" });
      ws.close(4401, "unauthorized");
      return;
    }
    if (ws.data.role === "agent") ws.data.sessionId = msg.meta.sessionId;
    agents.set(msg.meta.sessionId, { meta: msg.meta, ws });
    broadcastLive();
    return;
  }

  if (msg.type === "event") {
    for (const client of clients) {
      if (client.data.role === "client" && client.data.subs.has(msg.sessionId)) {
        send(client, { type: "event", sessionId: msg.sessionId, event: msg.event });
      }
    }
    return;
  }

  // deregister
  const existing = agents.get(msg.sessionId);
  if (existing && existing.ws === ws) {
    agents.delete(msg.sessionId);
    broadcastLive();
  }
}

export function handleClientMessage(ws: Ws, raw: string | Buffer): void {
  const parsed = clientInboundSchema.safeParse(parse(raw));
  if (!parsed.success || ws.data.role !== "client") return;
  ws.data.subs.add(parsed.data.sessionId);
}

export function handleOpen(ws: Ws): void {
  if (ws.data.role === "client") {
    clients.add(ws);
    send(ws, { type: "live", sessionIds: [...agents.keys()] });
  }
}

export function handleClose(ws: Ws): void {
  if (ws.data.role === "client") {
    clients.delete(ws);
    return;
  }
  const { sessionId } = ws.data;
  if (sessionId && agents.get(sessionId)?.ws === ws) {
    agents.delete(sessionId);
    broadcastLive();
  }
}
