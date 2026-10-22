// site_favicon_reader.js
// Reads the server-resolved display favicon and optionally binds Home's theme.
// Connects head metadata to identity images, including Home's moving phone node.
// Keeps dataset readers on the normal image and owns Home's observer cleanup.

function displayFaviconLink(doc = document) {
    return doc.querySelector('link[rel~="icon"][sizes="128x128"]')
        || doc.querySelector('link[rel~="icon"]');
}

/** Prefer the large lossless asset; older heads retain their original icon. */
export function getSiteDisplayFaviconHref() {
    return displayFaviconLink()?.href || '';
}

/** Home opts in on its real img node; moving it never changes this binding. */
export function bindHomeSiteFavicon(icon) {
    const doc = icon.ownerDocument;
    const link = displayFaviconLink(doc);
    const original = link?.href || '';
    const dark = link?.getAttribute('data-home-dark-href') || original;
    if (!original) { icon.hidden = true; return () => {}; }
    let failed = false;
    function sync() {
        const selected = !failed && doc.body.classList.contains('dark-mode') ? dark : original;
        if (icon.getAttribute('src') !== selected) icon.src = selected;
    }
    function fallback() {
        if (failed || icon.src === original) return;
        failed = true;
        sync();
    }
    sync();
    icon.addEventListener('error', fallback);
    // The resolved application theme is authoritative, including OS overrides.
    const observer = new MutationObserver(sync);
    observer.observe(doc.body, { attributes: true, attributeFilter: ['class'] });
    return () => { observer.disconnect(); icon.removeEventListener('error', fallback); };
}
