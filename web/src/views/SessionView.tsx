import { useCallback, useEffect, useRef, useState } from "react";

import { fetchTranscript, sendCommand, subscribeLive } from "../api.ts";
import { navigate } from "../router.ts";
import type { LiveEvent, TranscriptResponse } from "../types.ts";
import { Message } from "./Message.tsx";

const REFETCH_THROTTLE_MS = 1200;
const FALLBACK_POLL_MS = 5000;

export function SessionView({ id }: { id: string }) {
  const [data, setData] = useState<TranscriptResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState("");
  const [working, setWorking] = useState(false);
  const [tool, setTool] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const lastFetch = useRef(0);
  const refetchTimer = useRef<number | undefined>(undefined);

  const doFetch = useCallback(async () => {
    lastFetch.current = Date.now();
    try {
      const next = await fetchTranscript(id);
      setData(next);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [id]);

  const scheduleRefetch = useCallback(() => {
    const since = Date.now() - lastFetch.current;
    if (since >= REFETCH_THROTTLE_MS) {
      doFetch();
    } else if (refetchTimer.current === undefined) {
      refetchTimer.current = window.setTimeout(() => {
        refetchTimer.current = undefined;
        doFetch();
      }, REFETCH_THROTTLE_MS - since);
    }
  }, [doFetch]);

  const onEvent = useCallback(
    (event: LiveEvent) => {
      switch (event.kind) {
        case "turnStart":
          setWorking(true);
          setPreview("");
          break;
        case "delta":
          setWorking(true);
          if (event.channel === "text") setPreview((p) => p + event.text);
          break;
        case "toolStart":
          setWorking(true);
          setTool(event.name ?? "tool");
          setPreview("");
          scheduleRefetch();
          break;
        case "toolEnd":
          setTool(null);
          scheduleRefetch();
          break;
        case "turnEnd":
          setPreview("");
          scheduleRefetch();
          break;
        case "idle":
          setWorking(false);
          setPreview("");
          setTool(null);
          scheduleRefetch();
          break;
      }
    },
    [scheduleRefetch],
  );

  useEffect(() => {
    doFetch();
  }, [doFetch]);

  useEffect(() => subscribeLive(id, onEvent), [id, onEvent]);

  useEffect(() => {
    if (!data?.live || data.controllable) return;
    const timer = setInterval(doFetch, FALLBACK_POLL_MS);
    return () => clearInterval(timer);
  }, [data?.live, data?.controllable, doFetch]);

  useEffect(() => {
    if (stick.current) bottomRef.current?.scrollIntoView();
  }, [data, preview, tool]);

  function onScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }

  async function submit() {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    stick.current = true;
    try {
      await sendCommand(id, { type: working ? "steer" : "prompt", text });
      setInput("");
      setWorking(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function stop() {
    try {
      await sendCommand(id, { type: "abort" });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="page">
      <header className="topbar">
        <button className="back" onClick={() => navigate("/")} aria-label="Back">
          ‹
        </button>
        <div className="topbar-title">
          <span className="row-title">{data?.title || "session"}</span>
          <span className="subtle small">
            {data?.project}
            {data?.model && ` · ${data.model}`}
            {data?.controllable ? " · live" : data?.live ? " · active" : data?.status ? ` · ${data.status}` : ""}
          </span>
        </div>
      </header>

      {error && <div className="banner error">{error}</div>}

      <div className="transcript" onScroll={onScroll}>
        {!data && !error && (
          <div>
            {[70, 92, 48, 80].map((w, i) => (
              <div className="msg" key={i}>
                <div className="skeleton skel-line" style={{ width: 64, height: 10, marginBottom: 8 }} />
                <div className="skeleton skel-line" style={{ width: `${w}%` }} />
              </div>
            ))}
          </div>
        )}
        {data?.messages.map((m, i) => (
          <Message key={i} message={m} />
        ))}

        {preview && (
          <div className="msg" data-role="assistant">
            <div className="msg-label">Assistant</div>
            <div className="msg-body">
              <div className="text">
                {preview}
                <span className="caret" />
              </div>
            </div>
          </div>
        )}

        {tool && <div className="tool-running">running {tool}…</div>}
        {working && !preview && !tool && <div className="tool-running">working…</div>}

        <div ref={bottomRef} />
      </div>

      {data?.controllable && (
        <div className="composer">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={working ? "Steer the agent…" : "Message…"}
            rows={1}
          />
          {working && (
            <button className="composer-btn stop" onClick={stop} aria-label="Stop">
              ■
            </button>
          )}
          <button className="composer-btn send" onClick={submit} disabled={sending || !input.trim()}>
            {working ? "Steer" : "Send"}
          </button>
        </div>
      )}

      {data && !data.controllable && data.live && (
        <div className="readonly-note">
          Read-only — this session started before omp-report was attached. Start a new omp session
          (or <code>/resume</code> this one in a fresh launch) to control it from here.
        </div>
      )}
    </div>
  );
}
