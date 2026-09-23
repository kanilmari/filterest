// main_tab_lang_keys.test.js
// Verifies that one place decides which language key a main navigation tab prints.
// Bridges the tab bar's own labels with every surface that must name the same tab,
// above all the browser tab title.
// Exists because a tab whose label key differs from its name would otherwise be named
// one way in the interface and another way on the browser tab.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { getMainTabLangKey } from "./main_tab_lang_keys.js";
import { staticTabsData } from "./main_dataset_tabs.js";

// The server answers the same question for a first-load page title, so both sides are
// checked against one example set. Its twin reader is
// TestMainTabLangKeyMatchesTheSharedExamples in
// app/backend/core_components/router/seo_meta_builder_test.go.
const sharedTitleExamples = JSON.parse(readFileSync(
    resolve(
        dirname(fileURLToPath(import.meta.url)),
        "../../../../testing/shared_contracts/site_name_in_title_examples.json"
    ),
    "utf8"
));

describe("getMainTabLangKey", () => {
    test.each(sharedTitleExamples.mainTabLangKey.map(
        ({ why, tabIdentity, expected }) => [why, tabIdentity, expected]
    ))("answers the same key as the server: %s", (_why, tabIdentity, expected) => {
        expect(getMainTabLangKey(tabIdentity)).toBe(expected);
    });

    // Only this side can be handed a missing value at all; the shared examples are text.
    test("answers nothing for a missing tab identity", () => {
        expect(getMainTabLangKey(undefined)).toBe("");
        expect(getMainTabLangKey(null)).toBe("");
    });

    test("is the one source the static tabs are labelled from", () => {
        staticTabsData.forEach((tab) => {
            expect(tab.langKey).toBe(getMainTabLangKey(tab.id));
        });
    });
});
