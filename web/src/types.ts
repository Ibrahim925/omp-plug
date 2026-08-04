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
}

export type LiveEvent =
  | { kind: "delta"; channel: "text" | "thinking"; text: string }
  | { kind: "toolStart"; name?: string; intent?: string }
  | { kind: "toolEnd"; name?: string }
  | { kind: "turnStart" }
  | { kind: "turnEnd" }
  | { kind: "idle" };

export type Command =
  | { type: "prompt"; text: string }
  | { type: "steer"; text: string }
  | { type: "followup"; text: string }
  | { type: "abort" };

export type ServerToClient =
  | { type: "event"; sessionId: string; event: LiveEvent }
  | { type: "live"; sessionIds: string[] };
