// JobRadar service worker: makes the app installable and receives push notifications.
self.addEventListener("install", (e) => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data.json(); } catch (e) { data = { title: "JobRadar", body: event.data && event.data.text() }; }
  const title = data.title || "JobRadar";
  const options = {
    body: data.body || "Today's sweep is done.",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: { url: data.url || "/" }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ("focus" in c) return c.focus(); }
      return self.clients.openWindow(event.notification.data?.url || "/");
    })
  );
});
