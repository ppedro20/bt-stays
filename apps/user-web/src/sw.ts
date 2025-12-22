/// <reference lib="webworker" />
import { clientsClaim } from "workbox-core";
import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { NetworkFirst, NetworkOnly, StaleWhileRevalidate } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { BackgroundSyncPlugin } from "workbox-background-sync";

declare const self: ServiceWorkerGlobalScope;

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

clientsClaim();
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

const offlineFallback = "/offline.html";
const navigationHandler = new NetworkFirst({
  cacheName: "html-cache",
  networkTimeoutSeconds: 3,
});

registerRoute(({ request }) => request.mode === "navigate", async ({ event }) => {
  try {
    const fetchEvent = event as FetchEvent;
    const response = await navigationHandler.handle({ event: fetchEvent, request: fetchEvent.request });
    if (response) return response;
  } catch {
    // ignore
  }
  const cached = await caches.match(offlineFallback, { ignoreSearch: true });
  return cached ?? Response.error();
});

registerRoute(
  ({ request }) => request.destination === "image",
  new StaleWhileRevalidate({
    cacheName: "runtime-images",
    plugins: [new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 7 })],
  }),
);

registerRoute(
  ({ request }) => request.destination === "font",
  new StaleWhileRevalidate({
    cacheName: "runtime-fonts",
    plugins: [new ExpirationPlugin({ maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 30 })],
  }),
);

const analyticsSync = new BackgroundSyncPlugin("pwa-analytics-queue", {
  maxRetentionTime: 24 * 60,
});

const pushSync = new BackgroundSyncPlugin("pwa-push-queue", {
  maxRetentionTime: 24 * 60,
});

registerRoute(
  ({ url, request }) => request.method === "POST" && url.pathname.endsWith("/functions/v1/pwa_event"),
  new NetworkOnly({ plugins: [analyticsSync] }),
  "POST",
);

registerRoute(
  ({ url, request }) =>
    request.method === "POST" &&
    (url.pathname.endsWith("/functions/v1/push_subscribe") || url.pathname.endsWith("/functions/v1/push_unsubscribe")),
  new NetworkOnly({ plugins: [pushSync] }),
  "POST",
);

registerRoute(
  ({ url }) => url.pathname.includes("/functions/v1/"),
  new NetworkOnly(),
);

type NotificationOptionsWithRenotify = NotificationOptions & { renotify?: boolean };

self.addEventListener("push", (event) => {
  const payload = event.data ? event.data.json() : {};
  const title = payload.title ?? "bt-stays";
  const options: NotificationOptionsWithRenotify = {
    body: payload.body ?? "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-72.png",
    data: payload.data ?? {},
    tag: payload.tag ?? "bt-stays",
    renotify: Boolean(payload.renotify),
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.focus();
          client.navigate(url);
          return;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    }),
  );
});
