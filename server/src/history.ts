// Read-only history plane: list persisted omp sessions and render any one of
// them into a wire transcript. No dependency on a running session — everything
// comes from ~/.omp/agent/sessions via the SDK's own loader/transcript builder,
// so compaction inlining and blob (image) resolution are handled correctly.
import { basename } from "node:path";

import { getSdk } from "./sdk.ts";
import type {
  ContentBlock,
  RawMessage,
  SessionListItem,
  TranscriptResponse,
  WireBlock,
  WireMessage,
} from "./types.ts";

const LIVE_WINDOW_MS = 60_000;
const MAX_TEXT = 20_000;

// Applied to every text/thinking/serialized block so a single huge tool output
// can't blow up a mobile transcript payload. Used across all block kinds.
function clip(text: string): string {
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n…[+${text.length - MAX_TEXT} chars]` : text;
}

function isLive(modified: string | undefined): boolean {
  if (!modified) return false;
  const t = Date.parse(modified);
  return Number.isFinite(t) && Date.now() - t < LIVE_WINDOW_MS;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : JSON.stringify(value);
}

function normalizeBlock(block: ContentBlock): WireBlock {
  const type = typeof block.type === "string" ? block.type : "unknown";
  switch (type) {
    case "text":
      return { type: "text", text: clip(str(block.text)) };
    case "thinking":
      return { type: "thinking", text: clip(str(block.thinking ?? block.text)) };
    case "toolCall":
      return {
        type: "toolCall",
        id: typeof block.id === "string" ? block.id : undefined,
        name: typeof block.name === "string" ? block.name : undefined,
        intent: typeof block.intent === "string" ? block.intent : undefined,
        arguments: block.arguments,
      };
    case "image": {
      const source = block.source;
      const nested = source && typeof source === "object" ? (source as ContentBlock) : undefined;
      return {
        type: "image",
        mimeType: str(block.mimeType ?? block.mediaType ?? nested?.mediaType) || undefined,
        data: str(block.data ?? nested?.data) || undefined,
        url: str(block.url) || undefined,
      };
    }
    default:
      return { type: "unknown", text: clip(str(block)) };
  }
}

function normalizeMessage(message: RawMessage): WireMessage | null {
  // System-injected custom messages that omp itself hides (display:false) are
  // noise on a transcript view — drop them.
  if (message.role === "custom" && message.display === false) return null;

  let content: WireBlock[];
  if (typeof message.content === "string") {
    content = [{ type: "text", text: clip(message.content) }];
  } else if (Array.isArray(message.content)) {
    content = message.content.map(normalizeBlock);
  } else {
    content = [{ type: "text", text: clip(str(message.content)) }];
  }

  return {
    role: message.role,
    customType: message.customType,
    toolCallId: message.toolCallId ?? message.toolUseId ?? message.id,
    isError: message.isError,
    model: message.model,
    timestamp: message.timestamp,
    content,
  };
}

export async function listSessions(): Promise<SessionListItem[]> {
  const { SessionManager } = await getSdk();
  const all = await SessionManager.listAll();
  return all
    .map((s) => ({
      id: s.id,
      cwd: s.cwd,
      project: s.cwd ? basename(s.cwd) : "(unknown)",
      title: s.title,
      created: s.created,
      modified: s.modified,
      status: s.status,
      messageCount: s.messageCount,
      size: s.size,
      live: isLive(s.modified),
      controllable: false,
    }))
    .sort((a, b) => Date.parse(b.modified ?? "") - Date.parse(a.modified ?? ""));
}

export async function getTranscript(id: string): Promise<TranscriptResponse | null> {
  const { SessionManager, buildSessionContext } = await getSdk();
  const all = await SessionManager.listAll();
  const meta = all.find((s) => s.id === id) ?? all.find((s) => s.id.startsWith(id));
  if (!meta) return null;

  const sm = await SessionManager.open(meta.path);
  // keepDanglingToolCalls: a mid-turn rebuild sees the assistant's toolCall
  // before its result is persisted. Without it the SDK strips the block and a
  // pending `ask` never reaches the browser — invisible, unanswerable.
  const ctx = buildSessionContext(sm.getEntries(), sm.getLeafId(), undefined, {
    transcript: true,
    keepDanglingToolCalls: true,
  });
  const messages: WireMessage[] = [];
  for (const raw of ctx.messages ?? []) {
    const normalized = normalizeMessage(raw);
    if (normalized) messages.push(normalized);
  }

  return {
    id: meta.id,
    cwd: meta.cwd,
    project: meta.cwd ? basename(meta.cwd) : "(unknown)",
    title: meta.title,
    status: meta.status,
    model: ctx.models?.default,
    live: isLive(meta.modified),
    controllable: false,
    messages,
  };
}
