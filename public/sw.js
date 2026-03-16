// ============================================================
// Service Worker - 便利店收银台离线支持
// ============================================================
const CACHE_NAME = 'pos-cache-v3';

// 必须缓存的核心文件（一定存在）
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/cashier.html',
];

// 可选缓存文件（存在就缓存，不存在跳过）
const OPTIONAL_ASSETS = [
  '/zxing.min.js',
  '/qrcode.min.js',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
];

// ---- 安装：缓存静态资源 ----
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      // 核心文件必须成功
      await cache.addAll(CORE_ASSETS);
      // 可选文件逐个尝试，失败跳过
      for (const url of OPTIONAL_ASSETS) {
        try {
          await cache.add(url);
        } catch(err) {
          console.warn('[SW] 可选文件缓存失败，跳过:', url);
        }
      }
    })
  );
  self.skipWaiting();
});

// ---- 激活：清理旧缓存 ----
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ---- 请求拦截策略 ----
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // 只处理同源请求
  if (url.origin !== location.origin) return;

  // 静态页面/资源：Cache First
  const staticPaths = ['/', '/index.html', '/cashier.html', '/zxing.min.js', '/qrcode.min.js', '/sw.js', '/manifest.json', '/icon-192.png', '/icon-512.png'];
  if (staticPaths.includes(url.pathname)) {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request))
    );
    return;
  }

  // API 请求：Network First，网络失败返回离线标记
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(e.request.clone())
        .then(res => res)
        .catch(() => new Response(
          JSON.stringify({ __offline: true }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        ))
    );
    return;
  }

  // 其他请求：Network First with cache fallback
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
