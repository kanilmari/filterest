// @vitest-environment jsdom
// article_language_editor.test.js
// Verifies one-field language editing, authorization and failure preservation.
// Bridges metadata, a freshly permitted row and the existing update API.
// Prevents overwritten translations, raw JSON UI and discarded failed drafts.
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../endpoints/endpoint_router.js", () => ({ endpoint_router: vi.fn(async () => ({})) }));
vi.mock("../../route_permission_checker.js", () => ({ hasDatasetPermission: vi.fn(async () => true) }));
vi.mock("../../lang/translation_handler.js", () => ({ getTranslationForKey: vi.fn((key, { fallback }) => fallback) }));
vi.mock("../../lang/ui_language_catalog.js", () => ({
    loadPublicUiLanguageCatalog: vi.fn(async () => []),
    getUiLanguageOptions: vi.fn(() => [{ value: "fi", label: "Suomi" }, { value: "en", label: "English" }]),
}));
vi.mock("../../state_stores/lang_preference_reader.js", () => ({ getLanguageWithBrowserFallback: vi.fn(() => "en") }));
vi.mock("../../service_catalog/service_catalog_moderation.js", () => ({
    readCachedUserPermissions: vi.fn(() => []),
    canEditServiceCatalogColumn: vi.fn(() => true),
}));
vi.mock("../card_view/row_article_data_fetcher.js", () => ({
    fetchPermittedRowArticleData: vi.fn(async ({ rowItem }) => ({ ...rowItem })),
}));

import { endpoint_router } from "../../endpoints/endpoint_router.js";
import { hasDatasetPermission } from "../../route_permission_checker.js";
import { getUiLanguageOptions, loadPublicUiLanguageCatalog } from "../../lang/ui_language_catalog.js";
import { getTranslationForKey } from "../../lang/translation_handler.js";
import { canEditServiceCatalogColumn } from "../../service_catalog/service_catalog_moderation.js";
import { fetchPermittedRowArticleData } from "../card_view/row_article_data_fetcher.js";
import { createArticleLanguageEditor, getArticleLanguageFields, mergeArticleLanguageDraft, readArticleLanguageValues } from "./article_language_editor.js";

const metadata = { is_multilingual: true, editable_in_ui: true, card_element: "description_1", data_type: "text" };
let row;
let editor;
let onSaved;
function setup(overrides = {}) {
    row = { id: 7, summary: JSON.stringify({ fi: "Moi", en: "Hi", "zh-HK": "粵", sv: "Hej", de: null }), title: '{"en":"Title"}' };
    onSaved = vi.fn(async () => {});
    editor = createArticleLanguageEditor({
        row, columns: ["id", "summary", "title"], dataTypes: { summary: metadata, title: { ...metadata, card_element: "header" } },
        tableName: "any_dataset", canUpdateRow: true, onSaved, ...overrides,
    });
    if (editor) document.body.append(editor.button, editor.panel);
    return editor;
}
async function open() {
    editor.button.click();
    await vi.waitFor(() => expect(editor.panel.hidden).toBe(false));
    await vi.waitFor(() => expect(editor.panel.querySelector("textarea")).not.toBeNull());
}
function input(language, value) {
    const field = editor.panel.querySelector('textarea[data-language="' + language + '"]');
    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    return field;
}
const save = () => editor.panel.querySelector(".article-language-editor-actions button");
const cancel = () => editor.panel.querySelectorAll(".article-language-editor-actions button")[1];

beforeEach(() => {
    document.body.replaceChildren();
    vi.clearAllMocks();
    endpoint_router.mockResolvedValue({});
    hasDatasetPermission.mockResolvedValue(true);
    canEditServiceCatalogColumn.mockReturnValue(true);
    getUiLanguageOptions.mockReturnValue([{ value: "fi", label: "Suomi" }, { value: "en", label: "English" }]);
    loadPublicUiLanguageCatalog.mockResolvedValue([]);
    fetchPermittedRowArticleData.mockImplementation(async ({ rowItem }) => ({ ...rowItem }));
    getTranslationForKey.mockImplementation((_key, { fallback }) => fallback);
});

