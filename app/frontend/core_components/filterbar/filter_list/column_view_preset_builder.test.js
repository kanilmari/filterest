// @vitest-environment jsdom
// Verifies view-scoped field collections, inheritance reset, and explicit admin mode.
import { beforeEach, expect, test, vi } from "vitest";

const api = {
    getViewFieldSets: vi.fn(),
    resetPersonalViewFieldSet: vi.fn(),
    assignPersonalViewFieldSet: vi.fn(),
    assignSiteViewFieldSet: vi.fn(),
    savePersonalViewFieldSet: vi.fn(),
    saveSiteViewFieldSet: vi.fn(),
    deletePersonalViewFieldSet: vi.fn(),
    deleteSharedViewFieldSet: vi.fn(),
};
const applyColumnVisibility = vi.fn();
const refreshTableUnified = vi.fn();

vi.mock("../../endpoints/stable_endpoint_router.js", () => api);
vi.mock("./column_visibility_handler.js", () => ({
    getHiddenColumns: vi.fn(() => ({})),
    getColumnVisibilityStorageKey: vi.fn((table, view) => `${table}_${view}_hide_columns`),
    applyColumnVisibility,
}));
vi.mock("../../lang/translation_handler.js", () => ({ getTranslationForKey: vi.fn(() => "") }));
vi.mock("../../../reusable_components/notifications/toast_notification_printer.js", () => ({ showSuccessToast: vi.fn() }));
vi.mock("../../../reusable_components/modal/confirm_modal_builder.js", () => ({
    showConfirmModal: vi.fn(async () => true), showInputModal: vi.fn(async () => "Named"),
}));
vi.mock("../../../reusable_components/multiselect_dropdown/multiselect_dropdown_builder.js", () => ({
    createMultiselectDropdown: vi.fn(() => ({ setValue: vi.fn(), destroy: vi.fn() })),
}));
vi.mock("../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js", () => ({
    refreshTableUnified,
}));

beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    Object.values(api).forEach((mock) => mock.mockReset());
    applyColumnVisibility.mockReset();
    refreshTableUnified.mockReset();
    refreshTableUnified.mockResolvedValue(undefined);
    api.getViewFieldSets.mockResolvedValue({
        active_field_set_id: 7,
        personal_field_set_id: 7,
        site_default_field_set_id: 8,
        effective_scope: "personal",
        available_columns: ["title", "id"],
        visible_columns: ["title"],
        can_edit_personal: true,
        can_edit_site_default: true,
        field_sets: [
            { id: 7, name: "Mine", scope: "personal", visible_columns: ["title"] },
            { id: 8, name: "Site", scope: "shared", visible_columns: ["id"] },
        ],
    });
    api.resetPersonalViewFieldSet.mockResolvedValue({ status: "ok" });
    api.assignPersonalViewFieldSet.mockResolvedValue({ status: "ok" });
    api.assignSiteViewFieldSet.mockResolvedValue({ status: "ok" });
});

test("loads and applies the active card-view collection", async () => {
    const { buildColumnViewPresetSelector } = await import("./column_view_preset_builder.js");
    const row = buildColumnViewPresetSelector("orders", ["title", "id"], "card");
    await vi.waitFor(() => expect(api.getViewFieldSets).toHaveBeenCalledWith("orders", "card"));
    expect(row.dataset.viewKey).toBe("card");
    expect(localStorage.getItem("orders_card_hide_columns")).toBe('{"id":true}');
    expect(row.querySelector('[data-testid="field-set-site-default-mode"]')?.hidden).toBe(false);
    expect(row.querySelector('[data-testid="field-set-effective-source"]')?.textContent)
        .toBe("Henkilökohtainen ohitus on käytössä");
    const optionLabels = Array.from(row.querySelectorAll("select option")).map((option) => option.textContent);
    expect(optionLabels).toContain("Mine (henkilökohtainen)");
    expect(optionLabels).toContain("Site (jaettu)");
});

