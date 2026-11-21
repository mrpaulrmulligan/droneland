// Droneland offline cache. Pages: network first (so updates arrive when there is signal), saved copy when there isn't.
// Fonts, icons and the manifest: saved copy first. Nothing else is fetched, and nothing personal is cached.
const CACHE = "droneland-v1";
const SHELL = ["./", "manifest.webmanifest", "icon-192.png", "icon-180.png"];

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(SHELL);
    // Save the page's fonts too (Latin subsets only), so the offline copy looks the same
    try {
      const html = await (await c.match("./")).text();
      const css = (html.match(/href="(https:\/\/fonts\.googleapis\.com\/css2[^"]+)"/) || [])[1];
      if (css) {
        const href = css.replace(/&amp;/g, "&"), res = await fetch(href, { mode: "cors" });
        if (res.ok) {
          const text = await res.clone().text();
          await c.put(href, res);
          const urls = [...text.matchAll(/\/\* latin \*\/\s*@font-face\s*{[^}]*?url\((https:[^)]+)\)/g)].map(m => m[1]);
          await Promise.all(urls.map(u => fetch(u, { mode: "cors" }).then(r => r.ok && c.put(u, r)).catch(() => {})));
        }
      }
    } catch (err) { /* fonts fall back to system fonts offline */ }
    self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

const timeout = (ms) => new Promise((_, no) => setTimeout(() => no(new Error("timeout")), ms));

self.addEventListener("fetch", e => {
  const r = e.request;
  if (r.method !== "GET") return;
  const u = new URL(r.url);
  if (r.mode === "navigate") {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      try {
        const res = await Promise.race([fetch(r), timeout(4000)]);
        if (res.ok) c.put("./", res.clone());
        return res;
      } catch (err) {
        return (await c.match("./")) || Response.error();
      }
    })());
    return;
  }
  const font = u.host === "fonts.googleapis.com" || u.host === "fonts.gstatic.com";
  if (!font && u.origin !== self.location.origin) return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const hit = await c.match(r, { ignoreSearch: !font });
    const net = fetch(r).then(res => { if (res.ok) c.put(r, res.clone()); return res; }).catch(() => null);
    if (hit) { if (!font) try { e.waitUntil(net); } catch (err) {} return hit; }     // icons/manifest refresh in the background
    return (await net) || Response.error();
  })());
});
