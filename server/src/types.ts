// Local contract for the slice of the omp coding-agent SDK we consume, plus the
// wire shapes this server emits to the web client. We define our own interfaces
// (rather than importing the SDK's) because the SDK is resolved at runtime from
// the global install and is not a build-time dependency of this workspace.

export interface SessionMeta {
  path: string;
  id: string;
  cwd: string;
  title?: string;
  created?: string;
  modified?: string;
  status?: string;
  messageCount?: number;
  size?: number;
}

export interface SessionInstance {
  getEntries(): unknown[];
  getLeafId(): string | null | undefined;
  getHeader(): { id?: string; cwd?: string; title?: string } | undefined;
}

export interface SessionManagerStatic {
  listAll(): Promise<SessionMeta[]>;
  open(path: string): Promise<SessionInstance>;
}

export type ContentBlock = Record<string, unknown>;

export interface RawMessage {
  role: string;
  content: string | ContentBlock[];
  customType?: string;
  display?: boolean;
  isError?: boolean;
  toolCallId?: string;
  toolUseId?: string;
  id?: string;
  model?: string;
  timestamp?: number;
}

export interface TranscriptContext {
  messages?: RawMessage[];
  models?: { default?: string };
}

export interface Sdk {
  SessionManager: SessionManagerStatic;
  buildSessionContext(
    entries: unknown[],
    leafId: string | null | undefined,
    byId: unknown,
    options: { transcript?: boolean; keepDanglingToolCalls?: boolean },
  ): TranscriptContext;
}

// ---- Wire shapes emitted to the web client ----

export type WireBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "toolCall"; id?: string; name?: string; intent?: string; arguments?: unknown }
  | { type: "image"; mimeType?: string; data?: string; url?: string }
  | { type: "unknown"; text: string };

export interface WireMessage {
  role: string;
  customType?: string;
  toolCallId?: string;
  isError?: boolean;
  model?: string;
  timestamp?: number;
  content: WireBlock[];
}

export interface SessionListItem {
  id: string;
  cwd: string;
  project: string;
  title?: string;
  created?: string;
  modified?: string;
  status?: string;
  messageCount?: number;
  size?: number;
  live: boolean;
  controllable: boolean;
}

/** A slash command available in a live session (name without leading slash). */
export interface SlashCommand {
  name: string;
  description?: string;
}

export interface TranscriptResponse {
  id: string;
  cwd: string;
  project: string;
  title?: string;
  status?: string;
  model?: string;
  live: boolean;
  controllable: boolean;
  messages: WireMessage[];
  commands?: SlashCommand[];
}

// ---- Live plane contract (extension <-> server <-> web) ----

/** Metadata an omp session's extension advertises when it connects. */
export interface LiveSessionMeta {
  sessionId: string;
  cwd?: string;
  title?: string;
  model?: string;
  pid?: number;
  startedAt?: string;
  commands?: SlashCommand[];
}

/** Normalized live event forwarded from a running session to subscribed browsers. */
export type LiveEvent =
  | { kind: "delta"; channel: "text" | "thinking"; text: string }
  | { kind: "toolStart"; name?: string; intent?: string }
  | { kind: "toolEnd"; name?: string }
  | { kind: "turnStart" }
  | { kind: "turnEnd" }
  | { kind: "idle" };

/** Inline image attached to a control command (base64, no data: prefix). */
export interface ImagePayload {
  mimeType: string;
  data: string;
}

/** Structured per-question answer for a pending `ask` (native resolution). */
export interface AskAnswerResult {
  id: string;
  selectedOptions: string[];
  customInput?: string;
}

/** Control command routed from a browser to a running session's extension. */
export type Command =
  | { type: "prompt"; text: string; images?: ImagePayload[] }
  | { type: "steer"; text: string; images?: ImagePayload[] }
  | { type: "followup"; text: string; images?: ImagePayload[] }
  | { type: "answer"; text: string; results?: AskAnswerResult[] }
  | { type: "abort" };

/** Frames the extension (agent WS client) sends to the server. */
export type AgentInbound =
  | { type: "register"; token?: string; meta: LiveSessionMeta }
  | { type: "event"; sessionId: string; event: LiveEvent }
  | { type: "deregister"; sessionId: string };

/** Frames a browser (client WS) sends to the server. */
export type ClientInbound = { type: "subscribe"; sessionId: string };

/** Frames the server pushes to browser clients. */
export type ServerToClient =
  | { type: "event"; sessionId: string; event: LiveEvent }
  | { type: "live"; sessionIds: string[] };
