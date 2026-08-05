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
  event.waitUntil(self.registration.showNotification(title, options));
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
