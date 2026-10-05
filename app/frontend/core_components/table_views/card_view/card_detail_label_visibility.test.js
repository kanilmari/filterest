// card_detail_label_visibility.test.js
// Verifies resolved field-name visibility across all card detail renderers.
// Connects the server's effective visibility, detail entries and real label DOM.
// Keeps fallback names and generated relation labels from undoing an explicit Hide.
// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from "vitest";
import { renderModernCardDetails } from "./card_detail_tile_builder.js";
import * as cardDetailHelpers from "./card_detail_single_line_helpers.js";
import { decorateStandardCardDetailKey } from "./card_detail_standard_key_decorator.js";
import { createKvPairBuilders } from "../../../reusable_components/key_value_container/kv_pair_builder.js";
import { expandForeignKeyDetailEntries } from "./relation_detail_helpers.js";

const pairBuilders = createKvPairBuilders({
    translate: key => key,
    decorateKeyElement: decorateStandardCardDetailKey,
});
const renderers = [
    { name: "modern tiles", render: renderModernCardDetails },
    { name: "single-line details", render: cardDetailHelpers.renderSingleLineCardDetails },
    ...[
        ["inline", pairBuilders.createInlineElement],
        ["stacked", pairBuilders.createStackedElement],
        ["conditional", pairBuilders.createConditionalElement],
    ].map(([layout, buildPair]) => ({
        name: `standard ${layout} pairs`,
        render(container, entries, dataTypes) {
            entries.forEach(entry => container.appendChild(buildPair({
                ...entry,
                key: entry.column,
                labelKey: entry.labelKey || entry.column,
                labelText: entry.label,
                value: entry.rawValue,
                labelMeta: cardDetailHelpers.resolveCardDetailMetadata(entry, dataTypes),
            })));
        },
    })),
];

// The metadata API resolves raw true/false/null before card rendering. A mixed
// header/details role inherits Hide, while details alone inherits Show; these
// are examples of the existing server policy, not another implementation of it.
const visibilityCases = [
    { state: "hidden", effective: false, role: "details", label: "" },
    { state: "shown", effective: true, role: "details", label: "Hinta" },
    { state: "role default shown", effective: true, role: "details", label: "Hinta" },
    { state: "role default hidden", effective: false, role: "header,details", label: "" },
];
const presentationCases = ["label", "icon", "both"].flatMap(mode =>
    ["calendar", ""].flatMap(icon =>
        [null, "inline", "stacked"].map(layout => ({ mode, icon, layout }))));
const visibleNameSelector = ".card_detail_tile_label, .card_detail_row_label_text";

afterEach(() => vi.restoreAllMocks());

