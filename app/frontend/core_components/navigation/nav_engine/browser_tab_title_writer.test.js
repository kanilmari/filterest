// @vitest-environment jsdom
// browser_tab_title_writer.test.js
// Verifies that one owner titles the browser tab for every settled application state.
// Bridges translated dataset copy, the open article's own heading and the site identity
// with the document.title a person reads on the browser tab.
// Exists because the server only titles the initial HTML, so an unowned tab kept
// describing whatever was last fully loaded.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const translations = new Map();
let translationsLoaded = true;

vi.mock("../../lang/translation_handler.js", () => ({
    hasLoadedTranslations: () => translationsLoaded,
    getTranslationForKey: (key, { fallback = "" } = {}) => (
        translations.has(key) ? translations.get(key) : fallback
    ),
    readTranslatedLabelOrEmpty: (key) => (
        translationsLoaded && translations.has(key)
            ? String(translations.get(key)).trim()
            : ""
    ),
}));

async function loadTitleWriter() {
    const module = await import("./browser_tab_title_writer.js");
    module.resetBrowserTabTitleOwnershipForTests();
    return module;
}

function mountDataset(datasetName, { articleHeading = "" } = {}) {
    document.body.innerHTML = `
        <div id="${datasetName}_container" class="content_div">
            <div class="card_view_wrapper${articleHeading ? " big-card-open" : ""}">
                ${articleHeading
                    ? `<article class="active_row_article">
                           <div class="big_card_header">
                               <span class="big_card_header_value">${articleHeading}</span>
                           </div>
                       </article>`
                    : ""}
            </div>
        </div>
    `;
}

