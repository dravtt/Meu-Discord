// Minimal service worker: lets phones install Voka as an app. It caches nothing, so every visit gets the latest site.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
