// translation_prefetcher.js
// Prefetches translation data for the login page to enable immediate localization.
// Bridges login HTML parse and the translation API; seeds window.translationPromises used by login modules.
// Exists to overlap translation fetches with page load and reduce perceived localization latency.
// PIPELINE_EXCEPTION: Uses direct fetch() because this IIFE runs before modules load, so endpoint_router / runApiPipeline are unavailable.
(function() {
    try {
        var lang = (navigator.language || "en").substring(0, 2);
        window.translationPromises = {};
        if (lang !== 'en') {
            window.translationPromises['en'] = fetch('/api/translations?lang=en')
                .then(function(r) { return r.json(); })
                .catch(function(e) { console.warn('Translation prefetch (en) failed', e); return {}; });
        }
        window.translationPromises[lang] = fetch('/api/translations?lang=' + lang).then(function(r) {
            if (!r.ok) {
                var err = new Error(r.statusText);
                err.status = r.status;
                throw err;
            }
            return r.json();
        }).catch(function(e) { console.warn('Translation prefetch (' + lang + ') failed', e); return {}; });
    } catch (e) { console.warn('Translation prefetch failed', e); }
})();
