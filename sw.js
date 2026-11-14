/* Service worker: guarda la app y las listas en el equipo para usarlas sin internet.
   Cuando cambie algún archivo, suba el número de CACHE para que los equipos se actualicen. */
const CACHE = "checklist-uas-v18";
const BASE = ["./", "index.html", "styles.css", "app.js", "manifest.webmanifest",
  "datos/divipola.json", "datos/flota.json", "datos/pilotos.enc.json", "vendor/xlsx.full.min.js",
  "img/logo-ubpd.png", "img/logo-dji.png", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png",
  "listas/indice.txt"];
// Siempre desde internet, sin la memoria temporal del navegador (GitHub Pages la guarda hasta 10 min).
// Sin esto, una versión nueva podía quedar instalada con el app.js anterior.
const fresco = u => new Request(u, { cache: "reload" });

self.addEventListener("install", ev => {
  ev.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(BASE.map(fresco));
    // también guarda cada lista nombrada en el índice
    try {
      const idx = await (await fetch(fresco("listas/indice.txt"))).text();
      const files = idx.split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith("#"));
      await Promise.all(files.map(f => c.add(fresco("listas/" + encodeURIComponent(f))).catch(() => {})));
    } catch (e) {}
    // La versión nueva se activa sola, sin esperar a que el piloto pulse «Actualizar ahora».
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", ev => {
  ev.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("message", ev => { if (ev.data === "skipWaiting") self.skipWaiting(); });

self.addEventListener("fetch", ev => {
  const req = ev.request; const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  // Comprobación de versión que hace la app: siempre a internet.
  if (url.searchParams.has("comprobar")) return;
  // Listas: primero la red (para recibir cambios), si no hay señal usa la copia guardada.
  if (url.pathname.includes("/listas/") || url.pathname.endsWith("/flota.json") || url.pathname.endsWith("/pilotos.enc.json")) {
    ev.respondWith((async () => {
      const c = await caches.open(CACHE);
      try { const r = await fetch(req, { cache: "no-cache" }); if (r.ok) c.put(req, r.clone()); return r; }
      catch (e) { return (await c.match(req, { ignoreSearch: true })) || new Response("", { status: 504 }); }
    })());
    return;
  }
  // Resto de la app: primero la copia guardada (rápido y sin internet).
  // En pruebas locales (localhost) siempre usa la red para ver los cambios al instante.
  if (location.hostname === "localhost") return;
  ev.respondWith((async () => {
    const c = await caches.open(CACHE);
    const hit = await c.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try { const r = await fetch(req, { cache: "no-cache" }); if (r.ok) c.put(req, r.clone()); return r; }
    catch (e) { return (req.mode === "navigate" && await c.match("index.html")) || new Response("Sin conexión", { status: 503 }); }
  })());
});
