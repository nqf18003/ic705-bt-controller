// オフライン対応（Service Worker）。このページのファイルだけを端末の中に取っておき、
// インターネットにつながらないときはそれを使う。外のサイトへは何も送らない・何も取りに行かない。
// 版を上げたら CACHE の名前も app.js の APP_VER に合わせて変える（古い取り置きを消すため）。
const CACHE = 'ic705bt-2026-11-25-28';
const FILES = ['./', 'index.html', 'app.js', 'i18n.js', 'style.css', 'manifest.json', 'icon-192.png', 'icon-512.png'];
const WAIT_NET_MS = 3000; // 通信が遅いとき、これ以上待たずに取っておいた物を使う

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('ic705bt-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// まずネットから取る（新しい版があればそれを使い、取り置きも入れ替える）。
// 取れないとき・3 秒待っても来ないときは、取っておいた物を使う。
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || !req.url.startsWith(self.registration.scope)) return;
  const fromCache = () => caches.match(req, { ignoreSearch: true })
    .then((r) => r || (req.mode === 'navigate' ? caches.match('./') : undefined));
  e.respondWith(new Promise((resolve) => {
    let done = false;
    const finish = (r) => { if (!done && r) { done = true; resolve(r); } };
    const timer = setTimeout(() => fromCache().then(finish), WAIT_NET_MS);
    // no-cache: ブラウザーの一時保存（GitHub Pages は 10 分）を使わず、サーバーに新しい版があるか確かめる
    fetch(new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' })).then((res) => {
      clearTimeout(timer);
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      finish(res);
    }).catch(() => {
      clearTimeout(timer);
      fromCache().then((r) => finish(r || Response.error()));
    });
  }));
});
