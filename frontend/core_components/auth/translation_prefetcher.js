// translation_prefetcher.js
// Prefetches translation data for the login page to enable immediate localization.
// Bridges login HTML parse and the translation API; seeds window.translationPromises used by login modules.
// Exists to overlap translation fetches with page load and reduce perceived localization latency.
// PIPELINE_EXCEPTION: Uses direct fetch() because this IIFE runs before modules load, so endpoint_router / runApiPipeline are unavailable.
(function() {
    try {
        function normalizePrefetchLanguage(value) {
            var normalized = String(value || "en").trim().toLowerCase().replaceAll('_', '-');
            if (normalized === 'yue' || normalized.indexOf('yue-') === 0) return 'yue';
            if (normalized === 'zh-hk' || normalized === 'zh-mo' || normalized.indexOf('zh-hant-hk') === 0 || normalized.indexOf('zh-hant-mo') === 0) return 'zh-HK';
            if (normalized === 'zh-tw' || normalized === 'zh-hant' || normalized.indexOf('zh-hant-tw') === 0) return 'zh-TW';
            if (normalized === 'zh' || normalized === 'zh-cn' || normalized === 'zh-sg' || normalized.indexOf('zh-hans') === 0) return 'zh-CN';
            return normalized.split('-')[0] || 'en';
        }

        var lang = normalizePrefetchLanguage(navigator.language || "en");
        window.translationPromises = {};
        if (lang !== 'en') {
            window.translationPromises['en'] = fetch('/api/translations?lang=en')
                .then(function(r) { return r.json(); })
                .catch(function(e) { console.warn('Translation prefetch (en) failed', e); return {}; });
        }
        window.translationPromises[lang] = fetch('/api/translations?lang=' + encodeURIComponent(lang)).then(function(r) {
            if (!r.ok) {
                var err = new Error(r.statusText);
                err.status = r.status;
                throw err;
            }
            return r.json();
        }).catch(function(e) { console.warn('Translation prefetch (' + lang + ') failed', e); return {}; });
    } catch (e) { console.warn('Translation prefetch failed', e); }
})();
