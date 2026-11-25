// PostDaily service worker: shows push notifications. Pushes carry no payload; on each ping we
// ask the server for the newest unread notification, identified by this device's push endpoint.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let title = "PostDaily";
      let body = "Open PostDaily to see what's new.";
      try {
        const sub = await self.registration.pushManager.getSubscription();
        if (sub) {
          const res = await fetch("/api/push/pending", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint: sub.endpoint }),
          });
          if (res.ok) ({ title, body } = await res.json());
        }
      } catch {
        /* show the generic notification */
      }
      // Browsers require a visible notification for every push.
      await self.registration.showNotification(title, {
        body,
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        tag: "postdaily",
        renotify: true,
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (existing) return existing.focus();
      return self.clients.openWindow("/");
    })(),
  );
});
