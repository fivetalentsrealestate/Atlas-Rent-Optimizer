/* Atlas Rent Optimizer — service worker
   Cache-first for the app shell so the calculator works with no connection at all.
   Bump CACHE_VERSION whenever you change any cached file. */

var CACHE_VERSION = "aro-v1";
var SHELL = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-192.png",
  "./icons/maskable-512.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE_VERSION).then(function (c) {
      /* Fonts are added opportunistically at runtime; if any shell file 404s we
         still want the install to succeed, so each is added individually. */
      return Promise.all(SHELL.map(function (u) {
        return c.add(new Request(u, { cache: "reload" })).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE_VERSION ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;

  var url = new URL(req.url);
  var sameOrigin = url.origin === self.location.origin;
  var isFont = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (!sameOrigin && !isFont) return;

  /* Navigations: try network first so a redeploy is picked up, fall back to
     the cached shell when offline. */
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE_VERSION).then(function (c) { c.put("./index.html", copy); });
        return res;
      }).catch(function () {
        return caches.match("./index.html").then(function (m) {
          return m || new Response("Offline and nothing cached yet.", {
            status: 503, headers: { "Content-Type": "text/plain" }
          });
        });
      })
    );
    return;
  }

  /* Everything else: cache first, then network, caching what comes back. */
  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && (res.status === 200 || res.type === "opaque")) {
          var copy = res.clone();
          caches.open(CACHE_VERSION).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return hit; });
    })
  );
});

/* Notifications scheduled by the page are delivered here so they still fire
   when the app is backgrounded but the worker is alive. */
self.addEventListener("message", function (e) {
  var d = e.data || {};
  if (d.type !== "notify") return;
  self.registration.showNotification(d.title || "Atlas Rent Optimizer", {
    body: d.body || "",
    icon: "./icons/icon-192.png",
    badge: "./icons/icon-192.png",
    tag: d.tag || "aro",
    renotify: true,
    requireInteraction: false
  });
});

self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if ("focus" in list[i]) return list[i].focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("./");
    })
  );
});
