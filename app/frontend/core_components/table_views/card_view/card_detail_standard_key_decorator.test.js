// Verifies ordinary card-detail keys receive semantic, translation-safe icons.
// Bridges card metadata, the shared icon registry, and generic key-value label DOM.
// Exists so responsive card re-renders keep both field meaning and multilingual labels.
// @vitest-environment jsdom

import { describe, expect, test } from "vitest";

import { decorateStandardCardDetailKey } from "./card_detail_standard_key_decorator.js";

describe("decorateStandardCardDetailKey", () => {
    test("adds the configured semantic icon while moving translation metadata to label text", () => {
        const keyElement = document.createElement("div");
        keyElement.className = "kv-key";
        keyElement.dataset.langKey = "website";
        keyElement.textContent = "Website";

        decorateStandardCardDetailKey(keyElement, {
            key: "website",
            labelText: "Website",
            labelMeta: { card_detail_icon_key: "link" },
        });

        expect(keyElement.getAttribute("data-lang-key")).toBeNull();
        expect(keyElement.classList.contains("card_detail_row_label")).toBe(true);
        expect(keyElement.querySelector(
            ".card_detail_row_icon .card_detail_row_icon_svg"
        )).not.toBeNull();
        expect(keyElement.querySelector(".card_detail_row_icon")?.getAttribute("aria-hidden")).toBe("true");
        const labelText = keyElement.querySelector(".card_detail_row_label_text");
        expect(labelText?.dataset.langKey).toBe("website");
        expect(labelText?.textContent).toBe("Website");
    });

    test("uses column semantics for an unconfigured field and keeps translated text replaceable", () => {
        const keyElement = document.createElement("div");
        keyElement.dataset.langKey = "created_at";
        keyElement.textContent = "Created";

        decorateStandardCardDetailKey(keyElement, {
            key: "created_at",
            column: "created_at",
            labelText: "Created",
        });

        const icon = keyElement.querySelector(".card_detail_row_icon_svg");
        const labelText = keyElement.querySelector(".card_detail_row_label_text");
        expect(icon).not.toBeNull();
        expect(labelText?.dataset.langKey).toBe("created_at");

        labelText.textContent = "Luotu";
        expect(keyElement.querySelector(".card_detail_row_icon_svg")).toBe(icon);
        expect(keyElement.textContent).toContain("Luotu");
    });

    describe("the name placement it states for the key-value renderer", () => {
        function decorate(labelMeta) {
            const keyElement = document.createElement("div");
            keyElement.className = "kv-key";
            keyElement.dataset.langKey = "summary";
            keyElement.textContent = "Summary";
            return decorateStandardCardDetailKey(keyElement, {
                key: "summary", labelText: "Summary", column: "summary", labelMeta,
            });
        }

        test("a long text field states that its name is left out", () => {
            expect(decorate({ card_element: "description", data_type: "text" }))
                .toEqual({ labelPlacement: "hidden" });
            expect(decorate({ card_element: "", data_type: "jsonb" }))
                .toEqual({ labelPlacement: "hidden" });
        });

        test("a short value states that its name shares the value's line", () => {
            expect(decorate({ card_element: "details", data_type: "character varying(200)" }))
                .toEqual({ labelPlacement: "inline" });
            expect(decorate({ card_element: "", data_type: "numeric(10,2)" }))
                .toEqual({ labelPlacement: "inline" });
        });

        test("a column that states its own arrangement still decides for itself", () => {
            expect(decorate({
                card_element: "description", data_type: "text",
                label_value_layout: "stacked",
            })).toEqual({ labelPlacement: "stacked" });
            expect(decorate({
                card_element: "description", data_type: "text",
                label_value_layout: "inline",
            })).toEqual({ labelPlacement: "inline" });
        });

        test("a field without a name of its own states that no name is shown", () => {
            const keyElement = document.createElement("div");
            keyElement.className = "kv-key";
            expect(decorateStandardCardDetailKey(keyElement, { labelMeta: {} }))
                .toEqual({ labelPlacement: "hidden" });
        });
    });
});
