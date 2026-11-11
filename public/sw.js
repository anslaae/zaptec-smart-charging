// Minimal service worker whose only job is showing Web Push notifications.
// Served statically from /sw.js (Next.js serves anything in public/ at the
// root) and excluded from the auth proxy, since the browser/OS can invoke it
// outside of an open, authenticated tab. Payload shape: PushPayload in
// src/lib/push/send.ts (design/redesign/notifications.nb.json).

const DEFAULT_ICON = "/icons/icon-192.png";
const DEFAULT_BADGE = "/icons/badge-96.png";

// Only same-origin paths are ever opened or loaded. Parsing with URL (rather
// than a startsWith check) also catches "/\evil.example" and tab tricks,
// which the URL parser would otherwise resolve to another host.
function sameOriginPath(url, fallback) {
  if (typeof url !== "string" || url === "") return fallback;
  try {
    const parsed = new URL(url, self.location.origin);
    return parsed.origin === self.location.origin ? parsed.pathname + parsed.search + parsed.hash : fallback;
  } catch {
    return fallback;
  }
}

// Take control of already-open app windows right away, so notification clicks
// can navigate them (navigate() only works on clients this worker controls).
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // Not JSON -- show something rather than nothing.
  }

  const rawActions = Array.isArray(data.actions) ? data.actions : [];
  const actions = rawActions
    .filter((a) => a && typeof a.action === "string" && typeof a.title === "string")
    .map((a) => ({ action: a.action, title: a.title }));
  const actionUrls = Object.fromEntries(
    rawActions.filter((a) => a && typeof a.action === "string").map((a) => [a.action, sameOriginPath(a.url, "/")]),
  );

  const options = {
    body: data.body || "",
    icon: sameOriginPath(data.icon, DEFAULT_ICON),
    badge: sameOriginPath(data.badge, DEFAULT_BADGE),
    lang: "nb",
    data: { url: sameOriginPath(data.url, "/"), actionUrls },
    actions,
  };
  // renotify is only allowed together with a tag: a newer notification for
  // the same plan/charger quietly replaces the older one.
  if (typeof data.tag === "string" && data.tag) {
    options.tag = data.tag;
    options.renotify = false;
  }

  event.waitUntil(self.registration.showNotification(data.title || "Lading", options));
});

// Tapping opens the action's URL (or the notification's own URL), reusing an
// already-open app window when there is one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const url = (event.action && data.actionUrls && data.actionUrls[event.action]) || data.url || "/";

  event.waitUntil(
    (async () => {
      const windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = windows.find((client) => "focus" in client);
      if (existing) {
        try {
          await existing.focus();
          // Throws for a window this worker doesn't control (opened before it
          // was installed); fall back to opening the URL instead.
          if ("navigate" in existing) return await existing.navigate(url);
          return existing;
        } catch {
          // fall through
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })(),
  );
});
