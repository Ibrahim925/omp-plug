import { useState } from "react";

import { setToken } from "../token.ts";

export function TokenGate() {
  const [value, setValue] = useState("");

  function submit() {
    const secret = value.trim();
    if (!secret) return;
    setToken(secret);
    window.location.reload();
  }

  return (
    <div className="gate">
      <div className="gate-card">
        <h1>omp</h1>
        <p className="subtle">This dashboard is protected. Enter the shared secret.</p>
        <input
          type="password"
          value={value}
          placeholder="secret"
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
        <button className="composer-btn send" onClick={submit} disabled={!value.trim()}>
          Unlock
        </button>
      </div>
    </div>
  );
}
