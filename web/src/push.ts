// Browser side of Web Push: register the service worker, obtain a push
// subscription against the server's VAPID key, and hand it to the server.
//
// Push only works in a secure context (HTTPS or localhost). Over plain-HTTP
// Tailscale it is unavailable — surfaced to the UI as the "insecure" state so
// the toggle can explain why.
import { deletePushSubscription, fetchVapidKey, savePushSubscription, sendTestPush } from "./api.ts";

export type PushState = "unsupported" | "insecure" | "denied" | "off" | "on";

const SW_URL = "/sw.js";

export function pushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export async function currentPushState(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  if (!window.isSecureContext) return "insecure";
  if (Notification.permission === "denied") return "denied";
  try {
    const reg = await navigator.serviceWorker.getRegistration(SW_URL);
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    return sub ? "on" : "off";
  } catch {
    return "off";
  }
}

// VAPID keys travel as URL-safe base64; PushManager wants the raw bytes.
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

// Turn on notifications: prompts for permission, subscribes, persists the
// subscription server-side, and fires one test push so the user immediately
// sees it land on the device.
export async function enablePush(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  if (!window.isSecureContext) return "insecure";

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";

  const reg = await navigator.serviceWorker.register(SW_URL);
  await navigator.serviceWorker.ready;

  const { key } = await fetchVapidKey();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    });
  }
  await savePushSubscription(sub.toJSON());
  await sendTestPush().catch(() => undefined);
  return "on";
}

export async function disablePush(): Promise<PushState> {
  try {
    const reg = await navigator.serviceWorker.getRegistration(SW_URL);
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (sub) {
      await deletePushSubscription(sub.endpoint).catch(() => undefined);
      await sub.unsubscribe();
    }
  } catch {
    // best-effort teardown — the UI just returns to "off".
  }
  return "off";
}
