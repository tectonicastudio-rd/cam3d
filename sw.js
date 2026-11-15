// CAM3D · funciona sin conexión después de la primera visita
const V = 'cam3d-v5';
const CDN='https://cdn.jsdelivr.net/npm/three@0.160.0/';
const CORE = ['./', 'index.html', 'app.js', 'core.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'logo.webp', 'emblem-256.png', CDN+'build/three.module.js', CDN+'examples/jsm/controls/OrbitControls.js', CDN+'examples/jsm/loaders/GLTFLoader.js', CDN+'examples/jsm/exporters/GLTFExporter.js', CDN+'examples/jsm/utils/BufferGeometryUtils.js', CDN+'examples/jsm/utils/TextureUtils.js'];
self.addEventListener('install', e => e.waitUntil(caches.open(V).then(c => Promise.allSettled(CORE.map(u => c.add(u)))).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => {
    if (res.ok && (e.request.url.startsWith(self.location.origin) || e.request.url.includes('cdn.jsdelivr.net/npm/three@'))) { const cp = res.clone(); caches.open(V).then(c => c.put(e.request, cp)); }
    return res;
  }).catch(() => caches.match('index.html'))));
});
