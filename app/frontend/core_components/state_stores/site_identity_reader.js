// site_identity_reader.js
// Reads the administrator-owned site name from the server-rendered application shell
// and owns the rules for showing it beside another title.
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

/**
 * Tells whether a title already opens with the site's own name, so a heading or a
 * browser tab must not name the site a second time.
 * Bridges the administrator-owned identity with every label that composes a title
 * out of the site name and a dataset's own title.
 * Exists because a stored title such as "Serlog.com – Service catalog" otherwise
 * reads "Serlog.com – Serlog.com – Service catalog".
 *
 * The name counts as repeated only at the very start of the title, compared
 * without case or surrounding whitespace, and only when the title either ends
 * there or continues with something that is not a letter or a digit — a space,
 * dash, en dash, colon, pipe and so on. That keeps a longer word such as
 * "Serlogistics" a different word rather than the site name with a suffix, and
 * leaves a site name mentioned in the middle of a title untouched.
 *
 * @param {string} title Title as the person reads it, in the current interface language.
 * @param {string} siteName Administrator-owned site name.
 * @returns {boolean} True when the site name must not be added beside this title again.
 */
export function titleAlreadyOpensWithSiteName(title, siteName) {
    const readableTitle = String(title ?? "").trim();
    const readableSiteName = String(siteName ?? "").trim();
    if (!readableTitle || !readableSiteName) {
        return false;
    }

    const titleOpening = readableTitle.slice(0, readableSiteName.length);
    if (titleOpening.toLocaleLowerCase() !== readableSiteName.toLocaleLowerCase()) {
        return false;
    }

    const characterAfterSiteName = readableTitle.charAt(readableSiteName.length);
    return characterAfterSiteName === ""
        || !/[\p{L}\p{N}]/u.test(characterAfterSiteName);
}
