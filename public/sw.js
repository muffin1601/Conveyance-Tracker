// Watcon Tracker service worker — app-shell caching + offline fallback.
const CACHE = "watcon-v1";
const SHELL = ["/", "/app", "/offline", "/manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

/**
 * Store a response, best-effort. Caching is an optimisation: a failure here
 * must never reject into the console or break the response the page is
 * already receiving. Partial (206) and error responses are not cacheable.
 */
function cachePut(request, response) {
  if (!response || !response.ok) return;
  const copy = response.clone();
  caches
    .open(CACHE)
    .then((c) => c.put(request, copy))
    .catch(() => {});
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // never cache mutations (server actions/POST)

  const url = new URL(request.url);

  // The Cache API only accepts http(s). Browser extensions issue requests
  // through the page's service worker under schemes like chrome-extension:,
  // and `cache.put` rejects them — an unhandled rejection that floods the
  // console on every extension request. They are not ours to cache anyway.
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  // Only cache this origin's own assets. Third-party responses are often
  // opaque (status 0), which `cache.put` also rejects.
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/api")) return; // always network for APIs

  // Network-first for navigations, fall back to cache then offline page.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          cachePut(request, res);
          return res;
        })
        .catch(() => caches.match(request).then((r) => r || caches.match("/offline"))),
    );
    return;
  }

  // Cache-first for static assets.
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((res) => {
      cachePut(request, res);
      return res;
    })),
  );
});
