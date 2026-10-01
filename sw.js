/* ===== Service Worker：离线缓存 =====
 * 策略：stale-while-revalidate —— 有缓存就立即用缓存（秒开，不等网络），
 * 同时在后台拉最新版本写入缓存，下次打开即为最新版。
 * 之所以不用 network-first：GitHub Pages 在国内访问常有 0.3~1s 往返，
 * 每次启动都等一轮网络是首屏卡顿的主要原因。
 * 新版本装好后页面会收到通知并显示顶部提示条，用户可一键立即更新。
 */
const CACHE = 'moneybook-v1.2.2';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/db.js',
  './js/store.js',
  './js/charts.js',
  './js/ui.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;   // 云备份等跨域请求不接管

  e.respondWith(
    caches.match(req).then((cached) => {
      // 绕过浏览器 HTTP 缓存，确保拿到的是最新版本
      const network = fetch(req, { cache: 'no-cache' })
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached || caches.match('./index.html'));

      return cached || network;   // 有缓存立即返回；首次访问才等网络
    })
  );
});
