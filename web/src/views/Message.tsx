import type { WireBlock, WireMessage } from "../types.ts";

const ROLE_LABEL: Record<string, string> = {
  user: "You",
  assistant: "Assistant",
  toolResult: "Tool result",
  developer: "System",
  bashExecution: "Shell",
  custom: "Note",
};

function Block({ block }: { block: WireBlock }) {
  switch (block.type) {
    case "text":
      return <div className="text">{block.text}</div>;
    case "thinking":
      return (
        <details className="thinking">
          <summary>thinking</summary>
          <div className="text">{block.text}</div>
        </details>
      );
    case "toolCall": {
      const args = "arguments" in block ? block.arguments : undefined;
      const hasArgs = args !== undefined && args !== null;
      return (
        <div className="toolcall">
          <div className="toolcall-head">
            <span className="tool-name">{block.name ?? "tool"}</span>
            {block.intent && <span className="tool-intent">{block.intent}</span>}
          </div>
          {hasArgs && (
            <details className="tool-args">
              <summary>args</summary>
              <pre>{JSON.stringify(args, null, 2)}</pre>
            </details>
          )}
        </div>
      );
    }
    case "image": {
      const src = block.data
        ? `data:${block.mimeType ?? "image/png"};base64,${block.data}`
        : block.url;
      return src ? <img className="image" src={src} alt="attachment" loading="lazy" /> : null;
    }
    default:
      return <pre className="raw">{block.text ?? ""}</pre>;
  }
}

export function Message({ message }: { message: WireMessage }) {
  const label = ROLE_LABEL[message.role] ?? message.role;
  const cls = message.isError ? "msg error" : "msg";
  return (
    <div className={cls} data-role={message.role}>
      <div className="msg-label">
        {label}
        {message.customType && <span className="subtle small"> · {message.customType}</span>}
      </div>
      <div className="msg-body">
        {message.content.map((block, i) => (
          <Block key={i} block={block} />
        ))}
      </div>
    </div>
  );
}
