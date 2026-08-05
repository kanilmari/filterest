// results_count_printer.test.js
// Verifies legacy and split intelligent-search count rendering in jsdom.
// Bridges the shared results-count renderer with primary and mirrored count hosts.
// Exists to prevent regressions when search UIs show separate text and AI result totals.
// @vitest-environment jsdom

import { describe, expect, test } from "vitest";
import { setResultsCount } from "./results_count_printer.js";

describe("setResultsCount", () => {
    test("renders the legacy numeric count unchanged", () => {
        document.documentElement.lang = "en";
        document.body.innerHTML = `
            <div id="tasks_results_count"></div>
            <div data-results-count-for="tasks"></div>
        `;

        setResultsCount("tasks", 3);

        const primary = document.getElementById("tasks_results_count");
        const mirror = document.querySelector('[data-results-count-for="tasks"]');

        expect(primary.textContent).toBe("3 results");
        expect(primary.querySelector('[data-lang-key="results"]')).toBeNull();
        expect(primary.classList.contains("results-count--search-breakdown")).toBe(false);
        expect(mirror.textContent).toBe("3 results");
    });

    test("renders Finnish legacy counts with partitive plural", () => {
        document.documentElement.lang = "fi";
        document.body.innerHTML = `<div id="tasks_results_count"></div>`;

        setResultsCount("tasks", 5);

        const primary = document.getElementById("tasks_results_count");
        expect(primary.textContent).toBe("5 tulosta");
        expect(primary.querySelector('[data-lang-key="results"]')).toBeNull();
    });

    test("renders Finnish legacy singular count", () => {
        document.documentElement.lang = "fi";
        document.body.innerHTML = `<div id="tasks_results_count"></div>`;

        setResultsCount("tasks", 1);

        const primary = document.getElementById("tasks_results_count");
        expect(primary.textContent).toBe("1 tulos");
        expect(primary.querySelector('[data-lang-key="result"]')).toBeNull();
    });

    test("renders separate text and AI counts for intelligent search", () => {
        document.documentElement.lang = "fi";
        document.body.innerHTML = `
            <div id="tasks_results_count"></div>
            <div data-results-count-for="tasks"></div>
        `;

        setResultsCount("tasks", {
            mode: "search-breakdown",
            textCount: 3,
            aiCount: 10,
        });

        const primary = document.getElementById("tasks_results_count");
        const mirror = document.querySelector('[data-results-count-for="tasks"]');
        const items = primary.querySelectorAll(".results-count-breakdown-item");

        expect(primary.classList.contains("results-count--search-breakdown")).toBe(true);
        expect(primary.textContent).toBe("3 tulosta tekstihaulla + 10 tulosta tekoälyhaulla");
        expect(items).toHaveLength(2);
        expect(items[0].textContent).toContain("3");
        expect(items[0].querySelector(".results-count-breakdown-label")?.textContent).toBe("tulosta tekstihaulla");
        expect(items[1].textContent).toContain("10");
        expect(items[1].querySelector(".results-count-breakdown-label")?.textContent).toBe("tulosta tekoälyhaulla");
        expect(primary.querySelector('[data-lang-key="results"]')).toBeNull();
        expect(mirror.textContent).toBe(primary.textContent);
    });

    test("uses singular phrasing when the text-search count is one", () => {
        document.documentElement.lang = "fi";
        document.body.innerHTML = `<div id="tasks_results_count"></div>`;

        setResultsCount("tasks", {
            mode: "search-breakdown",
            textCount: 1,
            aiCount: 0,
        });

        const primary = document.getElementById("tasks_results_count");
        expect(primary.textContent).toBe("1 tulos tekstihaulla + 0 tulosta tekoälyhaulla");
        expect(primary.querySelector(".results-count-breakdown-label")?.textContent).toBe("tulos tekstihaulla");
    });
});
