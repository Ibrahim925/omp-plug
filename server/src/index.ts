// omp-plug dashboard server.
//   GET  /api/health                     -> liveness
//   GET  /api/sessions                   -> session list (all projects, newest first)
//   GET  /api/sessions/:id               -> rendered transcript
//   POST /api/sessions/:id/command       -> route a control command to a live session
//   WS   /ws/agent                       -> omp-report extension ingest + command dispatch
//   WS   /ws/client                      -> browser live event stream
//   everything else                      -> static web/dist with SPA (index.html) fallback
import { basename, dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

import type { Server, ServerWebSocket } from "bun";

import { AUTH } from "./auth.ts";
import { deleteSession, getTranscript, listSessions, renameSession } from "./history.ts";
import {
  commandSchema,
  dispatchCommand,
  handleAgentMessage,
  handleClientMessage,
  handleClose,
  handleOpen,
  isControllable,
  liveAgent,
  liveCommands,
  liveMeta,
} from "./live.ts";
import type { WsData } from "./live.ts";
import { isSpawned, SpawnError, spawnSession, stopSpawned } from "./spawn.ts";
import { addSubscription, notify, removeSubscription, subscriptionCount, vapidPublicKey } from "./push.ts";
import type { SessionListItem, TranscriptResponse } from "./types.ts";

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 7317);

const here = dirname(fileURLToPath(import.meta.url));
const DIST = join(here, "../../web/dist");
const INDEX = join(DIST, "index.html");

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

// When a shared secret is configured, every API route and the browser WS
// require it (via `x-omp-token` header, `?token=` query, or `omp_token`
// cookie). Static assets and /api/health stay open so the app can load and
// prompt for the secret. The agent WS authenticates separately via its
// register frame.
function authorized(req: Request, url: URL): boolean {
  if (!AUTH) return true;
  const header = req.headers.get("x-omp-token");
  const query = url.searchParams.get("token");
  const cookie = (req.headers.get("cookie") ?? "").match(/(?:^|;\s*)omp_token=([^;]+)/);
  const provided = header || query || (cookie ? decodeURIComponent(cookie[1]) : "");
  return provided === AUTH;
}

// Merge the file-based session list with the live registry: mark controllable
// sessions, and surface just-started sessions that have no file on disk yet.
async function sessionList(): Promise<SessionListItem[]> {
  const list = await listSessions();
  const known = new Set(list.map((s) => s.id));
  for (const item of list) {
    if (isControllable(item.id)) {
      item.controllable = true;
      item.live = true;
    }
  }
  for (const meta of liveMeta()) {
    if (known.has(meta.sessionId)) continue;
    list.unshift({
      id: meta.sessionId,
      cwd: meta.cwd ?? "",
      project: meta.cwd ? basename(meta.cwd) : "(live)",
      title: meta.title,
      created: meta.startedAt,
      modified: meta.startedAt,
      status: "live",
      messageCount: 0,
      size: 0,
      live: true,
      controllable: true,
    });
  }
  return list;
}

async function transcript(id: string): Promise<TranscriptResponse | null> {
  const found = await getTranscript(id);
  if (found) {
    found.controllable = isControllable(found.id);
    found.live = found.live || found.controllable;
    found.commands = liveCommands(found.id);
    return found;
  }
  // Live but not yet persisted (no assistant message written): serve an empty
  // shell so the live view can attach and stream.
  const meta = liveMeta().find((m) => m.sessionId === id || m.sessionId.startsWith(id));
  if (!meta) return null;
  return {
    id: meta.sessionId,
    cwd: meta.cwd ?? "",
    project: meta.cwd ? basename(meta.cwd) : "(live)",
    title: meta.title,
    status: "live",
    model: meta.model,
    live: true,
    controllable: true,
    messages: [],
    commands: meta.commands,
  };
}

