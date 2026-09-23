// @vitest-environment jsdom
// site_identity_reader.test.js
// Verifies browser UI components receive one trimmed, administrator-owned site name.
// Bridges server-rendered metadata fallbacks with deterministic frontend unit fixtures.
// Exists to keep dynamic site identity out of translated and hardcoded component copy.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, test } from "vitest";
import {
    formatSiteNameForDisplay,
    getCurrentSiteName,
    titleAlreadyOpensWithSiteName,
} from "./site_identity_reader.js";

// One example set for both implementations of this rule. Its twin reader is
// TestTitleAlreadyOpensWithSiteNameMatchesTheSharedExamples in
// app/backend/core_components/router/seo_meta_builder_test.go, so a change here that the
// server does not follow fails a test instead of reaching a person's browser tab.
const sharedTitleExamples = JSON.parse(readFileSync(
    resolve(
        dirname(fileURLToPath(import.meta.url)),
        "../../../testing/shared_contracts/site_name_in_title_examples.json"
    ),
    "utf8"
));

describe("getCurrentSiteName", () => {
    beforeEach(() => {
        document.head.innerHTML = "";
        document.body.innerHTML = "";
    });

    test("prefers the server-rendered Open Graph site identity", () => {
        document.head.innerHTML = '<meta property="og:site_name" content="  Filt  ">';
        document.body.innerHTML = '<div class="navbar-site-identity">Fallback</div>';

        expect(getCurrentSiteName()).toBe("Filt");
    });

    test("falls back safely to the navbar identity", () => {
        document.body.innerHTML = '<div class="navbar-site-identity"> Filterest </div>';

        expect(getCurrentSiteName()).toBe("Filterest");
    });

    test("returns an empty identity when the application shell has neither source", () => {
        expect(getCurrentSiteName()).toBe("");
    });
});

describe("formatSiteNameForDisplay", () => {
    test.each([
        ["filt", "Filt"],
        ["  serlog.com  ", "Serlog.com"],
        ["Filterest", "Filterest"],
        ["筛选器 Filterest", "筛选器 Filterest"],
        ["", ""],
    ])("normalizes %j without translating it", (siteName, expected) => {
        expect(formatSiteNameForDisplay(siteName)).toBe(expected);
    });
});

describe("titleAlreadyOpensWithSiteName", () => {
    test.each(sharedTitleExamples.titleAlreadyOpensWithSiteName.map(
        ({ title, siteName, expected }) => [title, siteName, expected]
    ))("answers %j beside %j the way the server does", (title, siteName, expected) => {
        expect(titleAlreadyOpensWithSiteName(title, siteName)).toBe(expected);
    });

    // Only this side can be handed a missing value at all; the shared examples are text.
    test("treats a missing title or site name as no repetition", () => {
        expect(titleAlreadyOpensWithSiteName(undefined, undefined)).toBe(false);
        expect(titleAlreadyOpensWithSiteName(null, "Serlog.com")).toBe(false);
    });
});