describe.each(renderers)("$name field-name visibility", ({ name, render }) => {
    describe.each(visibilityCases)("$state", ({ effective, role, label }) => {
        test.each(presentationCases)("mode=$mode icon=$icon layout=$layout", ({ mode, icon, layout }) => {
            const container = document.createElement("div");
            const entries = [{ column: "price", label, rawValue: "129 €" }];
            const dataTypes = { price: {
                show_key_on_card: effective,
                card_element: role,
                data_type: "numeric",
                card_detail_label_mode: mode,
                card_detail_icon_key: icon,
                label_value_layout: layout,
            } };
            const originalEntries = JSON.stringify(entries);
            render(container, entries, dataTypes);

            // Standard pairs have always displayed the name in all label modes;
            // tiles and single-line rows replace it with the icon in icon mode.
            const showsName = effective && (name.startsWith("standard") || mode !== "icon");
            const labelElement = container.querySelector(visibleNameSelector);
            expect(Boolean(labelElement)).toBe(showsName);
            if (showsName) {
                expect(labelElement.textContent).toBe("Hinta");
                expect(labelElement.dataset.langKey).toBe("price");
                labelElement.textContent = "價格";
                expect(container.textContent).toContain("價格");
            } else {
                expect(container.textContent).not.toContain("price");
                expect(container.textContent).not.toContain("Hinta");
            }
            expect(container.querySelector("[data-card-label-placement]")?.dataset.cardLabelPlacement)
                .toBe(effective ? layout || "inline" : "hidden");
            expect(container.textContent).toContain("129 €");
            expect(JSON.stringify(entries)).toBe(originalEntries);

            const symbol = container.querySelector(".card_detail_row_icon_svg");
            const hasSymbol = name === "modern tiles"
                || (name === "single-line details" ? mode !== "label" : effective);
            expect(Boolean(symbol)).toBe(hasSymbol);
            // An unconfigured price icon keeps its existing semantic fallback.
            if (hasSymbol) expect(symbol.dataset.symbolKey).toBe(icon || "euro");
            if (!showsName && name === "modern tiles") {
                const tile = container.querySelector(".card_detail_tile");
                expect(tile.getAttribute("aria-label")).toBe(label || "price");
                expect(tile.title).toBe(label || "price");
            }
            if (!showsName && name === "single-line details") {
                expect(container.querySelector("[aria-label]")?.getAttribute("aria-label"))
                    .toBe(label || "price");
            }
        });
    });

    test("an empty resolved label stays hidden without visibility metadata", () => {
        const container = document.createElement("div");
        render(container, [{ column: "price", label: "", rawValue: "129 €" }], {});
        expect(container.querySelector(visibleNameSelector)).toBeNull();
        expect(container.textContent).toBe("129 €");
    });

    test.each([false, true])("generated relation names obey source-column visibility %s", (showName) => {
        const container = document.createElement("div");
        const metadata = { owner_id: {
            foreign_table: "owners", card_element: "details", show_key_on_card: showName,
        } };
        const entries = expandForeignKeyDetailEntries([
            { column: "owner_id", label: showName ? "Owner" : "", rawValue: "7" },
        ], { owner_id: 7, "owner_name (ln)": "Alice" }, metadata);
        expect(entries).toHaveLength(2);
        expect(entries[1].label).not.toBe("");
        render(container, entries, metadata);

        expect(container.querySelectorAll(visibleNameSelector)).toHaveLength(showName ? 2 : 0);
        expect([...container.querySelectorAll("a:not(.kv-open-in-new-tab)")].map(link => link.textContent))
            .toEqual(["7", "Alice"]);
        expect(container.querySelector("a").getAttribute("href")).toContain("/owners/7");
    });
});

// The icon helper currently always supplies a semantic or info icon. Exercise
// the existing no-icon branches too, especially the tile's retained initial.
describe.each(renderers.filter(renderer => renderer.name !== "single-line details"))(
    "$name without a rendered icon", ({ name, render }) => {
        describe.each(visibilityCases)("$state", ({ effective, role, label }) => {
            test.each(["label", "icon", "both"])("label mode %s", mode => {
                vi.spyOn(cardDetailHelpers, "appendConfiguredCardDetailIcon").mockReturnValue(false);
                const container = document.createElement("div");
                render(container, [{ column: "price", label, rawValue: "129 €" }], {
                    price: {
                        show_key_on_card: effective, card_element: role,
                        card_detail_label_mode: mode,
                    },
                });

                const labelElement = container.querySelector(".card_detail_tile_label, .kv-key");
                expect(labelElement?.textContent || "").toBe(effective ? "Hinta" : "");
                expect(container.querySelector(".card_detail_row_icon_svg")).toBeNull();
                expect(container.textContent).toContain("129 €");
                if (name === "modern tiles") {
                    expect(container.querySelector(".card_detail_tile_icon--empty")?.textContent)
                        .toBe(effective ? "H" : "P");
                    if (!effective) {
                        expect(container.querySelector(".card_detail_tile").getAttribute("aria-label"))
                            .toBe("price");
                    }
                }
            });
        });
    },
);
