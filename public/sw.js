// Service worker do Elite Lion: permite instalar o painel como app no celular.
// Os dados (/api) vêm sempre da rede. O resto tenta a rede primeiro e só usa a
// cópia guardada quando está sem internet, pra nunca mostrar versão velha.
const CACHE = "elite-lion-v1";
const SHELL = ["/", "/index.html", "/styles.css", "/app.js", "/logo-lion-preto.png", "/logo-lion-branco.png", "/icons/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (r.ok) { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copia)); }
        return r;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("/index.html")))
  );
});
