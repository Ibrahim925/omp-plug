import { useEffect, useRef, useState } from "react";

import { createSession, fetchDirs } from "../api.ts";
import type { DirListing } from "../types.ts";
import { ChevronLeftIcon, FolderIcon } from "./icons.tsx";

export function NewSessionForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (sessionId?: string) => void;
}) {
  const [cwd, setCwd] = useState("");
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Directory browser state (populated as the operator types / drills in).
  const [dirOpen, setDirOpen] = useState(false);
  const [listing, setListing] = useState<DirListing | null>(null);
  const [dirErr, setDirErr] = useState<string | null>(null);
  const dirBlur = useRef<number | undefined>(undefined);

  // Debounced directory fetch: only while the cwd field is focused, so the
  // panel tracks what's typed without a request per keystroke.
  useEffect(() => {
    if (!dirOpen) return;
    const t = setTimeout(async () => {
      try {
        setListing(await fetchDirs(cwd || undefined));
        setDirErr(null);
      } catch (e) {
        setListing(null);
        setDirErr((e as Error).message);
      }
    }, 160);
    return () => clearTimeout(t);
  }, [cwd, dirOpen]);

  // Drill into a directory: a trailing slash makes the next fetch list *inside*
  // it. Keep the field focused so the panel stays open through the drill.
  function pickDir(path: string) {
    setCwd(path.endsWith("/") ? path : `${path}/`);
    setDirOpen(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const dir = cwd.trim().replace(/\/+$/, "") || cwd.trim();
    if (!dir || creating) return;
    setCreating(true);
    setErr(null);
    try {
      const { sessionId } = await createSession(dir, title.trim() || undefined);
      onCreated(sessionId);
    } catch (e2) {
      setErr((e2 as Error).message);
      setCreating(false);
    }
  }

  return (
    <form className="new-form" onSubmit={submit}>
      {/* ---- directory (cwd) fuzzy picker ---- */}
      <div className="picker">
        <input
          className="new-input"
          placeholder="Project directory (type to search)"
          value={cwd}
          autoFocus
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => setCwd(e.target.value)}
          onFocus={() => {
            if (dirBlur.current) window.clearTimeout(dirBlur.current);
            setDirOpen(true);
          }}
          onBlur={() => {
            // Delay so a tap on an entry registers before the panel closes.
            dirBlur.current = window.setTimeout(() => setDirOpen(false), 160);
          }}
          onKeyDown={(e) => {
            // Enter here means "drill into the top match", never submit.
            if (e.key === "Enter") {
              e.preventDefault();
              if (listing?.entries[0]) pickDir(listing.entries[0].path);
            }
          }}
        />
        {dirOpen && (
          <div className="picker-panel" onMouseDown={(e) => e.preventDefault()}>
            <div className="picker-ctx">
              {listing?.parent != null && (
                <button
                  type="button"
                  className="dir-up"
                  title="Parent directory"
                  onClick={() => pickDir(listing.parent as string)}
                >
                  <ChevronLeftIcon />
                </button>
              )}
              <span className="picker-base" title={listing?.base}>
                {listing?.base ?? "…"}
              </span>
            </div>
            {dirErr ? (
              <div className="picker-empty">{dirErr}</div>
            ) : listing && listing.entries.length === 0 ? (
              <div className="picker-empty">No subdirectories</div>
            ) : (
              <ul className="picker-list">
                {listing?.entries.map((d) => (
                  <li key={d.path}>
                    <button type="button" className="dir-row" onClick={() => pickDir(d.path)}>
                      <FolderIcon className="dir-ico" />
                      <span className="dir-name">{d.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <input
        className="new-input"
        placeholder="Title (optional)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />

      {err && <div className="new-err">{err}</div>}
      <div className="new-actions">
        <button type="button" className="composer-btn" onClick={onClose}>
          Cancel
        </button>
        <button className="composer-btn send" type="submit" disabled={!cwd.trim() || creating}>
          {creating ? "Starting…" : "Start session"}
        </button>
      </div>
    </form>
  );
}
