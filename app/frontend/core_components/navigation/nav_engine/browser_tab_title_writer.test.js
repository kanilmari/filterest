// @vitest-environment jsdom
// browser_tab_title_writer.test.js
// Verifies that one owner titles the browser tab for every settled application state.
// Bridges the application tab's own label, the open article's heading and the site identity
// with the document.title a person reads on the browser tab.
// Exists because the server only titles the initial HTML, so an unowned tab kept
// describing whatever was last fully loaded.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// The same composed titles the server is checked against, so the two sides cannot drift.
// Its twin reader is TestComposeBrowserTabTitleMatchesTheSharedExamples in
// app/backend/core_components/router/seo_meta_builder_test.go.
const sharedTitleExamples = JSON.parse(readFileSync(
    resolve(
        dirname(fileURLToPath(import.meta.url)),
        "../../../../testing/shared_contracts/site_name_in_title_examples.json"
    ),
    "utf8"
));

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

    test.each(sharedTitleExamples.composeBrowserTabTitle.map(
        ({ why, articleTitle, tabTitle, siteName, expected }) => [
            why, articleTitle, tabTitle, siteName, expected,
        ]
    ))("composes the same title as the server: %s", async (
        _why, articleTitle, tabTitle, siteName, expected
    ) => {
        const { composeBrowserTabTitle } = await loadTitleWriter();

        expect(composeBrowserTabTitle({ articleTitle, tabTitle, siteName }))
            .toBe(expected);
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
        // Neither the tab label key nor the front page key is translated here.
        localStorage.setItem("table_specs", JSON.stringify({ travel_deals: {} }));
        mountDataset("travel_deals");
        const { updateBrowserTabTitle } = await loadTitleWriter();

        await updateBrowserTabTitle({ dataset: "travel_deals" });

        expect(document.title).toBe("Travel Deals — fintravel.fi");
    });

    test.each(sharedTitleExamples.humanizeDatasetNameForTitle.map(
        ({ datasetName, expected }) => [datasetName, expected]
    ))("reads %j the same way the server does", async (datasetName, expected) => {
        const { humanizeDatasetNameForTitle } = await loadTitleWriter();

        expect(humanizeDatasetNameForTitle(datasetName)).toBe(expected);
    });

    test("opens with the label the application's own tab shows for the dataset", async () => {
        // The tab bar prints the dataset's own name as its language key; the front page
        // key is the large heading on the page and must not win the browser tab.
        translations.set("travel_deals", "Travel deals");
        translations.set("travel_deals_front_page", "fintravel.fi – Travel deals");
        mountDataset("travel_deals");
        const { updateBrowserTabTitle } = await loadTitleWriter();

        await updateBrowserTabTitle({ dataset: "travel_deals" });

        expect(document.title).toBe("Travel deals — fintravel.fi");
    });

    test("opens with the article's own title and gives the tab label back on close", async () => {
        translations.set("travel_deals", "Travel deals");
        translations.set("travel_deals_front_page", "fintravel.fi – Travel deals");
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

    test("uses the key the people tab prints instead of its dataset name", async () => {
        translations.set("users", "Users");
        translations.set("system_users", "Never shown on the tab");
        localStorage.setItem("table_specs", JSON.stringify({ system_users: {} }));
        mountDataset("system_users");
        window.history.replaceState({}, "", "/system_users");
        const { updateBrowserTabTitle } = await loadTitleWriter();

        await updateBrowserTabTitle({ dataset: "system_users" });

        expect(document.title).toBe("Users — fintravel.fi");
    });

    test("names an administrator page and the account view after their own tabs", async () => {
        translations.set("permissions", "Permissions");
        translations.set("account", "Account");
        const { updateBrowserTabTitle, readBrowserTabIdentity } =
            await loadTitleWriter();

        expect(readBrowserTabIdentity("/admin/permissions"))
            .toEqual({ name: "permissions", isDataset: false });

        window.history.replaceState({}, "", "/admin/permissions");
        await updateBrowserTabTitle({ dataset: null });
        expect(document.title).toBe("Permissions — fintravel.fi");

        window.history.replaceState({}, "", "/user");
        await updateBrowserTabTitle({ dataset: null });
        expect(document.title).toBe("Account — fintravel.fi");
    });

    test("names the tab the site root reopened, which the address itself cannot say", async () => {
        // Opening https://<site>/ opens a dataset tab and the tab bar shows its label,
        // while the address itself still names nothing.
        translations.set("travel_deals", "Travel deals");
        sessionStorage.setItem("selected_dataset", "travel_deals");
        mountDataset("travel_deals");
        window.history.replaceState({}, "", "/");
        const { updateBrowserTabTitle, readBrowserTabIdentity } =
            await loadTitleWriter();

        expect(readBrowserTabIdentity("/"))
            .toEqual({ name: "travel_deals", isDataset: true });

        await updateBrowserTabTitle({ dataset: "travel_deals" });

        expect(document.title).toBe("Travel deals — fintravel.fi");
    });

    test("leaves the site root with the bare site name when no tab was restored", async () => {
        const { updateBrowserTabTitle, readBrowserTabIdentity } =
            await loadTitleWriter();

        expect(readBrowserTabIdentity("/")).toEqual({ name: "", isDataset: false });

        window.history.replaceState({}, "", "/");
        await updateBrowserTabTitle({ dataset: null });

        expect(document.title).toBe("fintravel.fi");
    });

    test("leaves an untranslated view with the bare site name it had before", async () => {
        const { updateBrowserTabTitle, readBrowserTabTitleDatasetName } =
            await loadTitleWriter();

        expect(readBrowserTabTitleDatasetName("/admin/permissions")).toBe("");
        expect(readBrowserTabTitleDatasetName("/")).toBe("");

        window.history.replaceState({}, "", "/admin/an_unnamed_tool");
        await updateBrowserTabTitle({ dataset: null });

        expect(document.title).toBe("fintravel.fi");
    });
});
