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

export type LiveEvent =
  | { kind: "delta"; channel: "text" | "thinking"; text: string }
  | { kind: "toolStart"; name?: string; intent?: string }
  | { kind: "toolEnd"; name?: string }
  | { kind: "turnStart" }
  | { kind: "turnEnd" }
  | { kind: "idle" };

export interface ImagePayload {
  mimeType: string;
  data: string;
}

export type Command =
  | { type: "prompt"; text: string; images?: ImagePayload[] }
  | { type: "steer"; text: string; images?: ImagePayload[] }
  | { type: "followup"; text: string; images?: ImagePayload[] }
  | { type: "answer"; text: string }
  | { type: "abort" };

export type ServerToClient =
  | { type: "event"; sessionId: string; event: LiveEvent }
  | { type: "live"; sessionIds: string[] };
