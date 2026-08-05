import { useCallback, useEffect, useMemo, useState } from "react";

import { createSession, deleteProject, deleteSession, fetchSessions } from "../api.ts";
import { humanBytes, relTime } from "../format.ts";
import { navigate } from "../router.ts";
import { currentPushState, disablePush, enablePush, type PushState } from "../push.ts";
import type { SessionListItem } from "../types.ts";

const POLL_MS = 15_000;

interface Group {
  cwd: string;
  project: string;
  items: SessionListItem[];
  newest: number;
  live: number;
}

// Bell glyph + tooltip for each push state. Disabled states explain the reason
// (notably `insecure`: push needs HTTPS, which over Tailscale means `serve`).
const PUSH_UI: Record<PushState, { icon: string; title: string; disabled: boolean }> = {
  on: { icon: "🔔", title: "Phone notifications on — tap to turn off", disabled: false },
  off: { icon: "🔕", title: "Turn on phone notifications", disabled: false },
  denied: { icon: "🔕", title: "Notifications blocked — allow them in your browser settings", disabled: true },
  insecure: { icon: "🔕", title: "Push needs HTTPS — serve the dashboard over `tailscale serve`", disabled: true },
  unsupported: { icon: "🔕", title: "This browser can't do push notifications", disabled: true },
};

