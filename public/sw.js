// Minimal service worker whose only job is showing Web Push notifications.
// Served statically from /sw.js (Next.js serves anything in public/ at the
// root) and excluded from the auth proxy, since the browser/OS can invoke it
// outside of an open, authenticated tab.

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // Not JSON -- show something rather than nothing.
  }

  const title = data.title || "Smart Charging";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icon.svg",
      badge: "/icon.svg",
    }),
  );
});

// Clicking the notification focuses an already-open tab if there is one,
// otherwise opens the dashboard.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow("/");
    }),
  );
});
