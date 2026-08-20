// @vitest-environment jsdom
// big_card_ui_handler.test.js
// Verifies article-view label helpers render metadata-driven icons safely.
// Bridges row-article field labels and the shared card-detail icon registry.
// Exists so field label icons stay visible when article/detail layouts evolve.

import { describe, expect, test, vi } from "vitest";
import { DATE_TIME_DISPLAY_SEPARATOR } from "../timestamp_display_formatter.js";

function displayDateTime(dateText, timeText) {
    return `${dateText}${DATE_TIME_DISPLAY_SEPARATOR}${timeText}`;
}

vi.mock("../../dev_tools/function_counter.js", () => ({
    count_this_function: vi.fn(),
}));

vi.mock("../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js", () => ({
    setUnifiedTableState: vi.fn(),
}));

import {
    createRowArticleKeyValueElement,
    createRowArticleLinkTwoLine,
    createRowArticleNavigableElement,
    dispatchCardArticleToggle,
} from "./big_card_ui_handler.js";

describe("big_card_ui_handler label icons", () => {
    test("createRowArticleKeyValueElement renders a configured field icon before label text", () => {
        const element = createRowArticleKeyValueElement(
            "Website",
            "https://example.test",
            "website",
            false,
            "big_card_detail_value",
            true,
            null,
            "https://example.test",
            { card_detail_icon_key: "link" },
        );

        const label = element.querySelector(".two_line_label");
        const icon = label?.querySelector(".two_line_label_icon");
        const svg = icon?.querySelector(".card_detail_row_icon_svg");
        const labelText = label?.querySelector(".two_line_label_text");

        expect(label?.classList.contains("two_line_label--with-icon")).toBe(true);
        expect(icon?.getAttribute("aria-hidden")).toBe("true");
        expect(svg).not.toBeNull();
        expect(labelText?.dataset.langKey).toBe("website");
        expect(labelText?.textContent).toBe("Website");
        expect(element.querySelector('.two_line_value a')?.getAttribute('href'))
            .toBe('https://example.test');
    });

    test("createRowArticleKeyValueElement links an address inside ordinary text", () => {
        const element = createRowArticleKeyValueElement(
            "Description",
            "More at https://example.test/details.",
            "description",
            false,
            "big_description_value",
            true,
        );

        const value = element.querySelector('[data-column="description"]');
        expect(value?.querySelector('a')?.getAttribute('href'))
            .toBe('https://example.test/details');
        expect(value?.textContent).toBe('More at https://example.test/details.');
    });

    test("createRowArticleKeyValueElement gives unconfigured detail labels a generic icon", () => {
        const element = createRowArticleKeyValueElement(
            "Omistava tiimi",
            "Käyttöoikeustiimi",
            "owning_team",
            false,
            "big_card_detail_value",
            true,
        );

        const label = element.querySelector(".two_line_label");
        const svg = label?.querySelector(".two_line_label_icon .card_detail_row_icon_svg");

        expect(label?.classList.contains("two_line_label--with-icon")).toBe(true);
        expect(svg).not.toBeNull();
        expect(label?.querySelector(".two_line_label_text")?.textContent).toBe("Omistava tiimi");
    });

    test("createRowArticleKeyValueElement hides timestamp seconds and preserves them as hover text", () => {
        const element = createRowArticleKeyValueElement(
            "Created",
            "2026-06-15T21:36:10",
            "created",
            false,
            "big_card_detail_value",
            true,
            null,
            "2026-06-15T21:36:10",
            { data_type: "timestamp with time zone" },
        );

        const value = element.querySelector('[data-column="created"]');

        expect(value?.textContent).toBe(displayDateTime("2026-06-15", "21:36"));
        expect(value?.title).toBe("2026-06-15 21:36:10");
        expect(value?.getAttribute("data-raw-value")).toBe("2026-06-15T21:36:10");
    });

    test("createRowArticleNavigableElement keeps link labels icon-capable", () => {
        const element = createRowArticleNavigableElement({
            label: "Contact details",
            labelKey: "contact_details",
            value: "https://support.example.test",
            column: "contact_details",
            dataColumn: "contact_details",
            showKey: true,
            href: "https://support.example.test",
            labelMeta: { card_detail_icon_key: "user" },
        });

        expect(element.querySelector(
            ".two_line_label_icon .card_detail_row_icon_svg"
        )).not.toBeNull();
        expect(element.querySelector(".two_line_label_text")?.dataset.langKey).toBe("contact_details");
        expect(element.querySelector(".two_line_link_group a")?.getAttribute("href")).toBe(
            "https://support.example.test"
        );
    });

    test("createRowArticleNavigableElement renders a compact icon action for opening in a new tab", () => {
        const element = createRowArticleNavigableElement({
            label: "Documentation",
            labelKey: "documentation",
            value: "Ohje salasanan vaihtoon",
            column: "documentation",
            showKey: true,
            href: "/dokumentaatio/3-ohje-salasanan-vaihtoon",
        });

        const openInNewTab = element.querySelector(".two_line_new_tab_button");

        expect(openInNewTab?.textContent).toBe("");
        expect(openInNewTab?.getAttribute("title")).toBe("Avaa uudessa välilehdessä");
        expect(openInNewTab?.getAttribute("aria-label")).toBe("Avaa uudessa välilehdessä");
        expect(openInNewTab?.dataset.titleLangKey).toBe("open_in_new_tab");
        expect(openInNewTab?.dataset.ariaLabelLangKey).toBe("open_in_new_tab");
        expect(openInNewTab?.querySelector(".open-in-new-tab-icon")).not.toBeNull();
    });

    test("semantic article links accept HTTP(S) without guessing plain or unsafe values", () => {
        const safe = createRowArticleLinkTwoLine(
            "Website",
            "https://example.test",
            "website",
            false,
        );
        const unsafe = createRowArticleLinkTwoLine(
            "Script",
            "javascript:alert(1)",
            "script",
            false,
        );

        expect(safe.querySelector("a")?.getAttribute("href")).toBe("https://example.test");
        expect(safe.querySelector("a")?.getAttribute("rel")).toBe("noopener noreferrer");
        expect(unsafe.querySelector("a")).toBeNull();
        expect(unsafe.textContent).toContain("javascript:alert(1)");
    });

    test("raw article link metadata rejects unsafe schemes while explicit internal routes remain valid", () => {
        const unsafe = createRowArticleNavigableElement({
            label: "Website",
            value: "javascript:alert(1)",
            href: "javascript:alert(1)",
            externalHttpOnly: true,
        });
        const internal = createRowArticleNavigableElement({
            label: "Documentation",
            value: "Read documentation",
            href: "/documentation/1-read-documentation",
        });

        expect(unsafe.querySelector("a")).toBeNull();
        expect(unsafe.textContent).toContain("javascript:alert(1)");
        expect(internal.querySelector("a")?.getAttribute("href")).toBe(
            "/documentation/1-read-documentation"
        );
    });
});

describe("dispatchCardArticleToggle", () => {
    test("keeps legacy and row-article listeners on the same toggle detail", () => {
        const bigCardListener = vi.fn();
        const rowArticleListener = vi.fn();
        document.addEventListener("big-card-toggle", bigCardListener, { once: true });
        document.addEventListener("row-article-toggle", rowArticleListener, { once: true });

        dispatchCardArticleToggle("tickets", true);

        expect(bigCardListener.mock.calls[0][0].detail).toEqual({
            tableName: "tickets",
            isOpen: true,
        });
        expect(rowArticleListener.mock.calls[0][0].detail).toEqual({
            tableName: "tickets",
            isOpen: true,
        });
    });
});
