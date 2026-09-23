// dataset_heading_title_writer.js
// Owns the dataset heading's title: the dataset's own name, and the site name in front
// of it only when that title does not already open with the site name.
// Between the administrator-owned site identity, the translated dataset title and the
// filterbar's hero heading.
// Exists because a stored title such as "Serlog.com – Service catalog" otherwise made the
// heading read "Serlog.com – Serlog.com – Service catalog".

import { readTranslatedLabelOrEmpty } from "../lang/translation_handler.js";
import {
    formatSiteNameForDisplay,
    getCurrentSiteName,
    titleAlreadyOpensWithSiteName,
} from "../state_stores/site_identity_reader.js";

const DATASET_HEADING_TITLE_CLASS = "morphing-title";
const DATASET_TITLE_CLASS = "morphing-title__dataset-name";
const SITE_NAME_CLASS = "morphing-title__site-name";
const SITE_NAME_SEPARATOR_CLASS = "morphing-title__separator";
/** Separator between the site name and the dataset's own title. */
const SITE_NAME_SEPARATOR = " – ";

let interfaceLanguageObserver = null;

/**
 * Reads the dataset title exactly as the heading shows it right now.
 * The translation handler fills the title from its language key after the heading is
 * built, so the loaded dictionary is the truthful source; the element's own text is the
 * answer only while no translated copy exists for that key.
 */
function readDatasetTitleAsShown(datasetTitleElement) {
    return readTranslatedLabelOrEmpty(datasetTitleElement.dataset.langKey || "")
        || String(datasetTitleElement.textContent || "").trim();
}

/**
 * Writes the site name in front of one already built heading, or removes it when the
 * dataset's own title already opens with that name.
 * Safe to run again on the same heading: it is how a language change is answered.
 *
 * @param {Element|null} titleElement The heading built by createDatasetHeadingTitle.
 */
export function writeSiteNameIntoDatasetHeading(titleElement) {
    const datasetTitleElement = titleElement?.querySelector?.(`.${DATASET_TITLE_CLASS}`);
    if (!datasetTitleElement) {
        return;
    }

    titleElement.querySelector(`.${SITE_NAME_CLASS}`)?.remove();
    titleElement.querySelector(`.${SITE_NAME_SEPARATOR_CLASS}`)?.remove();

    const siteName = formatSiteNameForDisplay(getCurrentSiteName());
    if (!siteName
        || titleAlreadyOpensWithSiteName(readDatasetTitleAsShown(datasetTitleElement), siteName)) {
        return;
    }

    const siteTitle = document.createElement("span");
    siteTitle.classList.add(SITE_NAME_CLASS);
    siteTitle.textContent = siteName;

    const titleSeparator = document.createElement("span");
    titleSeparator.classList.add(SITE_NAME_SEPARATOR_CLASS);
    titleSeparator.textContent = SITE_NAME_SEPARATOR;

    titleElement.prepend(siteTitle, titleSeparator);
}

/** Re-decides every heading currently on the page. A removed heading is simply not found. */
function rewriteMountedDatasetHeadings() {
    document
        .querySelectorAll(`.${DATASET_HEADING_TITLE_CLASS}`)
        .forEach((titleElement) => writeSiteNameIntoDatasetHeading(titleElement));
}

/**
 * Subscribes this module to the interface language, which is the only boundary that can
 * change the answer: a title may repeat the site name in one language and not in another.
 * The translation handler publishes the new language on the document element after it has
 * loaded that dictionary, so one observer for the whole page is enough. Safe to call more
 * than once.
 */
function startDatasetHeadingLanguageOwnership() {
    if (interfaceLanguageObserver || typeof MutationObserver === "undefined") {
        return;
    }
    interfaceLanguageObserver = new MutationObserver(rewriteMountedDatasetHeadings);
    interfaceLanguageObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["lang"],
    });
}

/**
 * Builds the dataset heading for one dataset.
 * The dataset's own title carries its language key so the translation handler keeps
 * filling it, while this module owns whether the site name belongs in front of it.
 *
 * @param {string} tableName Dataset the heading describes.
 * @param {string} [headerTitleOverride] Administrator-owned title shown until translated copy arrives.
 * @returns {HTMLHeadingElement} The heading element.
 */
export function createDatasetHeadingTitle(tableName, headerTitleOverride = "") {
    const titleElement = document.createElement("h1");
    titleElement.classList.add(DATASET_HEADING_TITLE_CLASS);

    const datasetTitle = document.createElement("span");
    datasetTitle.classList.add(DATASET_TITLE_CLASS);
    datasetTitle.dataset.langKey = `${tableName}_front_page`;
    datasetTitle.textContent = headerTitleOverride || tableName;
    titleElement.appendChild(datasetTitle);

    writeSiteNameIntoDatasetHeading(titleElement);
    startDatasetHeadingLanguageOwnership();

    return titleElement;
}

/** Test-only reset of the language subscription this module keeps between headings. */
export function resetDatasetHeadingTitleOwnershipForTests() {
    interfaceLanguageObserver?.disconnect();
    interfaceLanguageObserver = null;
}