test("keeps calendar as its own field-selection dimension", async () => {
    api.getViewFieldSets.mockResolvedValue({
        active_field_set_id: 7,
        personal_field_set_id: 7,
        site_default_field_set_id: null,
        effective_scope: "personal",
        available_columns: ["title", "phone"],
        visible_columns: ["title"],
        can_edit_personal: true,
        can_edit_site_default: false,
        field_sets: [{ id: 7, name: "Mine", scope: "personal", visible_columns: ["title"] }],
    });
    const { buildColumnViewPresetSelector } = await import("./column_view_preset_builder.js");
    const row = buildColumnViewPresetSelector("orders", ["title", "phone"], "calendar");
    await vi.waitFor(() => expect(api.getViewFieldSets).toHaveBeenCalledWith("orders", "calendar"));
    expect(row.dataset.viewKey).toBe("calendar");
    expect(localStorage.getItem("orders_calendar_hide_columns")).toBe('{"phone":true}');
});

test("reset removes only the session user's assignment and reloads inheritance", async () => {
    const { buildColumnViewPresetSelector } = await import("./column_view_preset_builder.js");
    const row = buildColumnViewPresetSelector("orders", ["title"], "table");
    await vi.waitFor(() => expect(api.getViewFieldSets).toHaveBeenCalledTimes(1));
    const resetButton = row.querySelector('[data-testid="field-set-reset-inheritance"]');
    expect(resetButton.textContent).toBe("Käytä sivuston oletusta");
    resetButton.click();
    await vi.waitFor(() => expect(api.resetPersonalViewFieldSet).toHaveBeenCalledWith({
        dataset: "orders", view_key: "table",
    }));
    await vi.waitFor(() => expect(refreshTableUnified).toHaveBeenCalledWith("orders"));
    expect(api.assignPersonalViewFieldSet).not.toHaveBeenCalled();
    expect(api.assignSiteViewFieldSet).not.toHaveBeenCalled();
});

test("administrator mode selects and updates the separate site default", async () => {
    const { buildColumnViewPresetSelector } = await import("./column_view_preset_builder.js");
    const row = buildColumnViewPresetSelector("orders", ["title", "id"], "card");
    await vi.waitFor(() => expect(api.getViewFieldSets).toHaveBeenCalledTimes(1));

    row.querySelector('[data-testid="field-set-site-default-mode"]').click();
    await vi.waitFor(() => {
        expect(row.querySelector("select").value).toBe("8");
    });

    const select = row.querySelector("select");
    select.value = "8";
    select.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(api.assignSiteViewFieldSet).toHaveBeenCalledWith({
        dataset: "orders", view_key: "card", field_set_id: 8,
    }));
    expect(api.assignPersonalViewFieldSet).not.toHaveBeenCalled();
});

test("guest inherits the site default without personal collection actions", async () => {
    api.getViewFieldSets.mockResolvedValue({
        active_field_set_id: 8,
        personal_field_set_id: null,
        site_default_field_set_id: 8,
        effective_scope: "site",
        available_columns: ["title", "id"],
        visible_columns: ["title"],
        can_edit_personal: false,
        can_edit_site_default: false,
        field_sets: [{ id: 8, name: "Site", scope: "shared", visible_columns: ["title"] }],
    });
    const { buildColumnViewPresetSelector } = await import("./column_view_preset_builder.js");
    const row = buildColumnViewPresetSelector("orders", ["title", "id"], "card");
    await vi.waitFor(() => expect(api.getViewFieldSets).toHaveBeenCalledWith("orders", "card"));

    expect(row.querySelector("select").hidden).toBe(true);
    expect(row.querySelector(".column-preset-actions").hidden).toBe(true);
    expect(localStorage.getItem("orders_card_hide_columns")).toBe('{"id":true}');
});

