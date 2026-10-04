// 媒体本地缓存 SW（同源）：首次访问时随游戏预加载自然写入缓存，
// 之后每次访问图片/音频全部本地秒出，游玩不再依赖网络速度。
// 缓存名固定，除非媒体文件更换才需要改（改后旧缓存会自动清掉）。
const CACHE_NAME = 'runzhou-media-v1';

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
 * 处理音频的 Range 分段请求：缓存里有完整文件时切出 206 响应，没有则原样透传。
 * 不能丢 Range 头重发（iOS 放不出声）；未命中不整包下载（iOS 会等整包、且抢带宽）。
 */
async function serveRange(request) {
  const url = request.url;
  const rangeHeader = request.headers.get('range');
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(url);

  // 缓存未命中：直接透传（Range 头原样保留）。
  // 不在这里整包下载再切片：iOS 会一直等整包下完才出声，而且整包下载会与播放抢带宽。
  // iOS 的媒体请求全部带 Range，因此 iOS 上音频永远走原生 GitHub Pages 206 路径。
  if (!cached) return fetch(request);

  const body = await cached.arrayBuffer();
  const contentType = cached.headers.get('Content-Type');

  const m = rangeHeader.match(/bytes=(\d*)-(\d*)/);
  if (!m) return fetch(request);

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
  event.waitUntil(self.skipWaiting());
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

  // 只缓存同源 GET；页面 HTML 和第三方资源（字体、统计）一律放行
  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') return;

  if (request.headers.has('range')) {
    event.respondWith(serveRange(request).catch(() => fetch(request)));
    return;
  }

  // 同源图片/音频：缓存优先，未命中时下载一份并写入缓存
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetchFullAndCache(url.href).catch(() => fetch(request));
    })
  );
});