async function serveStatic(pathname: string): Promise<Response> {
  // Normalize and confine to DIST to defeat path traversal.
  const rel = normalize(pathname).replace(/^(\.\.[/\\])+/, "").replace(/^\/+/, "");
  const candidate = join(DIST, rel);
  if (candidate.startsWith(DIST)) {
    const file = Bun.file(candidate);
    if (rel && (await file.exists())) return new Response(file);
  }
  const index = Bun.file(INDEX);
  if (await index.exists()) return new Response(index, { headers: { "content-type": "text/html; charset=utf-8" } });
  return new Response(
    "omp-plug: web build missing. Run `bun run build` at the repo root.",
    { status: 503, headers: { "content-type": "text/plain" } },
  );
}

function start(): Server {
  return Bun.serve<WsData, undefined>({
    hostname: HOST,
    port: PORT,
    idleTimeout: 120,
    async fetch(req, srv) {
      const url = new URL(req.url);
      const { pathname } = url;

      if (pathname === "/ws/agent") {
        return srv.upgrade(req, { data: { role: "agent" } }) ? undefined : new Response("upgrade failed", { status: 426 });
      }

      if (pathname === "/api/health") return json({ ok: true });

      const gated = pathname === "/ws/client" || pathname.startsWith("/api/");
      if (gated && !authorized(req, url)) return json({ error: "unauthorized" }, 401);

      if (pathname === "/ws/client") {
        const data: WsData = { role: "client", subs: new Set<string>() };
        return srv.upgrade(req, { data }) ? undefined : new Response("upgrade failed", { status: 426 });
      }

      // Web Push endpoints (all token-gated like the rest of /api). The browser
      // fetches the VAPID key, registers a subscription, and can fire a test
      // notification to confirm the round trip to the device works.
      if (pathname === "/api/push/key") return json({ key: vapidPublicKey() });
      if (pathname === "/api/push/subscribe" && req.method === "POST") {
        const sub = await req.json().catch(() => undefined);
        return addSubscription(sub) ? json({ ok: true }) : json({ error: "invalid subscription" }, 400);
      }
      if (pathname === "/api/push/unsubscribe" && req.method === "POST") {
        const body = (await req.json().catch(() => undefined)) as { endpoint?: unknown } | undefined;
        removeSubscription(body?.endpoint);
        return json({ ok: true });
      }
      if (pathname === "/api/push/test" && req.method === "POST") {
        await notify({ title: "omp-plug", body: "Test notification — you're all set.", url: "/" });
        return json({ ok: true, subscriptions: subscriptionCount() });
      }
      if (pathname === "/api/sessions") {
        if (req.method === "POST") {
          const body = (await req.json().catch(() => undefined)) as
            | { cwd?: unknown; title?: unknown }
            | undefined;
          const cwd = typeof body?.cwd === "string" ? body.cwd.trim() : "";
          if (!cwd) return json({ error: "cwd is required" }, 400);
          const rawTitle = typeof body?.title === "string" ? body.title.trim() : "";
          const title = rawTitle ? rawTitle.slice(0, 200) : undefined;
          try {
            const { pid } = await spawnSession({ cwd, title });
            return json({ ok: true, pid }, 201);
          } catch (err) {
            if (err instanceof SpawnError) return json({ error: err.message }, 400);
            return json({ error: (err as Error).message }, 500);
          }
        }
        try {
          return json(await sessionList());
        } catch (err) {
          return json({ error: (err as Error).message }, 500);
        }
      }

      // Remove a whole project: delete every session rooted at `cwd` from disk
      // (killing any we spawned) and let the now-empty group vanish from the
      // list. The directory itself is never touched. Live sessions we did NOT
      // launch are left running and reported as skipped.
      if (pathname === "/api/projects" && req.method === "DELETE") {
        const cwd = url.searchParams.get("cwd");
        if (!cwd) return json({ error: "cwd is required" }, 400);
        try {
          const targets = (await sessionList()).filter((s) => (s.cwd || "") === cwd);
          let removed = 0;
          let skipped = 0;
          for (const s of targets) {
            const agent = liveAgent(s.id);
            if (agent && !isSpawned(agent.pid)) {
              skipped += 1;
              continue;
            }
            if (agent) await stopSpawned(agent.pid);
            await deleteSession(s.id).catch(() => false);
            removed += 1;
          }
          return json({ ok: true, removed, skipped });
        } catch (err) {
          return json({ error: (err as Error).message }, 500);
        }
      }

      const commandMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/command$/);
      if (commandMatch && req.method === "POST") {
        const id = decodeURIComponent(commandMatch[1]);
        const parsed = commandSchema.safeParse(await req.json().catch(() => undefined));
        if (!parsed.success) return json({ error: "invalid command" }, 400);
        const target = isControllable(id)
          ? id
          : liveMeta().find((m) => m.sessionId.startsWith(id))?.sessionId;
        const ok = target ? dispatchCommand(target, parsed.data) : false;
        return ok ? json({ ok: true }) : json({ error: "session not live" }, 409);
      }

      const idMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/);
      if (idMatch) {
        const id = decodeURIComponent(idMatch[1]);

        if (req.method === "DELETE") {
          try {
            const agent = liveAgent(id);
            if (agent) {
              // Only terminate sessions this server launched; never kill a
              // user's own terminal session out from under them.
              if (!isSpawned(agent.pid)) {
                return json({ error: "session is live; stop it before deleting" }, 409);
              }
              await stopSpawned(agent.pid);
            }
            const removed = await deleteSession(id);
            if (!removed && !agent) return json({ error: "session not found" }, 404);
            return json({ ok: true });
          } catch (err) {
            return json({ error: (err as Error).message }, 500);
          }
        }

        if (req.method === "PATCH") {
          const body = (await req.json().catch(() => undefined)) as { title?: unknown } | undefined;
          const title = typeof body?.title === "string" ? body.title.trim().slice(0, 200) : "";
          if (!title) return json({ error: "title is required" }, 400);
          try {
            const agent = liveAgent(id);
            // Live: rename through the running instance (race-free); persisted:
            // rewrite the header directly.
            if (agent) {
              dispatchCommand(agent.sessionId, { type: "rename", text: title });
              return json({ ok: true });
            }
            const ok = await renameSession(id, title);
            return ok ? json({ ok: true }) : json({ error: "session not found" }, 404);
          } catch (err) {
            return json({ error: (err as Error).message }, 500);
          }
        }

        try {
          const result = await transcript(id);
          return result ? json(result) : json({ error: "session not found" }, 404);
        } catch (err) {
          return json({ error: (err as Error).message }, 500);
        }
      }

      if (pathname.startsWith("/api/")) return json({ error: "not found" }, 404);

      return serveStatic(pathname);
    },
    websocket: {
      open(ws: ServerWebSocket<WsData>) {
        handleOpen(ws);
      },
      message(ws: ServerWebSocket<WsData>, message) {
        if (ws.data.role === "agent") handleAgentMessage(ws, message);
        else handleClientMessage(ws, message);
      },
      close(ws: ServerWebSocket<WsData>) {
        handleClose(ws);
      },
    },
  });
}

let server: Server;
try {
  server = start();
} catch (err) {
  const message = (err as Error).message;
  if (/EADDRINUSE|in use|already/i.test(message)) {
    console.error(
      `Port ${PORT} is already in use.\n` +
        `Another omp-plug (or process) is listening. Either stop it:\n` +
        `  lsof -nP -iTCP:${PORT} -sTCP:LISTEN\n` +
        `or run on a different port:\n` +
        `  PORT=7318 bun run start`,
    );
    process.exit(1);
  }
  throw err;
}

console.log(`omp-plug dashboard on http://${server.hostname}:${server.port}`);
if (AUTH) console.log("auth: token required (env or ~/.omp-plug.json)");
else console.log("auth: OPEN (set OMP_PLUG_TOKEN or a token in ~/.omp-plug.json to require a shared secret)");
