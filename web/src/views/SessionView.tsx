import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { deleteSession, fetchTranscript, renameSession, resumeSession, sendCommand, subscribeLive } from "../api.ts";
import { navigate } from "../router.ts";
import type { AskAnswerResult, ImagePayload, LiveEvent, TranscriptResponse } from "../types.ts";
import { Transcript } from "./Message.tsx";
import { CheckIcon, ChevronLeftIcon, CloseIcon, PaperclipIcon, PencilIcon, StopIcon, TrashIcon } from "./icons.tsx";

const REFETCH_THROTTLE_MS = 1200;
const FALLBACK_POLL_MS = 5000;

// Case-insensitive subsequence test for the slash-command fuzzy match: every
// char of `needle` appears in `hay` in order ("gwv" -> "git-worktrees").
function subseq(needle: string, hay: string): boolean {
  let i = 0;
  for (let j = 0; j < hay.length && i < needle.length; j++) {
    if (hay[j] === needle[i]) i += 1;
  }
  return i === needle.length;
}

export function SessionView({ id }: { id: string }) {
  const [data, setData] = useState<TranscriptResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState("");
  const [working, setWorking] = useState(false);
  const [tool, setTool] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState<(ImagePayload & { url: string })[]>([]);
  const [acIndex, setAcIndex] = useState(0);
  const [acDismissed, setAcDismissed] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [resuming, setResuming] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [bashRuns, setBashRuns] = useState<
    { id: number; command: string; output: string; code: number; excluded: boolean }[]
  >([]);

  const bottomRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const lastFetch = useRef(0);
  const refetchTimer = useRef<number | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const resumedFor = useRef<string | null>(null);

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

  // Wake an inactive session: launch a headless resume so it becomes
  // controllable again. Marks this id attempted so the auto-effect fires once,
  // while an explicit retry can force another go by resetting the guard.
  const doResume = useCallback(async () => {
    resumedFor.current = id;
    setResuming(true);
    setResumeError(null);
    try {
      await resumeSession(id);
      await doFetch();
    } catch (err) {
      setResumeError((err as Error).message);
    } finally {
      setResuming(false);
    }
  }, [id, doFetch]);

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
        case "bash":
          setBashRuns((prev) => [
            ...prev,
            {
              id: prev.length ? prev[prev.length - 1].id + 1 : 1,
              command: event.command,
              output: event.output,
              code: event.code,
              excluded: event.excluded,
            },
          ]);
          break;
      }
    },
    [scheduleRefetch],
  );

  useEffect(() => {
    doFetch();
  }, [doFetch]);

  useEffect(() => {
    setBashRuns([]);
  }, [id]);

  useEffect(() => subscribeLive(id, onEvent), [id, onEvent]);

  // A session should never be a read-only dead-end: as soon as we see it's
  // inactive (not controllable and not live elsewhere), resume it headlessly so
  // it's queryable. Live-but-not-controllable sessions are owned by another
  // process — those stay read-only (see the note below).
  useEffect(() => {
    if (!data || data.controllable || data.live) return;
    if (resumedFor.current === id || resuming) return;
    void doResume();
  }, [data, id, resuming, doResume]);

  // Fallback poll: (a) live but non-controllable sessions have no event stream
  // to trigger refetches; (b) a long-running tool (an `ask` awaiting input) is
  // silent after toolStart, so a refetch that raced the session-file write
  // would otherwise never be retried.
  useEffect(() => {
    if (!data?.live || (data.controllable && tool === null)) return;
    const timer = setInterval(doFetch, FALLBACK_POLL_MS);
    return () => clearInterval(timer);
  }, [data?.live, data?.controllable, tool, doFetch]);

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
      // `!`/`!!` shell escapes don't start an agent turn — the extension runs
      // them out of band and streams a `bash` event back.
      if (!text.startsWith("!")) setWorking(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function onAnswer(text: string, results?: AskAnswerResult[]) {
    stick.current = true;
    try {
      await sendCommand(id, { type: "answer", text, results });
      setWorking(true);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onDismiss() {
    stick.current = true;
    try {
      await sendCommand(id, { type: "dismiss" });
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

  function startRename() {
    setNameInput(data?.title ?? "");
    setRenaming(true);
  }

  async function saveName() {
    const title = nameInput.trim();
    if (!title) {
      setRenaming(false);
      return;
    }
    try {
      await renameSession(id, title);
      setData((prev) => (prev ? { ...prev, title } : prev));
      setRenaming(false);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove() {
    const label = data?.title || "this session";
    if (!window.confirm(`Delete "${label}"? This permanently removes it from disk.`)) return;
    try {
      await deleteSession(id);
      navigate("/");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // Slash-command autocomplete: active while the input is a single "/token" (no
  // whitespace), fuzzy-matched against the live session's advertised commands.
  // Rank exact > prefix > substring > subsequence so the closest surfaces first
  // ("/wt" finds "worktrees", "/gitcommit" finds "git-commit").
  const suggestions = useMemo(() => {
    const match = input.match(/^\/(\S*)$/);
    if (!match || !data?.commands?.length) return [];
    const q = match[1].toLowerCase();
    if (!q) return data.commands.slice(0, 8);
    const scored: { c: (typeof data.commands)[number]; score: number }[] = [];
    for (const c of data.commands) {
      const name = c.name.toLowerCase();
      const score = name === q ? 0 : name.startsWith(q) ? 1 : name.includes(q) ? 2 : subseq(q, name) ? 3 : -1;
      if (score >= 0) scored.push({ c, score });
    }
    scored.sort((a, b) => a.score - b.score || a.c.name.localeCompare(b.c.name));
    return scored.slice(0, 8).map((s) => s.c);
  }, [input, data?.commands]);

  const acActive = Math.min(acIndex, Math.max(0, suggestions.length - 1));
  const acOpen = suggestions.length > 0 && !acDismissed;

  function acceptSuggestion(name: string) {
    setInput(`/${name} `);
    setAcIndex(0);
    textarea.current?.focus();
  }

  return (
    <div className="page page-session">
      <header className="topbar">
        <button className="back" onClick={() => navigate("/")} aria-label="Back">
          <ChevronLeftIcon />
        </button>
        <div className="topbar-title">
          {renaming ? (
            <input
              className="rename-input"
              value={nameInput}
              autoFocus
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveName();
                else if (e.key === "Escape") setRenaming(false);
              }}
            />
          ) : (
            <span className="row-title">{data?.title || "session"}</span>
          )}
          <span className="subtle small">
            {data?.project}
            {data?.model && ` · ${data.model}`}
            {data?.controllable ? " · live" : data?.live ? " · active" : data?.status ? ` · ${data.status}` : ""}
          </span>
        </div>
        <div className="topbar-actions">
          {renaming ? (
            <>
              <button className="icon-btn" onClick={saveName} aria-label="Save name">
                <CheckIcon />
              </button>
              <button className="icon-btn" onClick={() => setRenaming(false)} aria-label="Cancel rename">
                <CloseIcon />
              </button>
            </>
          ) : (
            <>
              {data && (
                <button className="icon-btn" onClick={startRename} aria-label="Rename session">
                  <PencilIcon />
                </button>
              )}
              {data && (
                <button className="icon-btn danger" onClick={remove} aria-label="Delete session">
                  <TrashIcon />
                </button>
              )}
            </>
          )}
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
          <Transcript
            messages={data.messages}
            controllable={data.controllable}
            onAnswer={onAnswer}
            onDismiss={onDismiss}
          />
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

        {bashRuns.map((b) => (
          <div className={`bash-run${b.excluded ? " private" : ""}`} key={b.id}>
            <div className="bash-cmd">
              <span className="bash-sigil">$</span>
              <span className="bash-cmd-text">{b.command}</span>
              {b.excluded && <span className="bash-tag">private</span>}
            </div>
            {b.output && <pre className="bash-out">{b.output}</pre>}
            {b.code !== 0 && <div className="bash-exit">exit {b.code}</div>}
          </div>
        ))}

        {tool && <div className="tool-running">running {tool}…</div>}
        {working && !preview && !tool && <div className="tool-running">working…</div>}

        <div ref={bottomRef} />
      </div>

      {data?.controllable && (
        <div className="composer-wrap">
          {acOpen && (
            <div className="ac">
              {suggestions.map((c, i) => (
                <button
                  type="button"
                  key={c.name}
                  className={`ac-item${i === acActive ? " on" : ""}`}
                  onMouseEnter={() => setAcIndex(i)}
                  onClick={() => acceptSuggestion(c.name)}
                >
                  <span className="ac-name">/{c.name}</span>
                  {c.description && <span className="ac-desc">{c.description}</span>}
                </button>
              ))}
            </div>
          )}
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
                    <CloseIcon />
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
              <PaperclipIcon />
            </button>
            <textarea
              ref={textarea}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setAcIndex(0);
                setAcDismissed(false);
              }}
              onPaste={onPaste}
              onKeyDown={(e) => {
                if (acOpen) {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setAcIndex((i) => (i + 1) % suggestions.length);
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setAcIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
                    return;
                  }
                  if (e.key === "Tab" || (e.key === "Enter" && !e.metaKey && !e.ctrlKey)) {
                    e.preventDefault();
                    acceptSuggestion(suggestions[acActive].name);
                    return;
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setAcDismissed(true);
                    return;
                  }
                }
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
                <StopIcon />
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
          Read-only — this session isn't connected to the dashboard. Usually it started before
          omp-report was installed (start a new omp session or <code>/resume</code> this one in a
          fresh launch); if that's not it, check the extension's URL/token in{" "}
          <code>~/.omp-plug.json</code>.
        </div>
      )}

      {data && !data.controllable && !data.live && (
        <div className="readonly-note">
          {resuming ? (
            "Resuming this session…"
          ) : resumeError ? (
            <>
              Couldn&apos;t resume: {resumeError}{" "}
              <button type="button" className="resume-btn" onClick={() => void doResume()}>
                Retry
              </button>
            </>
          ) : (
            <>
              This session is inactive.{" "}
              <button type="button" className="resume-btn" onClick={() => void doResume()}>
                Resume
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
