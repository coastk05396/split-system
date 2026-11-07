/* global self, URL */
self.addEventListener("push", (event) => {
  if (!event.data) return;
  const payload = event.data.json();
  const url = new URL(payload.url, self.location.origin);
  if (url.origin !== self.location.origin || url.pathname !== "/travel") return;
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      data: { url: url.href },
      tag: `flight-${url.search}`,
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data.url, self.location.origin);
  if (url.origin !== self.location.origin || url.pathname !== "/travel") return;
  event.waitUntil(self.clients.openWindow(url.href));
});
