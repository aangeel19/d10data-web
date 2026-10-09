// Service worker de D10 (PWA, 9 oct 2026). Hace que la web abra rápido y también sin conexión:
//   - /assets/* (JS y CSS con huella en el nombre, no cambian nunca): caché primero.
//   - /datos/*.json y la página: red primero (siempre lo último) y, si no hay red, lo último guardado.
//   - iconos, escudos y fondos: caché primero, se van guardando según se ven.
// No toca nada de otros dominios (Supabase, Google): las cuentas siempre van por red.
const VERSION = "d10-v1";
const ESTATICO = `${VERSION}-estatico`;
const DATOS = `${VERSION}-datos`;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(ESTATICO).then((c) => c.addAll(["/", "/manifest.webmanifest", "/d10.svg", "/icono-192.png"])).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (!k.startsWith(VERSION)) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function redPrimero(req, cache, clave) {
  try {
    const r = await fetch(req);
    if (r.ok) (await caches.open(cache)).put(clave ?? req, r.clone());
    return r;
  } catch {
    const guardada = await caches.match(clave ?? req);
    if (guardada) return guardada;
    throw new Error("sin conexión y sin copia guardada");
  }
}

async function cachePrimero(req) {
  const guardada = await caches.match(req);
  if (guardada) return guardada;
  const r = await fetch(req);
  if (r.ok) (await caches.open(ESTATICO)).put(req, r.clone());
  return r;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;           // Supabase, Google… siempre por red
  if (url.pathname === "/config.json" || url.pathname === "/sw.js") return;
  if (req.mode === "navigate") {                              // cualquier ruta de la web: la página de la SPA
    e.respondWith(redPrimero(req, ESTATICO, "/"));
    return;
  }
  if (url.pathname.startsWith("/datos/")) { e.respondWith(redPrimero(req, DATOS)); return; }
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/escudos/") || url.pathname.startsWith("/fondos/")
      || /\.(png|svg|webp|jpg|woff2?)$/.test(url.pathname)) {
    e.respondWith(cachePrimero(req));
  }
});
