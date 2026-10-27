// Service worker de D10 (PWA, 9 oct 2026). Hace que la web abra rápido y también sin conexión:
//   - /assets/* (JS y CSS con huella en el nombre, no cambian nunca): caché primero.
//   - /datos/*.json y la página: red primero (siempre lo último) y, si no hay red, lo último guardado.
//   - iconos y fotos de fondo: caché primero, se van guardando según se ven (los .json de /fondos/, red primero).
// No toca nada de otros dominios (Supabase, Google): las cuentas siempre van por red.
const VERSION = "d10-v4";   // (20 oct) v4: cada push enseña SIEMPRE su notificación (iOS da de baja a quien no lo hace) y globo con el número
// const VERSION anterior = "d10-v3";   // (17 oct) v3: los .json de /fondos/ (créditos y lista de fotos) van por red primero
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
  // (17 oct) también /fondos/*.json: si iban "caché primero", los créditos de las fotos nuevas no llegaban nunca al móvil
  if (url.pathname.startsWith("/datos/") || (url.pathname.startsWith("/fondos/") && url.pathname.endsWith(".json"))) {
    e.respondWith(redPrimero(req, DATOS)); return;
  }
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/escudos/") || url.pathname.startsWith("/fondos/")
      || /\.(png|svg|webp|jpg|woff2?)$/.test(url.pathname)) {
    e.respondWith(cachePrimero(req));
  }
});

// Notificaciones push (11 oct 2026): las manda el Worker d10-directo cifradas (utilidades/push.ts). Si la web está
// abierta y a la vista no se enseña nada: ya sale el aviso dentro de la página, con su sonido.
// (27 oct) cada aviso vibra distinto (Android; iPhone no deja elegir la vibración ni el sonido en avisos web)
const VIBRA = {
  gol: [200, 80, 200, 80, 400],           // tres golpes, el último largo
  anulado: [400, 120, 120],
  roja: [600],                            // uno largo y seco
  amarilla: [120, 80, 120],               // dos cortos
  empieza: [100, 60, 100, 60, 100],       // pitido inicial: tres cortos
  segunda: [100, 60, 300],
  descanso: [300, 100, 100],
  final: [300, 100, 300, 100, 600],       // pitido final: tres, el último largo
  alineacion: [60, 40, 60],
  pleno: [80, 60, 80], resumen: [80, 60, 80],
};
self.addEventListener("push", (e) => {
  // (20 oct) Antes, si la web estaba abierta, no se enseñaba nada. Eso era el fallo de "a mi amigo le llegan y a mí
  // no": Safari (iPhone) da de baja la suscripción del que recibe varios push sin notificación visible, y Chrome
  // termina enseñando el aviso genérico. Ahora se enseña siempre (con su "tag", así un gol nuevo sustituye al anterior
  // del mismo partido y no se amontonan) y además, si la web está abierta, se le avisa para que actualice al momento.
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { titulo: "D10", texto: e.data?.text() ?? "" }; }
  e.waitUntil((async () => {
    try {
      const abiertas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of abiertas) c.postMessage({ tipo: "d10-push", datos: d });
    } catch { /* nada */ }
    await self.registration.showNotification(d.titulo || "D10", {
      body: d.texto || "", icon: "/icono-192.png", badge: "/icono-192.png", tag: d.tag || undefined,
      data: { url: d.url || "/" }, vibrate: VIBRA[d.tipo] || [80], renotify: d.renotify === false ? false : !!d.tag, silent: d.renotify === false,
      timestamp: Date.now(),
    });
    // globo con el número de avisos sin ver en el icono de la app (Android/iOS/PC, donde exista)
    try { const n = (await self.registration.getNotifications()).length; if (self.navigator.setAppBadge) await self.navigator.setAppBadge(n); } catch { /* nada */ }
  })());
});

// Si el navegador renueva la suscripción por su cuenta, la próxima vez que se abra la web se vuelve a guardar
// (AvisosDirecto → actualizarFiltroPush); aquí no hay sesión ni Supabase.

// Avisos de goles (10 oct 2026): al tocar la notificación, abre (o enfoca) la web en el partido.
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil((async () => { try { const n = (await self.registration.getNotifications()).length; if (n) await self.navigator.setAppBadge?.(n); else await self.navigator.clearAppBadge?.(); } catch { /* nada */ } })());
  const url = e.notification.data?.url || "/";
  e.waitUntil((async () => {
    const abiertas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of abiertas) if ("focus" in c) { await c.navigate(url).catch(() => {}); return c.focus(); }
    return self.clients.openWindow(url);
  })());
});
