import { useEffect, useState } from "react";

import { fetchSessions } from "../api.ts";
import { humanBytes, relTime } from "../format.ts";
import { navigate } from "../router.ts";
import type { SessionListItem } from "../types.ts";

const POLL_MS = 15_000;

export function SessionList() {
  const [sessions, setSessions] = useState<SessionListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const data = await fetchSessions();
        if (alive) {
          setSessions(data);
          setError(null);
        }
      } catch (err) {
        if (alive) setError((err as Error).message);
      }
    }
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const liveCount = sessions?.filter((s) => s.controllable).length ?? 0;

  return (
    <div className="page">
      <header className="topbar">
        <h1>omp</h1>
        <span className="subtle">
          {sessions ? `${sessions.length} sessions` : "\u00a0"}
          {liveCount > 0 && <span className="live-count"> · {liveCount} live</span>}
        </span>
      </header>

      {error && <div className="banner error">Could not load sessions — {error}</div>}

      <ul className="list">
        {sessions?.map((s) => (
          <li key={s.id}>
            <button className="row" onClick={() => navigate(`/s/${encodeURIComponent(s.id)}`)}>
              <div className="row-main">
                <span className="row-title">{s.title || "(untitled session)"}</span>
                <div className="row-meta">
                  <span className="chip">{s.project}</span>
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
            </button>
          </li>
        ))}
      </ul>

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

      {sessions?.length === 0 && <div className="empty">No sessions found.</div>}
    </div>
  );
}
