// Web Push (RFC 8291 / VAPID) delivery for omp-plug.
//
// Persists the server's VAPID keypair and every browser push subscription to
// ~/.omp-plug-push.json, and fans notifications out to all subscribed devices.
// Strictly fail-soft: a send failure never propagates to the caller — a dead
// endpoint (404/410) is pruned, anything else is logged and swallowed, so a
// notification attempt can never break the turn that triggered it.
//
// Note: browsers only accept a push subscription in a *secure context*, so the
// dashboard must be served over HTTPS (e.g. `tailscale serve`) for a phone to
// register. The server side here is transport-agnostic.
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import webpush from "web-push";

const FILE = join(homedir(), ".omp-plug-push.json");
// VAPID requires a contact subject (mailto: or https URL). Overridable so a
// real deployment can point it at a monitored address.
const SUBJECT = process.env.OMP_PLUG_PUSH_SUBJECT || "mailto:omp-plug@localhost";

export interface PushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  expirationTime?: number | null;
}

interface Store {
  vapid: { publicKey: string; privateKey: string };
  subject: string;
  subscriptions: PushSubscription[];
}

function persist(s: Store): void {
  try {
    writeFileSync(FILE, JSON.stringify(s, null, 2), { mode: 0o600 });
  } catch (err) {
    console.error("omp-plug push: could not persist", FILE, (err as Error).message);
  }
}

// Load persisted state, or generate a fresh VAPID keypair on first run. The
// keypair MUST be stable across restarts — regenerating it invalidates every
// existing subscription — so it is written back immediately when created.
function load(): Store {
  try {
    const raw = JSON.parse(readFileSync(FILE, "utf8")) as Partial<Store>;
    if (raw.vapid?.publicKey && raw.vapid?.privateKey) {
      return {
        vapid: raw.vapid,
        subject: raw.subject || SUBJECT,
        subscriptions: Array.isArray(raw.subscriptions) ? raw.subscriptions : [],
      };
    }
  } catch {
    // no file / unreadable / missing keys — fall through and generate.
  }
  const fresh: Store = { vapid: webpush.generateVAPIDKeys(), subject: SUBJECT, subscriptions: [] };
  persist(fresh);
  return fresh;
}

const store = load();
webpush.setVapidDetails(store.subject, store.vapid.publicKey, store.vapid.privateKey);

/** The VAPID public key the browser needs to create a subscription. */
export function vapidPublicKey(): string {
  return store.vapid.publicKey;
}

export function subscriptionCount(): number {
  return store.subscriptions.length;
}

function valid(sub: unknown): sub is PushSubscription {
  if (!sub || typeof sub !== "object") return false;
  const s = sub as PushSubscription;
  return (
    typeof s.endpoint === "string" &&
    !!s.keys &&
    typeof s.keys.p256dh === "string" &&
    typeof s.keys.auth === "string"
  );
}

/** Add (or refresh, keyed by endpoint) a device subscription. */
export function addSubscription(sub: unknown): boolean {
  if (!valid(sub)) return false;
  const at = store.subscriptions.findIndex((s) => s.endpoint === sub.endpoint);
  if (at >= 0) store.subscriptions[at] = sub;
  else store.subscriptions.push(sub);
  persist(store);
  return true;
}

export function removeSubscription(endpoint: unknown): boolean {
  if (typeof endpoint !== "string") return false;
  const before = store.subscriptions.length;
  store.subscriptions = store.subscriptions.filter((s) => s.endpoint !== endpoint);
  if (store.subscriptions.length === before) return false;
  persist(store);
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  /** In-app path to open when the notification is tapped (e.g. `/s/<id>`). */
  url?: string;
  /** Collapse key: a later notification with the same tag replaces the prior. */
  tag?: string;
}

// Fan out to every subscription in parallel. Expired endpoints are pruned;
// every other error is swallowed. Never awaited on the hot path — callers
// fire-and-forget.
export async function notify(payload: PushPayload): Promise<void> {
  if (store.subscriptions.length === 0) return;
  const body = JSON.stringify(payload);
  const dead: string[] = [];
  await Promise.all(
    store.subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, body, { TTL: 600 });
      } catch (err) {
        const code =
          err && typeof err === "object" && "statusCode" in err && typeof err.statusCode === "number"
            ? err.statusCode
            : undefined;
        if (code === 404 || code === 410) dead.push(sub.endpoint);
        else console.error("omp-plug push: send failed", code ?? String(err));
      }
    }),
  );
  if (dead.length) {
    store.subscriptions = store.subscriptions.filter((s) => !dead.includes(s.endpoint));
    persist(store);
  }
}
