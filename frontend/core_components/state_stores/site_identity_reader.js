// site_identity_reader.js
// Reads the administrator-owned site name from the server-rendered application shell.
// Bridges SEO metadata and browser UI components that need one stable site identity.
// Exists so dynamic site names remain untranslated and are not duplicated in language data.

export function getCurrentSiteName(root = document) {
    const metadataName = root
        .querySelector?.('meta[property="og:site_name"]')
        ?.getAttribute("content")
        ?.trim();
    if (metadataName) {
        return metadataName;
    }

    return root
        .querySelector?.(".navbar-site-identity")
        ?.textContent
        ?.trim() || "";
}

/**
 * Normalizes the administrator-owned identity for visible browser labels.
 * Bridges the unchanged stored name with headings and administrator information panels.
 * Keeps dynamic names out of translations while giving Latin-script names a polished initial.
 */
export function formatSiteNameForDisplay(siteName) {
    return String(siteName || "")
        .trim()
        .replace(/^\p{Ll}/u, (firstLetter) => firstLetter.toLocaleUpperCase());
}