export function SessionList() {
  const [sessions, setSessions] = useState<SessionListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const [showNew, setShowNew] = useState(false);
  const [newCwd, setNewCwd] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);

  const [pushState, setPushState] = useState<PushState>("off");
  const [pushBusy, setPushBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchSessions();
      setSessions(data);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    let live = true;
    currentPushState().then((s) => live && setPushState(s));
    return () => {
      live = false;
    };
  }, []);

  async function togglePush() {
    if (pushBusy) return;
    setPushBusy(true);
    try {
      setPushState(pushState === "on" ? await disablePush() : await enablePush());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPushBusy(false);
    }
  }

  const groups = useMemo<Group[] | null>(() => {
    if (!sessions) return null;
    const map = new Map<string, Group>();
    for (const s of sessions) {
      const key = s.cwd || "(unknown)";
      let g = map.get(key);
      if (!g) {
        g = { cwd: key, project: s.project, items: [], newest: 0, live: 0 };
        map.set(key, g);
      }
      g.items.push(s);
      const t = Date.parse(s.modified ?? "") || 0;
      if (t > g.newest) g.newest = t;
      if (s.controllable) g.live += 1;
    }
    // Newest-active project first; items already arrive newest-first.
    return [...map.values()].sort((a, b) => b.newest - a.newest);
  }, [sessions]);

  const knownDirs = useMemo(() => {
    const set = new Set<string>();
    for (const s of sessions ?? []) if (s.cwd) set.add(s.cwd);
    return [...set];
  }, [sessions]);

  const liveCount = sessions?.filter((s) => s.controllable).length ?? 0;

  function toggle(cwd: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(cwd)) next.delete(cwd);
      else next.add(cwd);
      return next;
    });
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const cwd = newCwd.trim();
    if (!cwd || creating) return;
    setCreating(true);
    setCreateErr(null);
    try {
      const { sessionId } = await createSession(cwd, newTitle.trim() || undefined);
      setShowNew(false);
      setNewCwd("");
      setNewTitle("");
      // Auto-open the new session's page once we know its id; otherwise fall
      // back to a burst-refresh so it surfaces in the list on registration.
      if (sessionId) {
        navigate(`/s/${encodeURIComponent(sessionId)}`);
        return;
      }
      load();
      for (const delay of [1200, 2600, 4200]) setTimeout(load, delay);
    } catch (err) {
      setCreateErr((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function remove(s: SessionListItem) {
    const label = s.title || "untitled session";
    if (!window.confirm(`Delete "${label}"? This permanently removes it from disk.`)) return;
    try {
      await deleteSession(s.id);
      setSessions((prev) => prev?.filter((x) => x.id !== s.id) ?? prev);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function addToProject(cwd: string) {
    // Expand the group so the new session is visible once it registers.
    setCollapsed((prev) => {
      if (!prev.has(cwd)) return prev;
      const next = new Set(prev);
      next.delete(cwd);
      return next;
    });
    try {
      const { sessionId } = await createSession(cwd);
      if (sessionId) {
        navigate(`/s/${encodeURIComponent(sessionId)}`);
        return;
      }
      load();
      for (const delay of [1200, 2600, 4200]) setTimeout(load, delay);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function removeProject(g: Group) {
    const msg =
      `Remove project "${g.project}"? This permanently deletes its ${g.items.length} ` +
      `session${g.items.length === 1 ? "" : "s"} from disk. The directory itself is not touched.`;
    if (!window.confirm(msg)) return;
    try {
      const res = await deleteProject(g.cwd);
      await load();
      if (res.skipped > 0) {
        setError(`${res.skipped} live session${res.skipped === 1 ? "" : "s"} left running — stop them to remove.`);
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="page">
      <header className="topbar">
        <h1>omp</h1>
        <span className="subtle">
          {sessions ? `${sessions.length} sessions` : "\u00a0"}
          {liveCount > 0 && <span className="live-count"> · {liveCount} live</span>}
        </span>
        <div className="topbar-actions">
          <button
            className={`new-btn${pushState === "on" ? " on" : ""}`}
            onClick={togglePush}
            disabled={pushBusy || PUSH_UI[pushState].disabled}
            title={PUSH_UI[pushState].title}
            aria-label="Toggle phone notifications"
          >
            {PUSH_UI[pushState].icon}
          </button>
          <button className="new-btn" onClick={() => setShowNew((v) => !v)} aria-label="New session">
            {showNew ? "×" : "+"}
          </button>
        </div>
      </header>

      {showNew && (
        <form className="new-form" onSubmit={create}>
          <input
            className="new-input"
            placeholder="Project directory (absolute path)"
            list="omp-dirs"
            value={newCwd}
            onChange={(e) => setNewCwd(e.target.value)}
            autoFocus
          />
          <datalist id="omp-dirs">
            {knownDirs.map((d) => (
              <option value={d} key={d} />
            ))}
          </datalist>
          <input
            className="new-input"
            placeholder="Title (optional)"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
          />
          {createErr && <div className="new-err">{createErr}</div>}
          <button className="composer-btn send" type="submit" disabled={!newCwd.trim() || creating}>
            {creating ? "Starting…" : "Start session"}
          </button>
        </form>
      )}

      {error && <div className="banner error">Could not load sessions — {error}</div>}

      <div className="groups">
        {groups?.map((g) => {
          const open = !collapsed.has(g.cwd);
          return (
            <section className="group" key={g.cwd}>
              <div
                className="group-head"
                role="button"
                tabIndex={0}
                onClick={() => toggle(g.cwd)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggle(g.cwd);
                  }
                }}
              >
                <span className={`caret-icon${open ? " open" : ""}`}>›</span>
                <span className="group-title" title={g.cwd}>
                  {g.project}
                </span>
                <span className="group-meta">
                  {g.live > 0 && <span className="chip live">{g.live} live</span>}
                  <span className="subtle small">{g.items.length}</span>
                </span>
                <span className="group-actions">
                  <button
                    className="grp-btn"
                    aria-label={`New session in ${g.project}`}
                    title="New session here"
                    onClick={(e) => {
                      e.stopPropagation();
                      addToProject(g.cwd);
                    }}
                  >
                    +
                  </button>
                  <button
                    className="grp-btn danger"
                    aria-label={`Remove project ${g.project}`}
                    title="Remove project (deletes its sessions, not the directory)"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeProject(g);
                    }}
                  >
                    🗑
                  </button>
                </span>
              </div>
              {open && (
                <ul className="list">
                  {g.items.map((s) => (
                    <li key={s.id}>
                      <div
                        className="row"
                        role="button"
                        tabIndex={0}
                        onClick={() => navigate(`/s/${encodeURIComponent(s.id)}`)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            navigate(`/s/${encodeURIComponent(s.id)}`);
                          }
                        }}
                      >
                        <div className="row-main">
                          <span className="row-title">{s.title || "(untitled session)"}</span>
                          <div className="row-meta">
                            {s.controllable ? (
                              <span className="chip live">live</span>
                            ) : s.live ? (
                              <span className="chip muted">active</span>
                            ) : (
                              s.status && <span className="chip muted">{s.status}</span>
                            )}
                          </div>
                        </div>
                        <div className="row-side">
                          <span className="subtle">{relTime(s.modified)}</span>
                          <span className="subtle small">{humanBytes(s.size)}</span>
                        </div>
                        <button
                          className="row-del"
                          aria-label="Delete session"
                          title={s.controllable ? "Stop then delete" : "Delete session"}
                          onClick={(e) => {
                            e.stopPropagation();
                            remove(s);
                          }}
                        >
                          🗑
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      {!sessions && !error && (
        <div className="list">
          {Array.from({ length: 7 }).map((_, i) => (
            <div className="skel-row" key={i}>
              <div className="skeleton skel-line" style={{ width: `${72 - i * 4}%` }} />
              <div className="skeleton skel-line" style={{ width: "34%", height: 10 }} />
            </div>
          ))}
        </div>
      )}

      {sessions?.length === 0 && <div className="empty">No sessions yet — tap + to start one.</div>}
    </div>
  );
}
