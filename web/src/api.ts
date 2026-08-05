import type { Command, LiveEvent, ServerToClient, SessionListItem, TranscriptResponse } from "./types.ts";
import { getToken, notifyAuthRequired } from "./token.ts";

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = getToken();
  const headers: Record<string, string> = { ...extra };
  if (token) headers["x-omp-token"] = token;
  return headers;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: authHeaders() });
  if (res.status === 401) {
    notifyAuthRequired();
    throw new Error("unauthorized");
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${detail ? `: ${detail}` : ""}`);
  }
  return (await res.json()) as T;
}

export function fetchSessions(): Promise<SessionListItem[]> {
  return getJson<SessionListItem[]>("/api/sessions");
}

export function fetchTranscript(id: string): Promise<TranscriptResponse> {
  return getJson<TranscriptResponse>(`/api/sessions/${encodeURIComponent(id)}`);
}

export async function sendCommand(id: string, command: Command): Promise<void> {
  await mutate(`/api/sessions/${encodeURIComponent(id)}/command`, "POST", command);
}

async function mutate<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: authHeaders(body === undefined ? undefined : { "content-type": "application/json" }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) {
    notifyAuthRequired();
    throw new Error("unauthorized");
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`${res.status}${detail ? `: ${detail}` : ""}`);
  }
  return (await res.json().catch(() => ({}))) as T;
}

export function createSession(cwd: string, title?: string): Promise<{ ok: true; pid: number }> {
  return mutate("/api/sessions", "POST", { cwd, title });
}

export function deleteSession(id: string): Promise<{ ok: true }> {
  return mutate(`/api/sessions/${encodeURIComponent(id)}`, "DELETE");
}

export function renameSession(id: string, title: string): Promise<{ ok: true }> {
  return mutate(`/api/sessions/${encodeURIComponent(id)}`, "PATCH", { title });
}

export function deleteProject(cwd: string): Promise<{ ok: true; removed: number; skipped: number }> {
  return mutate(`/api/projects?cwd=${encodeURIComponent(cwd)}`, "DELETE");
}

export function fetchVapidKey(): Promise<{ key: string }> {
  return getJson<{ key: string }>("/api/push/key");
}

export function savePushSubscription(sub: PushSubscriptionJSON): Promise<{ ok: true }> {
  return mutate("/api/push/subscribe", "POST", sub);
}

export function deletePushSubscription(endpoint: string): Promise<{ ok: true }> {
  return mutate("/api/push/unsubscribe", "POST", { endpoint });
}

export function sendTestPush(): Promise<{ ok: true; subscriptions: number }> {
  return mutate("/api/push/test", "POST", {});
}

function wsUrl(path: string): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const token = getToken();
  const query = token ? `?token=${encodeURIComponent(token)}` : "";
  return `${proto}//${window.location.host}${path}${query}`;
}

// Subscribe to a session's live event stream. Returns a disposer. Reconnects
// automatically until disposed.
export function subscribeLive(
  sessionId: string,
  onEvent: (event: LiveEvent) => void,
  onLive?: (sessionIds: string[]) => void,
): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let retry: number | undefined;

  function open(): void {
    if (closed) return;
    ws = new WebSocket(wsUrl("/ws/client"));
    ws.onopen = () => ws?.send(JSON.stringify({ type: "subscribe", sessionId }));
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as ServerToClient;
        if (msg.type === "event" && msg.sessionId === sessionId) onEvent(msg.event);
        else if (msg.type === "live") onLive?.(msg.sessionIds);
      } catch {
        // ignore malformed frame
      }
    };
    ws.onclose = () => {
      if (!closed) retry = window.setTimeout(open, 2000);
    };
    ws.onerror = () => ws?.close();
  }

  open();
  return () => {
    closed = true;
    clearTimeout(retry);
    ws?.close();
  };
}
