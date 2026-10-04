// 最终版：移除 Service Worker。
// 媒体与页面同源托管（GitHub Pages 的 10 分钟缓存 + ETag 校验），不再需要 SW。
// 已安装旧版 SW 的浏览器检测到本文件更新后，会自动注销并清空缓存。
self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil(
    Promise.all([
      self.registration.unregister(),
      caches.keys().then(keys => Promise.all(keys.map(key => caches.delete(key))))
    ])
  );
});
