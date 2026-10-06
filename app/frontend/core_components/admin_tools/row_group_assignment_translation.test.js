// @vitest-environment jsdom
// row_group_assignment_translation.test.js
// Proves live translation updates catalogue names and preserves controls, counts and errors.
// Bridges the real language handler and modal with a selected-row API fixture.
// Exists to catch nested translated labels deleting inputs during live translation.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
const mocks = vi.hoisted(() => ({ endpoint: vi.fn(), selected: vi.fn() }));
vi.mock("../endpoints/endpoint_router.js", () => ({ endpoint_router: mocks.endpoint }));
vi.mock("../table_views/table_view/selected_items_reader.js", () => ({ get_selected_items: mocks.selected }));
vi.mock("../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js", () => ({ refreshTableUnified: vi.fn() }));
vi.mock("../table_views/card_view/card_view_printer.js", () => ({ refreshCardLanguages: vi.fn(async () => {}) }));
vi.mock("../lang/dev_lang_key_editor.js", () => ({ initDevLangKeyEditor: vi.fn() }));
vi.mock("../../reusable_components/notifications/toast_notification_printer.js", () => ({ showWarningToast: vi.fn(), showToast: vi.fn() }));
vi.mock("../../icons/icon_loader.js", () => ({ setElementSvgContent: vi.fn(async () => {}) }));
import { openRowGroupAssignmentEditor } from "./row_group_assignment_editor.js";
import { translatePage } from "../lang/translation_handler.js";
import { setLanguage } from "../state_stores/lang_preference_reader.js";

let copy;
beforeEach(() => {
    document.body.replaceChildren();
    setLanguage("fi");
    copy = {
        fi: { save: "Tallenna", cancel: "Peruuta", loading: "Ladataan", saving: "Tallennetaan", close: "Sulje" },
        en: { save: "Save", cancel: "Cancel", loading: "Loading", saving: "Saving", close: "Close" },
    };
    for (const path of ["20261005000036_seed_row_group_classification_language_keys.sql", "20261005000038_seed_row_group_window_language_keys.sql"]) {
        const source = readFileSync(`server_tools/migrations/${path}`, "utf8");
        for (const match of source.matchAll(/\('(row_group_[^']+)', '((?:''|[^'])*)', '((?:''|[^'])*)'\)/g)) {
            copy.fi[match[1]] = match[2].replaceAll("''", "'");
            copy.en[match[1]] = match[3].replaceAll("''", "'");
        }
    }
    window.translationPromises = { fi: Promise.resolve(copy.fi), en: Promise.resolve(copy.en) };
    mocks.selected.mockReturnValue({ ids: [1, 2] });
    mocks.endpoint.mockReset();
    mocks.endpoint.mockImplementation(async (route, options) => {
        if (route === "adminRowGroups" && options.method === "GET") return {
            dataset: "orders", table_uid: 103, row_ids: mocks.selected().ids,
            classifications: [{ id: 1, slug: "theme", title: { fi: "Teema", en: "Theme" }, is_single: false, enabled: true, sort_order: 0 }],
            groups: [{ id: 1, slug: "nature", title: { fi: "Luonto", en: "Nature" }, classification_id: 1, enabled: true, sort_order: 0, selected_rows: mocks.selected().ids.filter((id) => id === 1) }],
        };
        throw new Error("raw untranslated error");
    });
});
afterEach(() => { document.body.replaceChildren(); localStorage.removeItem("chosen_language"); delete window.translationPromises; });

test("live fi/en translation retains inputs, mixed counts and failure drafts", async () => {
    await translatePage("fi");
    await openRowGroupAssignmentEditor("orders");
    await translatePage("fi");
    const name = document.querySelector('.row-group-editor__value [data-name-language="fi"]');
    const assignment = document.querySelector('[data-value-id="1"]');
    const headingName = document.querySelector(".row-group-editor__heading > legend");
    const valueName = document.querySelector(".row-group-editor__assignment > span");
    expect(headingName.textContent).toBe("Teema");
    expect(valueName.textContent).toBe("Luonto");
    expect(name).not.toBeNull();
    name.value = "Oma nimi";
    name.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.querySelector("#row-group-mixed-1").textContent).toContain("(1/2)");
    expect(document.querySelector(".row-group-editor > p").textContent).toContain("(2)");
    setLanguage("en");
    await translatePage("en");
    expect(headingName.textContent).toBe("Theme");
    expect(valueName.textContent).toBe("Nature");
    expect(document.querySelector('.row-group-editor__value [data-name-language="fi"]')).toBe(name);
    expect(document.querySelector('[data-value-id="1"]')).toBe(assignment);
    expect(document.querySelector('[data-name-language="fi"]')).not.toBeNull();
    expect(name.value).toBe("Oma nimi");
    expect(name.closest("label").textContent).toBe("Finnish name");
    expect(document.querySelector("#row-group-mixed-1").textContent).toBe("On some rows (1/2)");
    expect(document.querySelector("#custom_modal_title").textContent).toBe("Classes and categories");
    document.querySelector(".row-group-editor").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(document.querySelector('[role="status"]').textContent).toBe(copy.en.row_group_window_save_failed));
    // Run another full translation pass after the failure and new draft DOM were mounted.
    await translatePage("en");
    expect(document.querySelector('.row-group-editor__value [data-name-language="fi"]').value).toBe("Oma nimi");
    expect(document.querySelector('[role="status"]').textContent).toBe(copy.en.row_group_window_save_failed);
    expect(document.querySelector('[data-testid="row-group-save"]').disabled).toBe(false);
});

test("names-only management updates displayed heading and value names without rebuilding drafts", async () => {
    mocks.selected.mockReturnValue({ ids: [] });
    await translatePage("fi");
    await openRowGroupAssignmentEditor("orders");
    await translatePage("fi");
    const headingName = document.querySelector(".row-group-editor__heading > legend");
    const valueName = document.querySelector(".row-group-editor__value > p");
    const input = document.querySelector('.row-group-editor__value [data-name-language="fi"]');
    expect(headingName.textContent).toBe("Teema");
    expect(valueName.textContent).toBe("Luonto");
    input.value = "Oma nimi";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    setLanguage("en");
    await translatePage("en");
    expect(headingName.textContent).toBe("Theme");
    expect(valueName.textContent).toBe("Nature");
    expect(document.querySelector('.row-group-editor__value [data-name-language="fi"]')).toBe(input);
    expect(input.value).toBe("Oma nimi");
});
