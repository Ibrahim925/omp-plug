import { memo, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

import type { AskAnswerResult, WireBlock, WireMessage } from "../types.ts";
import {
  CheckIcon,
  CheckSquareIcon,
  ChevronRightIcon,
  CircleIcon,
  CloseIcon,
  RadioDotIcon,
  SquareIcon,
} from "./icons.tsx";

const ROLE_LABEL: Record<string, string> = {
  user: "You",
  assistant: "Assistant",
  developer: "System",
  bashExecution: "Shell",
  custom: "Note",
};

// ---- ask tool payloads (mirror of the omp `ask` tool call arguments) ----
interface AskOption {
  label: string;
  description?: string;
}
interface AskQuestion {
  id: string;
  question: string;
  header?: string;
  options: AskOption[];
  multi?: boolean;
  recommended?: number;
}

const OTHER = "Other (type your own)";

// Field readers that narrow with `in`/`typeof` instead of unchecked casts —
// the `ask` arguments arrive from the transcript API (an untyped boundary).
function rec(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}
function getStr(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === "string" ? v : undefined;
}

function asQuestions(args: unknown): AskQuestion[] | null {
  const root = rec(args);
  const raw = root?.questions;
  if (!Array.isArray(raw)) return null;
  const out: AskQuestion[] = [];
  for (const q of raw) {
    const qo = rec(q);
    if (!qo) continue;
    const question = getStr(qo, "question");
    const optionsRaw = qo.options;
    if (!question || !Array.isArray(optionsRaw)) continue;
    const options: AskOption[] = [];
    for (const o of optionsRaw) {
      if (typeof o === "string") {
        options.push({ label: o });
        continue;
      }
      const oo = rec(o);
      const label = oo && getStr(oo, "label");
      if (oo && label) options.push({ label, description: getStr(oo, "description") });
    }
    if (options.length === 0) continue;
    const recommended = qo.recommended;
    out.push({
      id: getStr(qo, "id") ?? question,
      question,
      header: getStr(qo, "header"),
      options,
      multi: qo.multi === true,
      recommended: typeof recommended === "number" ? recommended : undefined,
    });
  }
  return out.length ? out : null;
}

function blockText(block: WireBlock): string {
  if (block.type === "text" || block.type === "thinking" || block.type === "unknown") return block.text;
  return "";
}

function resultText(message: WireMessage | undefined): string {
  if (!message) return "";
  return message.content.map(blockText).join("").trim();
}

// One-line preview shown on a collapsed tool unit — Codex-style.
function summarize(message: WireMessage | undefined): string {
  if (!message) return "";
  const text = resultText(message);
  if (!text) {
    const hasImage = message.content.some((b) => b.type === "image");
    return hasImage ? "image" : "";
  }
  const lines = text.split("\n");
  const first = lines.find((l) => l.trim().length > 0)?.trim() ?? "";
  const clipped = first.length > 100 ? `${first.slice(0, 100)}…` : first;
  const extra = lines.length > 1 ? ` · ${lines.length} lines` : "";
  return clipped + extra;
}

// Rendered markdown for prose (assistant/user text, thinking). GFM tables/
// strikethrough/task-lists on; links open in a new tab. react-markdown escapes
// raw HTML by default, so no sanitization step is needed.
function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{
          a: ({ node: _node, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer" />
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

// `plain` keeps tool output verbatim (monospace, no markdown); message prose
// renders as markdown.
function Block({ block, plain = false }: { block: WireBlock; plain?: boolean }) {
  switch (block.type) {
    case "text":
      return plain ? <div className="text">{block.text}</div> : <Markdown text={block.text} />;
    case "thinking":
      return (
        <details className="thinking">
          <summary><ChevronRightIcon className="thinking-caret" />thinking</summary>
          <Markdown text={block.text} />
        </details>
      );
    case "image": {
      const src = block.data
        ? `data:${block.mimeType ?? "image/png"};base64,${block.data}`
        : block.url;
      return src ? <img className="image" src={src} alt="attachment" loading="lazy" /> : null;
    }
    default:
      return <pre className="raw">{"text" in block ? block.text : ""}</pre>;
  }
}

type ToolCallBlock = Extract<WireBlock, { type: "toolCall" }>;

// Collapsible tool unit: header (name · intent · one-line result summary) that
// expands to args + full output. Keeps the transcript from drowning in tool
// output while every byte stays one click away.
function ToolUnit({ call, result }: { call: ToolCallBlock; result?: WireMessage }) {
  const [open, setOpen] = useState(false);
  const args = call.arguments;
  const hasArgs =
    args != null && !(typeof args === "object" && Object.keys(args as object).length === 0);
  const status = !result ? "pending" : result.isError ? "error" : "ok";
  const StatusIcon = status === "pending" ? CircleIcon : status === "error" ? CloseIcon : CheckIcon;

  return (
    <div className={`tool tool-${status}`}>
      <button type="button" className="tool-head" onClick={() => setOpen((o) => !o)}>
        <span className="tool-caret">
          <ChevronRightIcon className={open ? "open" : ""} />
        </span>
        <span className={`tool-status tool-status-${status}`}>
          <StatusIcon />
        </span>
        <span className="tool-name">{call.name ?? "tool"}</span>
        {call.intent && <span className="tool-intent">{call.intent}</span>}
        <span className="tool-summary">{summarize(result)}</span>
      </button>
      {open && (
        <div className="tool-body">
          {hasArgs && <pre className="tool-args-pre">{JSON.stringify(args, null, 2)}</pre>}
          {result && (
            <div className={`tool-output${result.isError ? " error" : ""}`}>
              {result.content.map((b, i) => (
                <Block key={i} block={b} plain />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Interactive form for a live `ask` tool call with no answer yet. Selecting and
// submitting routes the chosen text back into the session as the user's reply.
function AskForm({
  questions,
  onAnswer,
  onDismiss,
}: {
  questions: AskQuestion[];
  onAnswer: (text: string, results?: AskAnswerResult[]) => Promise<void>;
  onDismiss: () => Promise<void>;
}) {
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  function pick(q: AskQuestion, label: string) {
    setSelected((prev) => {
      const cur = prev[q.id] ?? [];
      if (q.multi) {
        const next = cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label];
        return { ...prev, [q.id]: next };
      }
      return { ...prev, [q.id]: cur.includes(label) ? [] : [label] };
    });
  }

  function answerFor(q: AskQuestion): string[] {
    const picks = selected[q.id] ?? [];
    return picks.map((p) => (p === OTHER ? (custom[q.id] ?? "").trim() : p)).filter(Boolean);
  }

  const ready = questions.every((q) => answerFor(q).length > 0);

  function compose(): string {
    if (questions.length === 1) return answerFor(questions[0]).join(", ");
    return questions.map((q) => `${q.question}: ${answerFor(q).join(", ")}`).join("\n");
  }

  // Structured per-question answers so the extension can resolve the pending
  // ask natively (selected labels vs custom input, per question id).
  function structured(): AskAnswerResult[] {
    return questions.map((q) => {
      const picks = selected[q.id] ?? [];
      const selectedOptions = picks.filter((p) => p !== OTHER);
      const customRaw = picks.includes(OTHER) ? (custom[q.id] ?? "").trim() : "";
      return customRaw
        ? { id: q.id, selectedOptions, customInput: customRaw }
        : { id: q.id, selectedOptions };
    });
  }

  async function submit() {
    if (!ready || busy) return;
    setBusy(true);
    try {
      await onAnswer(compose(), structured());
    } finally {
      setBusy(false);
    }
  }

  async function dismiss() {
    if (busy) return;
    setBusy(true);
    try {
      await onDismiss();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ask ask-live">
      <button
        type="button"
        className="ask-dismiss"
        aria-label="Dismiss"
        title="Dismiss (Esc)"
        disabled={busy}
        onClick={dismiss}
      >
        <CloseIcon />
      </button>
      {questions.map((q) => {
        const picks = selected[q.id] ?? [];
        const options = [...q.options.map((o) => o.label), OTHER];
        return (
          <div className="ask-q" key={q.id}>
            {q.header && <div className="ask-header">{q.header}</div>}
            <div className="ask-question">{q.question}</div>
            <div className="ask-options">
              {options.map((label) => {
                const opt = q.options.find((o) => o.label === label);
                const on = picks.includes(label);
                return (
                  <button
                    type="button"
                    key={label}
                    className={`ask-option${on ? " on" : ""}`}
                    onClick={() => pick(q, label)}
                  >
                    <span className="ask-mark">
                      {on ? (q.multi ? <CheckSquareIcon /> : <RadioDotIcon />) : q.multi ? <SquareIcon /> : <CircleIcon />}
                    </span>
                    <span className="ask-option-body">
                      <span className="ask-option-label">
                        {label}
                        {q.recommended !== undefined && q.options[q.recommended]?.label === label && (
                          <span className="ask-recommended"> · recommended</span>
                        )}
                      </span>
                      {opt?.description && <span className="ask-option-desc">{opt.description}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
            {picks.includes(OTHER) && (
              <input
                className="ask-custom"
                value={custom[q.id] ?? ""}
                placeholder="Type your answer…"
                onChange={(e) => setCustom((prev) => ({ ...prev, [q.id]: e.target.value }))}
                autoFocus
              />
            )}
          </div>
        );
      })}
      <button type="button" className="ask-submit" disabled={!ready || busy} onClick={submit}>
        {busy ? "Sending…" : "Answer"}
      </button>
    </div>
  );
}

// Read-only question display for asks that aren't answerable here (already
// answered, or session not controllable). The answer, if any, shows via result.
function AskStatic({ questions }: { questions: AskQuestion[] }) {
  return (
    <div className="ask">
      {questions.map((q) => (
        <div className="ask-q" key={q.id}>
          {q.header && <div className="ask-header">{q.header}</div>}
          <div className="ask-question">{q.question}</div>
          <div className="ask-options">
            {q.options.map((o) => (
              <div className="ask-option static" key={o.label}>
                <span className="ask-mark"><CircleIcon /></span>
                <span className="ask-option-body">
                  <span className="ask-option-label">{o.label}</span>
                  {o.description && <span className="ask-option-desc">{o.description}</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export interface MessageProps {
  message: WireMessage;
  results: Map<string, WireMessage>;
  controllable: boolean;
  isLast: boolean;
  onAnswer: (text: string, results?: AskAnswerResult[]) => Promise<void>;
  onDismiss: () => Promise<void>;
}

export function Message({ message, results, controllable, isLast, onAnswer, onDismiss }: MessageProps) {
  const label = ROLE_LABEL[message.role] ?? message.role;
  const cls = message.isError ? "msg error" : "msg";
  // Assistant output flows label-free (Codex-style); other roles keep a tag.
  const showLabel = message.role !== "assistant";
  return (
    <div className={cls} data-role={message.role}>
      {showLabel && (
        <div className="msg-label">
          {label}
          {message.customType && <span className="subtle small"> · {message.customType}</span>}
        </div>
      )}
      <div className="msg-body">
        {message.content.map((block, i) => {
          if (block.type !== "toolCall") return <Block key={i} block={block} />;
          const result = block.id ? results.get(block.id) : undefined;
          if (block.name === "ask") {
            const questions = asQuestions(block.arguments);
            if (questions) {
              // Answerable only on the transcript's last message: an unpaired
              // ask elsewhere is a dead branch artifact, not a live question.
              if (!result && controllable && isLast)
                return <AskForm key={i} questions={questions} onAnswer={onAnswer} onDismiss={onDismiss} />;
              if (!result) return <AskStatic key={i} questions={questions} />;
            }
          }
          return <ToolUnit key={i} call={block} result={result} />;
        })}
      </div>
    </div>
  );
}

// Groups a flat message list into renderable units: tool-result messages are
// hoisted onto their originating tool call, so each tool round-trip renders as a
// single collapsible unit instead of a wall of raw output.
export const Transcript = memo(function Transcript({
  messages,
  controllable,
  onAnswer,
  onDismiss,
}: {
  messages: WireMessage[];
  controllable: boolean;
  onAnswer: (text: string, results?: AskAnswerResult[]) => Promise<void>;
  onDismiss: () => Promise<void>;
}) {
  const { results, top } = useMemo(() => {
    const callIds = new Set<string>();
    for (const m of messages)
      for (const b of m.content) if (b.type === "toolCall" && b.id) callIds.add(b.id);
    const results = new Map<string, WireMessage>();
    for (const m of messages)
      if (m.role === "toolResult" && m.toolCallId && callIds.has(m.toolCallId))
        results.set(m.toolCallId, m);
    // Drop the standalone result messages we just hoisted onto their calls.
    const top = messages.filter(
      (m) => !(m.role === "toolResult" && m.toolCallId && callIds.has(m.toolCallId)),
    );
    return { results, top };
  }, [messages]);

  return (
    <>
      {top.map((m, i) => (
        <Message
          key={i}
          message={m}
          results={results}
          controllable={controllable}
          isLast={i === top.length - 1}
          onAnswer={onAnswer}
          onDismiss={onDismiss}
        />
      ))}
    </>
  );
});
