// @vitest-environment jsdom
// Verifies safe URL discovery inside ordinary user-facing text.

import { describe, expect, test } from "vitest";

import {
    appendTextWithHttpLinks,
    linkifyHttpTextNodes,
} from "./http_text_linkifier.js";

describe("HTTP text linkifier", () => {
    test("links multiple absolute addresses while preserving surrounding text", () => {
        const container = document.createElement("p");
        appendTextWithHttpLinks(
            container,
            "Read https://example.test/one, then http://example.test/two.",
        );

        const links = container.querySelectorAll("a");
        expect(links).toHaveLength(2);
        expect(links[0].getAttribute("href")).toBe("https://example.test/one");
        expect(links[1].getAttribute("href")).toBe("http://example.test/two");
        expect(container.textContent).toBe(
            "Read https://example.test/one, then http://example.test/two.",
        );
        expect(links[0].getAttribute("target")).toBe("_blank");
        expect(links[0].getAttribute("rel")).toBe("noopener noreferrer");
    });

    test("leaves unsafe schemes and relative paths as text", () => {
        const container = document.createElement("p");
        appendTextWithHttpLinks(container, "javascript:alert(1) /internal/path");

        expect(container.querySelector("a")).toBeNull();
        expect(container.textContent).toBe("javascript:alert(1) /internal/path");
    });

    test("linkifies safe rendered text without nesting links", () => {
        const container = document.createElement("div");
        container.innerHTML = '<strong>See https://example.test/docs</strong> <a href="https://already.test">https://already.test</a>';

        linkifyHttpTextNodes(container);

        expect(container.querySelectorAll("a")).toHaveLength(2);
        expect(container.querySelector("strong a")?.getAttribute("href"))
            .toBe("https://example.test/docs");
        expect(container.querySelector("a a")).toBeNull();
    });
});
