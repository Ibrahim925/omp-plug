// Smoke test: proves the server actually boots and serves its open liveness
// endpoint. `/api/health` needs neither the omp SDK nor an auth token, so this
// exercises the real HTTP entry point (Bun.serve + routing) end to end without
// any external dependency — the point is to prove the test framework and the
// server's startup path are wired, not to cover behavior.
import { afterAll, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Subprocess } from "bun";

const entry = join(dirname(fileURLToPath(import.meta.url)), "../src/index.ts");
const PORT = 7400 + Math.floor(Math.random() * 500);

let proc: Subprocess | undefined;

afterAll(() => {
  proc?.kill();
});

test("server boots and /api/health returns ok", async () => {
  proc = Bun.spawn(["bun", entry], {
    env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1" },
    stdout: "ignore",
    stderr: "ignore",
  });

  const url = `http://127.0.0.1:${PORT}/api/health`;
  // Real timers are unavoidable here: the server is a separate OS process and
  // readiness is a real TCP bind observed over the network — there is no
  // in-process promise or timer to fake. Poll the socket with a bounded deadline.
  const deadline = Date.now() + 15_000;
  let body: unknown;
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        body = await res.json();
        break;
      }
    } catch {
      // server not listening yet — retry until the deadline
    }
    if (Date.now() > deadline) throw new Error("server did not answer /api/health within 15s");
    await Bun.sleep(200);
  }
  expect(body).toEqual({ ok: true });
});
