// omp-plug service worker: renders Web Push notifications and routes taps back
// into the dashboard. Payload shape (from server/src/push.ts):
//   { title, body, url?, tag? }
/* global self, clients */

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "omp-plug";
  const options = {
    body: data.body || "",
    tag: data.tag || undefined,
    // Re-alert when a tagged notification is replaced (e.g. idle -> new turn).
    renotify: !!data.tag,
    data: { url: data.url || "/" },
  };
  event.waitUntil(
    (async () => {
      // Stay silent while the user is actively looking at the dashboard. A
      // focused, visible same-origin window is the sanctioned exemption from
      // userVisibleOnly, so skipping showNotification here is spec-legal.
      const windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
      const focused = windows.some((c) => c.focused && c.visibilityState === "visible");
      if (focused) return;
      return self.registration.showNotification(title, options);
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async () => {
      const windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if ("focus" in client) {
          try {
            await client.navigate(target);
          } catch (_) {
            // cross-origin or navigation blocked — just focus what we have.
          }
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(target);
      return undefined;
    })(),
  );
});
