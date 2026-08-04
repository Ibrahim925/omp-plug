import { useCallback, useEffect, useRef, useState } from "react";

import { fetchTranscript, sendCommand, subscribeLive } from "../api.ts";
import { navigate } from "../router.ts";
import type { ImagePayload, LiveEvent, TranscriptResponse } from "../types.ts";
import { Transcript } from "./Message.tsx";

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
  const [attachments, setAttachments] = useState<(ImagePayload & { url: string })[]>([]);

  const bottomRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const lastFetch = useRef(0);
  const refetchTimer = useRef<number | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);

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

  async function addFiles(files: FileList | File[]) {
    const picked = [...files].filter((f) => f.type.startsWith("image/"));
    const read = await Promise.all(
      picked.map(
        (file) =>
          new Promise<(ImagePayload & { url: string }) | null>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => {
              const url = String(reader.result);
              const comma = url.indexOf(",");
              resolve(comma < 0 ? null : { mimeType: file.type, data: url.slice(comma + 1), url });
            };
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(file);
          }),
      ),
    );
    const next = read.filter((x): x is ImagePayload & { url: string } => x !== null);
    if (next.length) setAttachments((prev) => [...prev, ...next].slice(0, 8));
  }

  function onPaste(e: React.ClipboardEvent) {
    const files = [...e.clipboardData.items]
      .filter((it) => it.kind === "file")
      .map((it) => it.getAsFile())
      .filter((f): f is File => f !== null);
    if (files.length) {
      e.preventDefault();
      addFiles(files);
    }
  }

  async function submit() {
    const text = input.trim();
    if ((!text && attachments.length === 0) || sending) return;
    setSending(true);
    stick.current = true;
    try {
      const images: ImagePayload[] | undefined = attachments.length
        ? attachments.map(({ mimeType, data }) => ({ mimeType, data }))
        : undefined;
      // A prompt requires text; when only images are attached, carry a nudge.
      const body = text || "(see attached image)";
      await sendCommand(id, { type: working ? "steer" : "prompt", text: body, images });
      setInput("");
      setAttachments([]);
      setWorking(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function onAnswer(text: string) {
    stick.current = true;
    try {
      await sendCommand(id, { type: "answer", text });
      setWorking(true);
    } catch (err) {
      setError((err as Error).message);
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
        {data && (
          <Transcript messages={data.messages} controllable={data.controllable} onAnswer={onAnswer} />
        )}

        {preview && (
          <div className="msg" data-role="assistant">
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
        <div className="composer-wrap">
          {attachments.length > 0 && (
            <div className="attachments">
              {attachments.map((att, i) => (
                <div className="attachment" key={i}>
                  <img src={att.url} alt="attachment" />
                  <button
                    type="button"
                    className="attachment-remove"
                    aria-label="Remove attachment"
                    onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="composer">
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className="composer-btn attach"
              onClick={() => fileInput.current?.click()}
              aria-label="Attach image"
            >
              +
            </button>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPaste={onPaste}
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
            <button
              className="composer-btn send"
              onClick={submit}
              disabled={sending || (!input.trim() && attachments.length === 0)}
            >
              {working ? "Steer" : "Send"}
            </button>
          </div>
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
