// site_favicon_reader.js
// Reads the server-resolved display favicon for Home and the phone identity.
// Connects both 32 CSS px images to the optional 128px head link.
// Keeps server selection and missing-variant fallback authoritative.

/** Prefer the large lossless asset; older heads retain their original icon. */
export function getSiteDisplayFaviconHref() {
    return (document.querySelector('link[rel~="icon"][sizes="128x128"]')
        || document.querySelector('link[rel~="icon"]'))?.href || '';
}
