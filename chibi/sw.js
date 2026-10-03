const CACHE_NAME = 'chibi-v3';
const CDN_HOST = 'cdn.jsdelivr.net';

const PRECACHE_URLS = [
  './',
  './index.html'
];

// 同一 URL 的完整下载去重：预加载的完整请求和音频分段请求共享一次网络下载
const inflight = new Map();

function fetchFullAndCache(url) {
  if (inflight.has(url)) return inflight.get(url).then(r => r.clone());
  const p = fetch(url, { mode: 'cors', credentials: 'omit' }).then(response => {
    if (response && response.status === 200) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(url, copy));
    }
    return response;
  }).finally(() => inflight.delete(url));
  inflight.set(url, p);
  // 每个调用方拿独立的克隆：Response body 只能被消费一次
  return p.then(r => r.clone());
}

/**
 * 处理音频/视频的 Range 分段请求：从缓存的完整文件里切出 206 响应。
 * 不能直接透传（会绕过缓存反复走网络），也不能丢 Range 头重发（iOS 放不出声）。
 */
async function serveRange(request) {
  const url = request.url;
  const rangeHeader = request.headers.get('range');
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(url);

  let body;
  let contentType;
  if (cached) {
    body = await cached.arrayBuffer();
    contentType = cached.headers.get('Content-Type');
  } else {
    let response = null;
    try {
      response = await fetchFullAndCache(url);
    } catch (e) {
      return fetch(url, { mode: 'cors', credentials: 'omit' });
    }
    if (!response || response.status !== 200) {
      return fetch(url, { mode: 'cors', credentials: 'omit' });
    }
    body = await response.arrayBuffer();
    contentType = response.headers.get('Content-Type');
  }

  const m = rangeHeader.match(/bytes=(\d*)-(\d*)/);
  if (!m) return fetch(url, { mode: 'cors', credentials: 'omit' });

  const total = body.byteLength;
  let start;
  let end;
  if (m[1] === '') {
    // 后缀范围：最后 N 字节
    const n = parseInt(m[2], 10) || 0;
    start = Math.max(total - n, 0);
    end = total - 1;
  } else {
    start = parseInt(m[1], 10) || 0;
    end = m[2] === '' ? total - 1 : Math.min(parseInt(m[2], 10), total - 1);
  }

  if (start >= total) {
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${total}` }
    });
  }

  const sliced = body.slice(start, end + 1);
  return new Response(sliced, {
    status: 206,
    headers: {
      'Content-Type': contentType || 'audio/mp4',
      'Content-Length': String(sliced.byteLength),
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Accept-Ranges': 'bytes'
    }
  });
}

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
    )
    // 不调用 clients.claim()：中途接管页面会打断正在进行的媒体流，
    // 新版本 SW 从下一次访问（刷新）开始接管
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET' || request.mode === 'navigate') {
    return;
  }

  if (request.headers.has('range')) {
    event.respondWith(
      serveRange(request).catch(() => new Response('', { status: 416 }))
    );
    return;
  }

  // jsDelivr 资源：缓存优先（jsDelivr 带 CORS 头，可正常缓存）
  // 二次访问全部命中本地缓存，秒开且省流量
  if (url.hostname === CDN_HOST) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetchFullAndCache(url.href).catch(() => new Response('', { status: 404 }));
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
