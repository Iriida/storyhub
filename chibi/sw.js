// 最终版：移除 Service Worker。
// 资源缓存改由 jsDelivr 的浏览器缓存（max-age 7 天）负责，不再需要 SW。
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
