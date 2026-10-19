// ── EATT Service Worker ──────────────────────────────────────────────────────
// Makes the app installable and usable offline at the gym.
// - App files: served from cache instantly, refreshed in the background.
// - Supabase (auth + data): always network, never cached.
// Bump CACHE when shipping changes so phones pick up the new files.

// Prefix scopes cleanup to THIS app's caches: other sites on the same origin
// (e.g. the staging copy on cheloco44.github.io) keep their own.
var CACHE_PREFIX = 'eatt-app-';
var CACHE = CACHE_PREFIX + 'v1';

var APP_SHELL = [
    './',
    'index.html',
    '5x5.html',
    '531workout.html',
    'juggernaut.html',
    'strongman531.html',
    'cube.html',
    'arnoldsplit.html',
    'brosplit.html',
    'deckofcards.html',
    'nutrition.html',
    'eatt_save.js',
    'pwa.js',
    'manifest.webmanifest',
    'icons/icon-192.png',
    'icons/icon-512.png',
    'images/gorillavsbull.png',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js'
];

self.addEventListener('install', function(event) {
    event.waitUntil(
        caches.open(CACHE).then(function(cache) { return cache.addAll(APP_SHELL); })
            .then(function() { return self.skipWaiting(); })
    );
});

self.addEventListener('activate', function(event) {
    event.waitUntil(
        caches.keys().then(function(keys) {
            return Promise.all(keys.filter(function(k) { return k.indexOf(CACHE_PREFIX) === 0 && k !== CACHE; })
                                   .map(function(k) { return caches.delete(k); }));
        }).then(function() { return self.clients.claim(); })
    );
});

self.addEventListener('fetch', function(event) {
    var req = event.request;
    if (req.method !== 'GET') return;

    var url = new URL(req.url);
    var sameOrigin = url.origin === self.location.origin;
    var supabaseLib = url.hostname === 'cdn.jsdelivr.net' && url.pathname.indexOf('/@supabase/') === 0;
    if (!sameOrigin && !supabaseLib) return;  // Supabase API, fonts, etc. go straight to the network

    // Stale-while-revalidate: answer from cache, update cache from network.
    event.respondWith(
        caches.open(CACHE).then(function(cache) {
            return cache.match(req, { ignoreSearch: true }).then(function(cached) {
                var network = fetch(req).then(function(res) {
                    if (res && res.ok) cache.put(req, res.clone());
                    return res;
                }).catch(function() { return cached; });
                return cached || network;
            });
        })
    );
});
