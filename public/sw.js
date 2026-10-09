// Trako's service worker: keeps the fonts, styles, icons and manifest in a cache
// and serves them from there, so pages draw without waiting on the network.
// Everything else (pages, covers, the /assets/ scripts) always comes from the server.
//
// Change VERSION when the manifest changes: the new worker starts with an empty
// cache and drops the old one. Fonts and icons never change under the same name
// (browsers keep them for a year, see app/router.ts): a changed one gets a new
// name. app.css and theme.js need neither, as pages link them with ?v=<mtime>.
const VERSION = 'trako-1'
const CACHED = /^\/(fonts\/|icon-|app\.css$|theme\.js$|manifest\.webmanifest$)/

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim()
      for (let name of await caches.keys()) if (name !== VERSION) await caches.delete(name)
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  let url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== location.origin || !CACHED.test(url.pathname)) {
    return
  }
  // When the cache cannot be used (storage full, blocked or broken), the network answers.
  event.respondWith(cacheFirst(event.request, url.pathname).catch(() => fetch(event.request)))
})

async function cacheFirst(request, pathname) {
  let cache = await caches.open(VERSION)
  let cached = await cache.match(request)
  if (cached) return cached
  let response = await fetch(request)
  if (response.status === 200) {
    // A new ?v= of app.css or theme.js replaces the older copy.
    for (let key of await cache.keys()) {
      if (new URL(key.url).pathname === pathname) await cache.delete(key)
    }
    await cache.put(request, response.clone())
  }
  return response
}
