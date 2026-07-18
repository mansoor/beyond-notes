// Minimal service worker: enough for installability + share target.
// Offline support is a later enhancement; the network is the source of truth.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => {
  // pass-through
})
