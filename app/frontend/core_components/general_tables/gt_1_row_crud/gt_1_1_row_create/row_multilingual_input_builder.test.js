// @vitest-environment jsdom
// row_multilingual_input_builder.test.js
// Verifies add-row multilingual fields serialize registry-defined language maps.
// Bridges language metadata, visible textareas, required-state changes, and hidden payload fields.
// Exists to prevent the add-row form from emitting scalar or partial multilingual values.

import { describe, expect, test, vi } from "vitest";
import { buildMultilingualTextareaGroup } from "./row_multilingual_input_builder.js";

function multilingualColumn(overrides = {}) {
    return {
        column_name: "title",
        data_type: "text",
        is_nullable: "NO",
        is_multilingual: true,
        multilingual_languages: [
            {
                language_code: "sv",
                english_name: "Swedish",
                native_name: "Svenska",
                is_default: true,
                sort_order: 10,
            },
            {
                language_code: "en",
                english_name: "English",
                native_name: "English",
                is_default: false,
                sort_order: 20,
            },
        ],
        ...overrides,
    };
}

describe("buildMultilingualTextareaGroup", () => {
    test("uses registry languages instead of a hard-coded fi/en pair", () => {
        const form = document.createElement("form");

        buildMultilingualTextareaGroup(form, {
            tableName: "articles",
            column: multilingualColumn(),
            fieldName: "title",
        });

        expect(form.querySelector('[data-language-code="sv"]')).not.toBeNull();
        expect(form.querySelector('[data-language-code="en"]')).not.toBeNull();
        expect(form.querySelector('[data-language-code="fi"]')).toBeNull();
        expect(form.querySelector('[data-testid="form-input-title"]')?.value).toBe("");
    });

    test("serializes every visible language into the hidden add-row value", () => {
        const form = document.createElement("form");
        const onValueChange = vi.fn();
        buildMultilingualTextareaGroup(form, {
            tableName: "articles",
            column: multilingualColumn(),
            fieldName: "title",
            onValueChange,
        });
        const swedish = form.querySelector('[data-language-code="sv"]');
        const english = form.querySelector('[data-language-code="en"]');

        swedish.value = "Rubrik";
        swedish.dispatchEvent(new Event("input"));
        english.value = "Title";
        english.dispatchEvent(new Event("input"));

        expect(JSON.parse(form.elements.title.value)).toEqual({
            sv: "Rubrik",
            en: "Title",
        });
        expect(onValueChange).toHaveBeenLastCalledWith(JSON.stringify({
            sv: "Rubrik",
            en: "Title",
        }));
    });

    test("makes every active language required when an optional field becomes non-empty", () => {
        const form = document.createElement("form");
        buildMultilingualTextareaGroup(form, {
            tableName: "articles",
            column: multilingualColumn({ is_nullable: "YES" }),
            fieldName: "title",
        });
        const swedish = form.querySelector('[data-language-code="sv"]');
        const english = form.querySelector('[data-language-code="en"]');
        expect(swedish.required).toBe(false);
        expect(english.required).toBe(false);

        swedish.value = "Rubrik";
        swedish.dispatchEvent(new Event("input"));

        expect(swedish.required).toBe(true);
        expect(english.required).toBe(true);
        expect(form.checkValidity()).toBe(false);
    });

    test("never promotes an old scalar draft into a language map", () => {
        const form = document.createElement("form");
        buildMultilingualTextareaGroup(form, {
            tableName: "articles",
            column: multilingualColumn(),
            initialValue: "Legacy scalar",
            fieldName: "title",
        });

        expect(form.querySelector('[data-language-code="sv"]')?.value).toBe("");
        expect(form.querySelector('[data-language-code="en"]')?.value).toBe("");
        expect(form.elements.title.value).toBe("");
    });

    test("rejects multilingual metadata on an unsupported scalar column type", () => {
        const form = document.createElement("form");

        expect(() => buildMultilingualTextareaGroup(form, {
            tableName: "articles",
            column: multilingualColumn({ data_type: "integer" }),
            fieldName: "title",
        })).toThrow(/require a text or JSON column/);
    });

    test("allows an editor to load legacy text in the registry's default language", () => {
        const form = document.createElement("form");
        const control = buildMultilingualTextareaGroup(form, {
            tableName: "articles",
            column: multilingualColumn(),
            initialValue: "Legacy scalar",
            legacyValueToDefaultLanguage: true,
            allowPartialTranslations: true,
        });

        expect(control.textareas[0].value).toBe("Legacy scalar");
        expect(control.textareas[1].value).toBe("");
        expect(JSON.parse(control.syncValue())).toEqual({ sv: "Legacy scalar" });
        expect(form.checkValidity()).toBe(true);
    });

    test("resets editor values through the shared map reader without emitting changes", () => {
        const form = document.createElement("form");
        const onValueChange = vi.fn();
        const control = buildMultilingualTextareaGroup(form, {
            tableName: "articles",
            column: multilingualColumn(),
            allowPartialTranslations: true,
            onValueChange,
        });

        expect(control.setValue({ sv: "Rubrik", en: " " })).toBe(JSON.stringify({ sv: "Rubrik" }));
        expect(control.textareas[1].value).toBe(" ");
        expect(control.setValue("")).toBe("");
        expect(control.textareas.every((textarea) => textarea.value === "")).toBe(true);
        expect(onValueChange).not.toHaveBeenCalled();
    });

    test("keeps an editor's stored text for a language that has no field", () => {
        const form = document.createElement("form");
        const control = buildMultilingualTextareaGroup(form, {
            tableName: "articles",
            column: multilingualColumn(),
            allowPartialTranslations: true,
        });

        expect(JSON.parse(control.setValue({ sv: "Rubrik", de: "Titel" }))).toEqual({ sv: "Rubrik", de: "Titel" });
        control.textareas[0].value = "Ny rubrik";
        expect(JSON.parse(control.syncValue({ emit: false }))).toEqual({ sv: "Ny rubrik", de: "Titel" });
        expect(control.setValue("Legacy")).toBe("");
    });

    test("add-row fields still drop languages that have no field", () => {
        const form = document.createElement("form");
        const control = buildMultilingualTextareaGroup(form, {
            tableName: "articles",
            column: multilingualColumn(),
            initialValue: { sv: "Rubrik", en: "Title", de: "Titel" },
        });

        expect(JSON.parse(control.syncValue({ emit: false }))).toEqual({ sv: "Rubrik", en: "Title" });
    });
});