describe("generic article content editor", () => {
    test("shows metadata languages and existing non-UI languages without JSON", async () => {
        setup();
        await open();
        expect(Array.from(editor.panel.querySelectorAll("textarea"), (el) => el.lang)).toEqual(["fi", "en", "zh-HK", "sv", "de"]);
        expect(editor.panel.querySelector("textarea").value).toBe("Moi");
        expect(editor.panel.textContent).not.toContain('{"fi"');
        expect(save().disabled).toBe(true);
        expect(editor.panel.querySelector("textarea").rows).toBe(8);
    });
    test("works on arbitrary fields and catalogues rather than hardcoded FI/EN", async () => {
        getUiLanguageOptions.mockReturnValue([{ value: "fr", label: "Français" }, { value: "ja", label: "日本語" }]);
        setup({ row: { id: 8, custom: '{"fr":"Bonjour"}' }, columns: ["custom"], dataTypes: { custom: metadata }, tableName: "custom_content" });
        await open();
        expect(Array.from(editor.panel.querySelectorAll("textarea"), (el) => el.lang)).toEqual(["fr", "ja"]);
        input("ja", "こんにちは");
        save().click();
        await vi.waitFor(() => expect(endpoint_router).toHaveBeenCalledOnce());
        expect(endpoint_router.mock.calls[0][1].url_params).toBe("?dataset=custom_content");
    });
    test("saves all edited languages in one API request and preserves untouched/null languages", async () => {
        setup();
        await open();
        input("fi", "Uusi");
        input("en", "New");
        expect(editor.panel.querySelector("select").disabled).toBe(true);
        save().click();
        await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
        const payload = endpoint_router.mock.calls[0][1].body_data;
        expect(payload).toMatchObject({ id: 7, column: "summary" });
        expect(JSON.parse(payload.value)).toEqual({ fi: "Uusi", en: "New", "zh-HK": "粵", sv: "Hej", de: null });
        expect(editor.panel.hidden).toBe(true);
    });
    test("merges untouched languages from a fresh authorized row", async () => {
        setup();
        await open();
        input("fi", "Uusi");
        fetchPermittedRowArticleData.mockResolvedValue({ id: 7, summary: '{"fi":"Moi","en":"Someone else","pt":"Novo"}' });
        save().click();
        await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
        expect(JSON.parse(endpoint_router.mock.calls[0][1].body_data.value)).toEqual({ fi: "Uusi", en: "Someone else", pt: "Novo" });
    });
    test("retains the draft when the edited translation changed elsewhere", async () => {
        setup();
        await open();
        input("fi", "My draft");
        fetchPermittedRowArticleData.mockResolvedValue({ id: 7, summary: '{"fi":"Their draft","en":"Hi"}' });
        save().click();
        await vi.waitFor(() => expect(editor.panel.querySelector('[role="status"]').textContent).toContain("Saving failed"));
        expect(endpoint_router).not.toHaveBeenCalled();
        expect(editor.panel.querySelector("textarea").value).toBe("My draft");
    });
    test.each([403, 503])("preserves draft and permits retry after API failure %s", async (status) => {
        setup();
        await open();
        input("en", "Draft");
        endpoint_router.mockRejectedValueOnce(Object.assign(new Error("failed"), { status }));
        save().click();
        await vi.waitFor(() => expect(editor.panel.querySelector('[role="status"]').textContent).toContain("Saving failed"));
        expect(editor.panel.hidden).toBe(false);
        expect(editor.panel.querySelector('textarea[lang="en"]').value).toBe("Draft");
        expect(row.summary).toContain('"en":"Hi"');
        endpoint_router.mockResolvedValue({});
        save().click();
        await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    });
    test("cancel drops drafts without an API mutation, and clean field changes are allowed", async () => {
        setup();
        await open();
        const select = editor.panel.querySelector("select");
        select.value = "title";
        select.dispatchEvent(new Event("change"));
        input("en", "Discard me");
        cancel().click();
        expect(endpoint_router).not.toHaveBeenCalled();
        expect(editor.panel.hidden).toBe(true);
        expect(row.title).toBe('{"en":"Title"}');
    });
    test("rechecks update permission before saving", async () => {
        setup(); await open(); input("en", "Draft");
        hasDatasetPermission.mockResolvedValue(false);
        save().click();
        await vi.waitFor(() => expect(editor.panel.querySelector('[role="status"]').textContent).toContain("Saving failed"));
        expect(endpoint_router).not.toHaveBeenCalled();
    });
    test("refuses a freshly inaccessible row or field without a write", async () => {
        setup(); await open(); input("en", "Draft");
        fetchPermittedRowArticleData.mockResolvedValue({ id: 7 });
        save().click();
        await vi.waitFor(() => expect(editor.panel.querySelector('[role="status"]').textContent).toContain("Saving failed"));
        expect(endpoint_router).not.toHaveBeenCalled();
    });
    test("has no editing controls without dataset or column rights", () => {
        expect(setup({ canUpdateRow: false })).toBeNull();
        expect(setup({ dataTypes: { summary: { ...metadata, editable_in_ui: false } } })).toBeNull();
        canEditServiceCatalogColumn.mockReturnValue(false);
        expect(setup()).toBeNull();
    });
    test("ignores arbitrary JSON, foreign fields, keywords and translation-key roles", () => {
        const dataTypes = {
            a: metadata, b: { ...metadata, foreign_table: "other" },
            c: { ...metadata, card_element: "keywords" }, d: { ...metadata, card_element: "header+lang-key" },
        };
        expect(getArticleLanguageFields({ row: { id: 1, a: '{"unsafe":{"value":1}}', b: "x", c: "x", d: "x" }, columns: Object.keys(dataTypes), dataTypes, tableName: "custom" })).toEqual([]);
    });
    test("clears an existing language deliberately but never creates empty omitted languages", () => {
        expect(JSON.parse(mergeArticleLanguageDraft({ en: "Hello", fi: "Moi", de: null }, { en: "", fr: "" }))).toEqual({ en: "", fi: "Moi", de: null });
        expect(readArticleLanguageValues(null)).toEqual({});
        expect(readArticleLanguageValues("Plain text", "sv")).toEqual({ sv: "Plain text" });
    });
    test("supports translated labels and application theme tokens without OS-theme logic", async () => {
        getTranslationForKey.mockImplementation((key, { fallback }) => ({ article_edit_languages: "Muokkaa kieliversioita", article_language_field: "Kenttä", save: "Tallenna", cancel: "Peru" }[key] || fallback));
        setup(); await open();
        expect(editor.button.textContent).toBe("Muokkaa kieliversioita");
        expect(save().textContent).toBe("Tallenna");
        expect(editor.panel.querySelector("select").getAttribute("aria-label")).toBe("Kenttä");
    });
    test("ignores an old article while its catalogue load is pending", async () => {
        let release;
        let current = true;
        loadPublicUiLanguageCatalog.mockReturnValue(new Promise((resolve) => { release = resolve; }));
        setup({ isCurrent: () => current });
        editor.button.click();
        current = false;
        release([]);
        await vi.waitFor(() => expect(editor.button.disabled).toBe(false));
        expect(editor.panel.hidden).toBe(true);
        expect(endpoint_router).not.toHaveBeenCalled();
    });
    test("retries an unavailable initial read without exposing an unusable draft", async () => {
        setup();
        fetchPermittedRowArticleData.mockRejectedValueOnce(new Error("unavailable"));
        editor.button.click();
        await vi.waitFor(() => expect(editor.panel.querySelector('[role="status"]').textContent).toContain("could not be loaded"));
        expect(editor.panel.querySelector("label").hidden).toBe(true);
        expect(save().hidden).toBe(true);
        expect(editor.button.disabled).toBe(false);
        await open();
        expect(editor.panel.querySelector("label").hidden).toBe(false);
        expect(save().hidden).toBe(false);
    });

});
