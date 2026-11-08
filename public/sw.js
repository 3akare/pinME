/* PinMe service worker: makes the app installable and turns empty wake-up pushes into a notice.
 * Pushes carry no content; the messages themselves arrive encrypted over the socket once the
 * app opens. One copy runs at "/" and one per PIN at "/push/<PIN>/" (separate push endpoints). */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  event.waitUntil(
    self.registration.showNotification("PinMe", {
      body: "You have a new message or request.",
      tag: "pinme-wake",
      renotify: true,
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) return open.focus();
      return self.clients.openWindow("/");
    })(),
  );
});
