const CACHE_NAME = 'chibi-v2';
const CDN_HOST = 'cdn.jsdelivr.net';

const PRECACHE_URLS = [
  './',
  './index.html'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET' || request.mode === 'navigate') {
    return;
  }

  // jsDelivr 资源：缓存优先（jsDelivr 带 CORS 头，可正常缓存）
  // 二次访问全部命中本地缓存，秒开且省流量
  if (url.hostname === CDN_HOST) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(url.href, { mode: 'cors', credentials: 'omit' }).then(response => {
          if (!response || response.status !== 200) return response;
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(request, responseToCache);
          });
          return response;
        }).catch(() => new Response('', { status: 404 }));
      })
    );
    return;
  }

  // 同源资源：缓存优先 + 失败时图片回退到赤壁封面
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;

      return fetch(request).then(response => {
        if (!response || response.status !== 200) return response;

        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(request, responseToCache);
        });

        return response;
      }).catch(() => {
        if (url.pathname.endsWith('.jpg') || url.pathname.endsWith('.png') || url.pathname.endsWith('.webp')) {
          return caches.match('./images/fire.webp');
        }
        return new Response('', { status: 404 });
      });
    })
  );
});
