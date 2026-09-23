// @vitest-environment jsdom
// dataset_heading_title_writer.test.js
// Verifies the dataset heading names the site once, in every interface language.
// Bridges the administrator-owned site identity and translated dataset titles with the
// heading element the filterbar's hero shows.
// Exists because a stored title such as "Serlog.com – Service catalog" made the heading
// read "Serlog.com – Serlog.com – Service catalog".

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const translations = new Map();
let translationsLoaded = true;

vi.mock("../lang/translation_handler.js", () => ({
    readTranslatedLabelOrEmpty: (key) => (
        translationsLoaded && translations.has(key)
            ? String(translations.get(key)).trim()
            : ""
    ),
}));

async function loadDatasetHeadingTitleWriter() {
    const module = await import("./dataset_heading_title_writer.js");
    module.resetDatasetHeadingTitleOwnershipForTests();
    return module;
}

function readHeadingParts(titleElement) {
    return {
        siteName: titleElement.querySelector(".morphing-title__site-name")?.textContent ?? null,
        separator: titleElement.querySelector(".morphing-title__separator")?.textContent ?? null,
        datasetTitle: titleElement.querySelector(".morphing-title__dataset-name")?.textContent ?? null,
        wholeHeading: titleElement.textContent,
    };
}

/** Announces a new interface language the way the translation handler does. */
async function switchInterfaceLanguage(language) {
    document.documentElement.setAttribute("lang", language);
    await Promise.resolve();
}

describe("dataset heading title", () => {
    beforeEach(() => {
        vi.resetModules();
        translations.clear();
        translationsLoaded = true;
        document.head.innerHTML =
            '<meta property="og:site_name" content="Serlog.com">';
        document.body.innerHTML = "";
        document.documentElement.setAttribute("lang", "en");
    });

    afterEach(async () => {
        const module = await import("./dataset_heading_title_writer.js");
        module.resetDatasetHeadingTitleOwnershipForTests();
    });

    test("names the site once when the dataset title already opens with it", async () => {
        translations.set("app_service_catalog_front_page", "Serlog.com – Service catalog");
        const { createDatasetHeadingTitle } = await loadDatasetHeadingTitleWriter();

        const heading = createDatasetHeadingTitle("app_service_catalog", "Service catalog");

        expect(readHeadingParts(heading)).toMatchObject({
            siteName: null,
            separator: null,
            datasetTitle: "Service catalog",
        });
        // The translation handler fills the dataset title from its language key.
        heading.querySelector(".morphing-title__dataset-name").textContent =
            "Serlog.com – Service catalog";
        expect(heading.textContent).toBe("Serlog.com – Service catalog");
    });

    test("writes the site name in front of a dataset title that does not repeat it", async () => {
        translations.set("app_events_front_page", "Events");
        const { createDatasetHeadingTitle } = await loadDatasetHeadingTitleWriter();

        const heading = createDatasetHeadingTitle("app_events", "Events");

        expect(readHeadingParts(heading)).toMatchObject({
            siteName: "Serlog.com",
            separator: " – ",
            datasetTitle: "Events",
        });
        expect(heading.textContent).toBe("Serlog.com – Events");
        expect(
            heading.querySelector(".morphing-title__site-name").hasAttribute("data-lang-key")
        ).toBe(false);
        expect(
            heading.querySelector(".morphing-title__dataset-name").dataset.langKey
        ).toBe("app_events_front_page");
    });

    test("keeps the site name when the dataset title only mentions it in the middle", async () => {
        translations.set("app_events_front_page", "Events of Serlog.com");
        const { createDatasetHeadingTitle } = await loadDatasetHeadingTitleWriter();

        const heading = createDatasetHeadingTitle("app_events", "Events");

        expect(readHeadingParts(heading).siteName).toBe("Serlog.com");
        // The translation handler fills the dataset title from its language key.
        heading.querySelector(".morphing-title__dataset-name").textContent =
            "Events of Serlog.com";
        expect(heading.textContent).toBe("Serlog.com – Events of Serlog.com");
    });

    test("re-decides when the interface language changes the dataset title", async () => {
        translations.set("app_service_catalog_front_page", "Serlog.com – Service catalog");
        const { createDatasetHeadingTitle } = await loadDatasetHeadingTitleWriter();

        const heading = createDatasetHeadingTitle("app_service_catalog", "Service catalog");
        document.body.appendChild(heading);
        expect(readHeadingParts(heading).siteName).toBeNull();

        // Finnish names the dataset without repeating the site name.
        translations.set("app_service_catalog_front_page", "Palveluhakemisto");
        await switchInterfaceLanguage("fi");

        expect(readHeadingParts(heading)).toMatchObject({
            siteName: "Serlog.com",
            separator: " – ",
        });

        translations.set("app_service_catalog_front_page", "Serlog.com – Service catalog");
        await switchInterfaceLanguage("en");

        expect(readHeadingParts(heading).siteName).toBeNull();
        expect(heading.querySelectorAll(".morphing-title__separator")).toHaveLength(0);
    });

    test("leaves the heading unbranded when the application shell has no site identity", async () => {
        document.head.innerHTML = "";
        const { createDatasetHeadingTitle } = await loadDatasetHeadingTitleWriter();

        const heading = createDatasetHeadingTitle("app_events", "Events");

        expect(readHeadingParts(heading)).toMatchObject({
            siteName: null,
            separator: null,
            datasetTitle: "Events",
        });
    });

    test("decides from the built-in title until translated copy is available", async () => {
        translationsLoaded = false;
        const { createDatasetHeadingTitle, writeSiteNameIntoDatasetHeading } =
            await loadDatasetHeadingTitleWriter();

        const heading = createDatasetHeadingTitle(
            "app_service_catalog",
            "Serlog.com – Service catalog"
        );
        expect(readHeadingParts(heading).siteName).toBeNull();

        const unbrandedHeading = createDatasetHeadingTitle("app_events", "Events");
        expect(readHeadingParts(unbrandedHeading).siteName).toBe("Serlog.com");

        // Once translations arrive, the language key wins over the built-in title.
        translationsLoaded = true;
        translations.set("app_events_front_page", "Serlog.com – Events");
        writeSiteNameIntoDatasetHeading(unbrandedHeading);
        expect(readHeadingParts(unbrandedHeading).siteName).toBeNull();
    });
});