describe("browser tab title ownership", () => {
    beforeEach(() => {
        vi.resetModules();
        translations.clear();
        translationsLoaded = true;
        localStorage.clear();
        sessionStorage.clear();
        document.head.innerHTML =
            '<meta property="og:site_name" content="fintravel.fi">';
        document.body.innerHTML = "";
        document.title = "Privacy policy — About — fintravel.fi";
        localStorage.setItem(
            "table_specs",
            JSON.stringify({ travel_deals: { display_name: "Travel deals" } })
        );
        window.history.replaceState({}, "", "/travel_deals");
    });

    afterEach(async () => {
        const module = await import("./browser_tab_title_writer.js");
        module.resetBrowserTabTitleOwnershipForTests();
    });

    test("joins the parts the way the server builds the first-load title", async () => {
        const { composeBrowserTabTitle } = await loadTitleWriter();

        expect(composeBrowserTabTitle({
            articleTitle: "Sunset in Lapland",
            datasetTitle: "Travel deals",
            siteName: "fintravel.fi",
        })).toBe("Sunset in Lapland — Travel deals — fintravel.fi");

        expect(composeBrowserTabTitle({
            datasetTitle: "Travel deals",
            siteName: "fintravel.fi",
        })).toBe("Travel deals — fintravel.fi");

        expect(composeBrowserTabTitle({ siteName: "fintravel.fi" }))
            .toBe("fintravel.fi");
    });

    test("names the site once when the dataset title already opens with it", async () => {
        const { composeBrowserTabTitle } = await loadTitleWriter();

        expect(composeBrowserTabTitle({
            datasetTitle: "Serlog.com – Service catalog",
            siteName: "Serlog.com",
        })).toBe("Serlog.com – Service catalog");

        expect(composeBrowserTabTitle({
            articleTitle: "Cleaning service",
            datasetTitle: "serlog.com: Service catalog",
            siteName: "Serlog.com",
        })).toBe("Cleaning service — serlog.com: Service catalog");

        // A site name in the middle of the title is not a repetition.
        expect(composeBrowserTabTitle({
            datasetTitle: "Service catalog of Serlog.com",
            siteName: "Serlog.com",
        })).toBe("Service catalog of Serlog.com — Serlog.com");
    });

    test("keeps the site name beside a dataset title in the language that does not repeat it", async () => {
        translations.set("travel_deals_front_page", "fintravel.fi – Matkatarjoukset");
        mountDataset("travel_deals");
        const { updateBrowserTabTitle } = await loadTitleWriter();

        await updateBrowserTabTitle({ dataset: "travel_deals" });
        expect(document.title).toBe("fintravel.fi – Matkatarjoukset");

        translations.set("travel_deals_front_page", "Travel deals");
        await updateBrowserTabTitle({ dataset: "travel_deals" });

        expect(document.title).toBe("Travel deals — fintravel.fi");
    });

    test("replaces a title left behind by another dataset", async () => {
        translations.set("travel_deals_front_page", "Matkatarjoukset");
        mountDataset("travel_deals");
        const { updateBrowserTabTitle } = await loadTitleWriter();

        await updateBrowserTabTitle({ dataset: "travel_deals" });

        expect(document.title).toBe("Matkatarjoukset — fintravel.fi");
    });

    test("follows the interface language instead of the raw dataset name", async () => {
        translations.set("travel_deals_front_page", "旅行优惠");
        mountDataset("travel_deals");
        const { updateBrowserTabTitle } = await loadTitleWriter();

        await updateBrowserTabTitle({ dataset: "travel_deals" });

        expect(document.title).toBe("旅行优惠 — fintravel.fi");
    });

    test("names the open article and drops it again when the article closes", async () => {
        translations.set("travel_deals_front_page", "Travel deals");
        mountDataset("travel_deals", { articleHeading: "Sunset in Lapland" });
        window.history.replaceState({}, "", "/travel_deals/12-sunset-in-lapland");
        const { updateBrowserTabTitle } = await loadTitleWriter();

        await updateBrowserTabTitle({ dataset: "travel_deals" });
        expect(document.title).toBe(
            "Sunset in Lapland — Travel deals — fintravel.fi"
        );

        mountDataset("travel_deals");
        window.history.replaceState({}, "", "/travel_deals");
        await updateBrowserTabTitle({ dataset: "travel_deals" });

        expect(document.title).toBe("Travel deals — fintravel.fi");
    });

    test("retitles from an article open or close event without a navigation call", async () => {
        translations.set("travel_deals_front_page", "Travel deals");
        mountDataset("travel_deals");
        const { updateBrowserTabTitle } = await loadTitleWriter();
        await updateBrowserTabTitle({ dataset: "travel_deals" });

        mountDataset("travel_deals", { articleHeading: "Sunset in Lapland" });
        document.dispatchEvent(new CustomEvent("row-article-toggle", {
            detail: { tableName: "travel_deals", isOpen: true },
        }));
        await Promise.resolve();
        await Promise.resolve();

        expect(document.title).toBe(
            "Sunset in Lapland — Travel deals — fintravel.fi"
        );
    });

    test("ignores a stale answer about a dataset the person already left", async () => {
        translations.set("travel_deals_front_page", "Travel deals");
        translations.set("system_about_front_page", "About");
        mountDataset("travel_deals");
        const { updateBrowserTabTitle } = await loadTitleWriter();
        await updateBrowserTabTitle({ dataset: "travel_deals" });
        expect(document.title).toBe("Travel deals — fintravel.fi");

        // A slow load of the earlier dataset finishes after the person moved on.
        await updateBrowserTabTitle({ dataset: "system_about" });

        expect(document.title).toBe("Travel deals — fintravel.fi");
    });

    test("only the newest request of one transition writes the title", async () => {
        translations.set("travel_deals_front_page", "Travel deals");
        mountDataset("travel_deals");
        const { updateBrowserTabTitle } = await loadTitleWriter();

        const [staleWrote, freshWrote] = await Promise.all([
            updateBrowserTabTitle({ dataset: "travel_deals" }),
            updateBrowserTabTitle({ dataset: "travel_deals" }),
        ]);

        expect(staleWrote).toBe(false);
        expect(freshWrote).toBe(true);
        expect(document.title).toBe("Travel deals — fintravel.fi");
    });

    test("keeps the server's title while translated copy is still missing", async () => {
        translationsLoaded = false;
        mountDataset("travel_deals");
        const serverTitle = document.title;
        const { updateBrowserTabTitle } = await loadTitleWriter();

        await updateBrowserTabTitle({ dataset: "travel_deals" });

        expect(document.title).toBe(serverTitle);
    });

    test("falls back to the readable dataset name the server would also use", async () => {
        localStorage.setItem("table_specs", JSON.stringify({ travel_deals: {} }));
        mountDataset("travel_deals");
        const { updateBrowserTabTitle, humanizeDatasetNameForTitle } =
            await loadTitleWriter();

        await updateBrowserTabTitle({ dataset: "travel_deals" });

        expect(humanizeDatasetNameForTitle("travel_deals")).toBe("Travel Deals");
        expect(document.title).toBe("Travel Deals — fintravel.fi");
    });

    test("gives an administrator page and an unknown view only the site name", async () => {
        const { updateBrowserTabTitle, readBrowserTabTitleDatasetName } =
            await loadTitleWriter();

        expect(readBrowserTabTitleDatasetName("/admin/permissions")).toBe("");
        expect(readBrowserTabTitleDatasetName("/")).toBe("");

        window.history.replaceState({}, "", "/admin/permissions");
        await updateBrowserTabTitle({ dataset: null });

        expect(document.title).toBe("fintravel.fi");
    });
});
