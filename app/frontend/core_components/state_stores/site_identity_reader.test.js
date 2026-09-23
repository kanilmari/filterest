// @vitest-environment jsdom
// site_identity_reader.test.js
// Verifies browser UI components receive one trimmed, administrator-owned site name.
// Bridges server-rendered metadata fallbacks with deterministic frontend unit fixtures.
// Exists to keep dynamic site identity out of translated and hardcoded component copy.

import { beforeEach, describe, expect, test } from "vitest";
import {
    formatSiteNameForDisplay,
    getCurrentSiteName,
    titleAlreadyOpensWithSiteName,
} from "./site_identity_reader.js";

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
    test.each([
        ["Serlog.com – Service catalog", "Serlog.com", true],
        ["Serlog.com - Service catalog", "Serlog.com", true],
        ["serlog.com — service catalog", "Serlog.com", true],
        ["Serlog.com: Service catalog", "Serlog.com", true],
        ["Serlog.com | Service catalog", "Serlog.com", true],
        ["Serlog.com Service catalog", "Serlog.com", true],
        ["  Serlog.com – Service catalog  ", "  Serlog.com  ", true],
        ["Serlog.com", "Serlog.com", true],
        ["Serlog.com – 服务目录", "Serlog.com", true],
    ])("treats %j as already naming %j", (title, siteName, expected) => {
        expect(titleAlreadyOpensWithSiteName(title, siteName)).toBe(expected);
    });

    test.each([
        ["Service catalog", "Serlog.com", false],
        ["Service catalog of Serlog.com", "Serlog.com", false],
        ["Palveluhakemisto – Serlog.com – tiedot", "Serlog.com", false],
        ["Serlogistics catalog", "Serlog", false],
        ["Serlog.commerce", "Serlog.com", false],
        ["", "Serlog.com", false],
        ["Service catalog", "", false],
        [undefined, undefined, false],
    ])("leaves %j alone beside %j", (title, siteName, expected) => {
        expect(titleAlreadyOpensWithSiteName(title, siteName)).toBe(expected);
    });
});