test("identifies the metadata default when no saved collection is assigned", async () => {
    api.getViewFieldSets.mockResolvedValue({
        active_field_set_id: null,
        personal_field_set_id: null,
        site_default_field_set_id: null,
        effective_scope: "metadata",
        available_columns: ["title", "description"],
        visible_columns: ["title", "description"],
        can_edit_personal: true,
        can_edit_site_default: true,
        field_sets: [],
    });
    const { buildColumnViewPresetSelector } = await import("./column_view_preset_builder.js");
    const row = buildColumnViewPresetSelector("travel_info", ["title", "description"], "card");
    await vi.waitFor(() => expect(api.getViewFieldSets).toHaveBeenCalledTimes(1));

    expect(row.querySelector('[data-testid="field-set-effective-source"]')?.textContent)
        .toBe("Metadatan oletus on käytössä");
    expect(row.querySelector('[data-testid="field-set-assignment-diagnostic"]')?.hidden).toBe(true);
});

test("presents the older legacy fallback response as the metadata default", async () => {
    api.getViewFieldSets.mockResolvedValue({
        active_field_set_id: null,
        personal_field_set_id: null,
        site_default_field_set_id: null,
        effective_scope: "legacy",
        available_columns: ["title"],
        visible_columns: ["title"],
        can_edit_personal: true,
        can_edit_site_default: false,
        field_sets: [],
    });
    const { buildColumnViewPresetSelector } = await import("./column_view_preset_builder.js");
    const row = buildColumnViewPresetSelector("orders", ["title"], "table");
    await vi.waitFor(() => expect(api.getViewFieldSets).toHaveBeenCalledTimes(1));

    expect(row.querySelector('[data-testid="field-set-effective-source"]')?.dataset.effectiveScope)
        .toBe("metadata");
});

test("presents a group assignment as a group source instead of metadata", async () => {
    api.getViewFieldSets.mockResolvedValue({
        active_field_set_id: 12,
        personal_field_set_id: null,
        site_default_field_set_id: 8,
        effective_scope: "group",
        available_columns: ["title", "id"],
        visible_columns: ["title"],
        can_edit_personal: true,
        can_edit_site_default: false,
        field_sets: [
            { id: 12, name: "Team", scope: "shared", visible_columns: ["title"] },
        ],
    });
    const { buildColumnViewPresetSelector } = await import("./column_view_preset_builder.js");
    const row = buildColumnViewPresetSelector("orders", ["title", "id"], "table");
    await vi.waitFor(() => expect(api.getViewFieldSets).toHaveBeenCalledTimes(1));

    const status = row.querySelector('[data-testid="field-set-effective-source"]');
    expect(status?.dataset.effectiveScope).toBe("group");
    expect(status?.textContent).toBe("Ryhmäkohtainen oletus on käytössä");
});

test("shows a safe diagnostic when an active assignment is absent from returned collections", async () => {
    api.getViewFieldSets.mockResolvedValue({
        active_field_set_id: 99,
        personal_field_set_id: 99,
        site_default_field_set_id: 8,
        effective_scope: "personal",
        available_columns: ["title", "id"],
        visible_columns: ["title"],
        can_edit_personal: true,
        can_edit_site_default: false,
        field_sets: [{ id: 8, name: "Site", scope: "shared", visible_columns: ["id"] }],
    });
    const { buildColumnViewPresetSelector } = await import("./column_view_preset_builder.js");
    const row = buildColumnViewPresetSelector("orders", ["title", "id"], "card");
    await vi.waitFor(() => expect(api.getViewFieldSets).toHaveBeenCalledTimes(1));

    const diagnostic = row.querySelector('[data-testid="field-set-assignment-diagnostic"]');
    expect(diagnostic?.hidden).toBe(false);
    expect(diagnostic?.dataset.missingScopes).toBe("personal");
    expect(diagnostic?.textContent).toContain("turvallinen kenttävalinta");
    expect(localStorage.getItem("orders_card_hide_columns")).toBe('{"id":true}');
});
