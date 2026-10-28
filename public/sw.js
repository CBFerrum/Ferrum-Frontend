// Ferrum service worker: the app shell loads instantly and opens offline. Business data (/api,
// /files, sockets) always goes to the network: a cached answer could be wrong, never stale-but-ok.
const CACHE = "ferrum-shell";
const SHELL = "/app/";
const BUNDLES = /\/app\/assets\/[^"')\s]+/g;

self.addEventListener("install", (e) => {
  self.skipWaiting();
  // Cache the current shell and its bundles now, so an installed app opens offline after its first visit.
  e.waitUntil(
    fetch(SHELL, { cache: "no-cache" })
      .then(async (res) => {
        if (!res.ok) return;
        const html = await res.clone().text();
        await keepShell(res);
        await (await caches.open(CACHE)).addAll(html.match(BUNDLES) ?? []);
      })
      .catch(() => {}), // the next online navigation fills the cache instead
  );
});
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

/** Keeps the new shell and drops bundles it no longer references (old deployments). */
async function keepShell(res) {
  const cache = await caches.open(CACHE);
  const html = await res.clone().text();
  await cache.put(SHELL, res);
  const used = new Set(html.match(BUNDLES) ?? []);
  for (const req of await cache.keys()) {
    const path = new URL(req.url).pathname;
    if (path.startsWith("/app/assets/") && !used.has(path)) await cache.delete(req);
  }
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin || !url.pathname.startsWith("/app/")) return;
  if (req.mode === "navigate") {
    // Network first so a deployment shows at once; the cached shell only when offline.
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && (res.headers.get("content-type") ?? "").includes("text/html")) e.waitUntil(keepShell(res.clone()));
          return res;
        })
        .catch(async () => (await caches.match(SHELL)) ?? Response.error()),
    );
  } else if (url.pathname.startsWith("/app/assets/")) {
    // Content-hashed bundles never change: cache first.
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ??
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone(); // before the page reads the body
              e.waitUntil(caches.open(CACHE).then((c) => c.put(req, copy)));
            }
            return res;
          }),
      ),
    );
  }
});
