// Registers the service worker (offline + installable). Included on every page.
if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
        navigator.serviceWorker.register('sw.js').catch(function(err) {
            console.warn('EATT offline mode unavailable:', err && err.message || err);
        });
    });
}
