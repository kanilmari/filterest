// @vitest-environment jsdom
// row_group_assignment_editor.test.js
// Proves mixed selection, class replacement, draft recovery and modal focus.
// Bridges the real window and shared modal with captured API and selection fixtures.
// Exists to prevent widened assignments, lost names and untranslated failure messages.
import { beforeEach, describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";

const mocks = vi.hoisted(() => ({ endpoint: vi.fn(), selected: vi.fn(), refresh: vi.fn(), warning: vi.fn(), language: "fi", copy: {} }));
vi.mock("../endpoints/endpoint_router.js", () => ({ endpoint_router: mocks.endpoint }));
vi.mock("../lang/translation_handler.js", () => ({ getTranslationForKey: (key) => mocks.copy[key]?.[mocks.language] || key }));
vi.mock("../state_stores/lang_preference_reader.js", () => ({ getLanguageWithBrowserFallback: () => mocks.language }));
vi.mock("../table_views/table_view/selected_items_reader.js", () => ({ get_selected_items: mocks.selected }));
vi.mock("../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js", () => ({ refreshTableUnified: mocks.refresh }));
vi.mock("../../reusable_components/notifications/toast_notification_printer.js", () => ({ showWarningToast: mocks.warning }));
vi.mock("../../icons/icon_loader.js", () => ({ setElementSvgContent: vi.fn(async () => {}) }));
import { createRowGroupAssignmentButton, openRowGroupAssignmentEditor } from "./row_group_assignment_editor.js";

function fixture(rowIDs = [1, 2]) {
    return {
        dataset: "orders", table_uid: 103, row_ids: rowIDs,
        classifications: [
            { id: 1, slug: "transport", title: { fi: "Kulkumuoto", en: "Transport" }, is_single: true, enabled: true, sort_order: 0 },
            { id: 2, slug: "theme", title: { fi: "Teema", en: "Theme" }, is_single: false, enabled: true, sort_order: 1 },
        ],
        groups: [
            { id: 1, slug: "boat", title: { fi: "Laiva", en: "Boat" }, classification_id: 1, enabled: true, sort_order: 0, selected_rows: rowIDs.filter((id) => id === 1) },
            { id: 2, slug: "train", title: { fi: "Juna", en: "Train" }, classification_id: 1, enabled: true, sort_order: 1, selected_rows: rowIDs.filter((id) => id === 2) },
            { id: 3, slug: "nature", title: { fi: "Luonto", en: "Nature" }, classification_id: 2, enabled: true, sort_order: 0, selected_rows: rowIDs.filter((id) => id === 1) },
            { id: 4, slug: "all", title: { fi: "Kaikki", en: "All" }, classification_id: 2, enabled: true, sort_order: 1, selected_rows: rowIDs },
        ],
    };
}
function control(id) { return document.querySelector(`[data-value-id="${id}"]`); }
function change(node, checked) { node.checked = checked; node.dispatchEvent(new Event("change", { bubbles: true })); }
function input(node, value) { node.value = value; node.dispatchEvent(new Event("input", { bubbles: true })); }
function save() { document.querySelector(".row-group-editor").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }
function membershipCalls() { return mocks.endpoint.mock.calls.filter(([route]) => route === "adminRowGroupMemberships").map(([, options]) => options); }
async function open() {
    const opener = createRowGroupAssignmentButton("orders");
    document.body.append(opener);
    await openRowGroupAssignmentEditor("orders", opener);
    return opener;
}

beforeEach(() => {
    document.body.replaceChildren();
    mocks.language = "fi";
    mocks.copy = { save: { fi: "Tallenna", en: "Save" }, cancel: { fi: "Peruuta", en: "Cancel" } };
    for (const path of ["20261005000036_seed_row_group_classification_language_keys.sql", "20261005000038_seed_row_group_window_language_keys.sql"]) {
        const source = readFileSync(`server_tools/migrations/${path}`, "utf8");
        for (const match of source.matchAll(/\('(row_group_[^']+)', '((?:''|[^'])*)', '((?:''|[^'])*)'\)/g)) {
            mocks.copy[match[1]] = { fi: match[2].replaceAll("''", "'"), en: match[3].replaceAll("''", "'") };
        }
    }
    for (const key of ["endpoint", "selected", "refresh", "warning"]) mocks[key].mockReset();
    mocks.selected.mockReturnValue({ ids: [2, 1, 2] });
    mocks.refresh.mockResolvedValue(undefined);
    mocks.endpoint.mockImplementation(async (route, options) => {
        if (options.method === "GET") return fixture(mocks.selected().ids.length ? [1, 2] : []);
        if (route === "adminRowGroupMemberships") return { success: true };
        const body = options.body_data.classification || options.body_data;
        const records = options.body_data.classification ? fixture().classifications : fixture().groups;
        return { ...body, slug: body.slug || records.find((record) => record.id === body.id)?.slug || "nature",
            id: body.id || (options.body_data.classification ? 10 : 11) };
    });
});

describe("classification assignment window", () => {
    test("captures sorted selection using target; renders mixed radios and checkboxes", async () => {
        await open();
        const query = new URLSearchParams(mocks.endpoint.mock.calls[0][1].url_params);
        expect(query.get("target")).toBe("orders");
        expect(query.get("row_ids")).toBe("1,2");
        expect(query.has("dataset")).toBe(false);
        expect(control(1).type).toBe("radio");
        expect(control(1).checked).toBe(false);
        expect(control(1).getAttribute("aria-describedby")).toBe("row-group-mixed-1");
        expect(document.querySelector("#row-group-mixed-1").textContent).toContain("Osalla riveistä");
        expect(control(3).type).toBe("checkbox");
        expect(control(3).indeterminate).toBe(true);
        expect(control(3).getAttribute("aria-checked")).toBe("mixed");
        expect(control(4).checked).toBe(true);
        expect(document.querySelector('[data-testid="row-group-save"]').disabled).toBe(true);
    });
    test("applies only the difference once per value and refreshes through the existing path", async () => {
        await open();
        change(control(3), true);
        mocks.selected.mockReturnValue({ ids: [999] }); // Later selection must not widen this draft.
        save();
        await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledWith("orders", { skipUrlParams: true }));
        expect(membershipCalls()).toEqual([expect.objectContaining({ method: "POST", body_data: { dataset: "orders", group_id: 3, row_ids: [2] } })]);
    });
    test("radio replaces peers through exactly one atomic POST", async () => {
        await open();
        change(control(1), true);
        expect(control(1).checked).toBe(true);
        expect(control(2).checked).toBe(false);
        save();
        await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
        expect(membershipCalls().map(({ method, body_data }) => [method, body_data])).toEqual([
            ["POST", { dataset: "orders", group_id: 1, row_ids: [2] }],
        ]);
    });
    test.each(["heading-1", "value-2"])("disabling %s after a failed replacement preserves the stored assignment", async (enabledIdentity) => {
        mocks.selected.mockReturnValue({ ids: [1] });
        mocks.endpoint.mockResolvedValueOnce(fixture([1]));
        await open();
        change(control(2), true);
        const original = mocks.endpoint.getMockImplementation();
        let assignedValue = 1;
        let failReplacement = true;
        mocks.endpoint.mockImplementation(async (route, options) => {
            if (route !== "adminRowGroupMemberships") return original(route, options);
            if (options.method === "POST" && failReplacement) {
                failReplacement = false;
                throw new Error("replacement failed");
            }
            // Model persisted membership so an early DELETE would lose the old value.
            if (options.method === "DELETE" && assignedValue === options.body_data.group_id) assignedValue = null;
            if (options.method === "POST") assignedValue = options.body_data.group_id;
            return { success: true };
        });
        save();
        await vi.waitFor(() => expect(document.querySelector('[role="status"]').textContent).toContain("Tallennus ei onnistunut"));
        expect(assignedValue).toBe(1);
        expect(mocks.refresh).not.toHaveBeenCalled();
        change(document.querySelector(`[data-metadata-enabled="${enabledIdentity}"]`), false);
        expect(control(1).checked).toBe(true);
        expect(control(2).checked).toBe(false);
        save();
        await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
        expect(assignedValue).toBe(1);
        expect(membershipCalls().map(({ method, body_data }) => [method, body_data])).toEqual([
            ["POST", { dataset: "orders", group_id: 2, row_ids: [1] }],
        ]);
        const metadata = mocks.endpoint.mock.calls.find(([route, options]) => route === "adminRowGroups" && options.method === "POST")[1].body_data;
        expect(metadata.classification || metadata).toEqual({ id: enabledIdentity === "heading-1" ? 1 : 2, enabled: false });
    });
    test.each(["rejected", "unsuccessful"])("a %s replacement POST retries the same POST without deleting peers", async (failure) => {
        mocks.selected.mockReturnValue({ ids: [1] });
        mocks.endpoint.mockResolvedValueOnce(fixture([1]));
        await open();
        change(control(2), true);
        const original = mocks.endpoint.getMockImplementation();
        let failReplacement = true;
        mocks.endpoint.mockImplementation(async (route, options) => {
            if (route === "adminRowGroupMemberships" && options.method === "POST" && failReplacement) {
                failReplacement = false;
                if (failure === "rejected") throw new Error("replacement failed");
                return { success: false };
            }
            return original(route, options);
        });
        save();
        await vi.waitFor(() => expect(document.querySelector('[role="status"]').textContent).toContain("Tallennus ei onnistunut"));
        expect(control(2).checked).toBe(true);
        expect(mocks.refresh).not.toHaveBeenCalled();
        save();
        await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
        const replacement = ["POST", { dataset: "orders", group_id: 2, row_ids: [1] }];
        expect(membershipCalls().map(({ method, body_data }) => [method, body_data])).toEqual([replacement, replacement]);
    });
    test("successful replacement advances all peer baselines before a later refresh failure", async () => {
        mocks.selected.mockReturnValue({ ids: [1] });
        mocks.endpoint.mockResolvedValueOnce(fixture([1]));
        mocks.refresh.mockRejectedValueOnce(new Error("refresh failed"));
        await open();
        change(control(2), true);
        save();
        await vi.waitFor(() => expect(document.querySelector('[role="status"]').textContent).toContain("Tallennus ei onnistunut"));
        change(control(1), true);
        change(document.querySelector('[data-metadata-enabled="value-1"]'), false);
        expect(control(1).checked).toBe(false);
        expect(control(2).checked).toBe(true);
        document.querySelector('button[data-lang-key="row_group_window_clear_assignment"]').click();
        save();
        await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(2));
        expect(membershipCalls().map(({ method, body_data }) => [method, body_data])).toEqual([
            ["POST", { dataset: "orders", group_id: 2, row_ids: [1] }],
            ["DELETE", { dataset: "orders", group_id: 2, row_ids: [1] }],
        ]);
    });
    test("clears class assignments while unchanged category values remain untouched", async () => {
        await open();
        Array.from(document.querySelectorAll("button")).find((node) => node.dataset.langKey === "row_group_window_clear_assignment").click();
        save();
        await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
        expect(membershipCalls().map(({ method, body_data }) => [method, body_data.group_id])).toEqual([["DELETE", 1], ["DELETE", 2]]);
    });
    test.each(["heading-1", "value-2"])("disabling %s cancels the whole radio replacement and preserves the assigned value", async (enabledIdentity) => {
        mocks.selected.mockReturnValue({ ids: [1] });
        mocks.endpoint.mockResolvedValueOnce(fixture([1]));
        await open();
        expect(control(1).checked).toBe(true);
        change(control(2), true);
        change(document.querySelector(`[data-metadata-enabled="${enabledIdentity}"]`), false);
        const assigned = control(1);
        const replacement = control(2);
        save();
        await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
        expect(membershipCalls()).toEqual([]);
        expect(assigned.checked).toBe(true);
        expect(replacement.checked).toBe(false);
        const metadata = mocks.endpoint.mock.calls.find(([route, options]) => route === "adminRowGroups" && options.method === "POST")[1].body_data;
        expect(metadata.classification || metadata).toEqual({ id: enabledIdentity === "heading-1" ? 1 : 2, enabled: false });
    });
    test.each(["heading-1", "value-2"])("an explicit clear still removes the assignment after disabling %s", async (enabledIdentity) => {
        mocks.selected.mockReturnValue({ ids: [1] });
        mocks.endpoint.mockResolvedValueOnce(fixture([1]));
        await open();
        change(control(2), true);
        document.querySelector('button[data-lang-key="row_group_window_clear_assignment"]').click();
        change(document.querySelector(`[data-metadata-enabled="${enabledIdentity}"]`), false);
        save();
        await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
        expect(membershipCalls().map(({ method, body_data }) => [method, body_data])).toEqual([
            ["DELETE", { dataset: "orders", group_id: 1, row_ids: [1] }],
        ]);
    });
    test("disabling an unchosen class peer keeps the pending replacement", async () => {
        mocks.selected.mockReturnValue({ ids: [1] });
        mocks.endpoint.mockResolvedValueOnce(fixture([1]));
        await open();
        change(control(2), true);
        change(document.querySelector('[data-metadata-enabled="value-1"]'), false);
        save();
        await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
        expect(membershipCalls().map(({ method, body_data }) => [method, body_data])).toEqual([
            ["POST", { dataset: "orders", group_id: 2, row_ids: [1] }],
        ]);
    });
    test("creates a heading and value inline in names-only mode, preserving their relationship", async () => {
        mocks.selected.mockReturnValue({ ids: [] });
        await open();
        expect(document.querySelectorAll('[data-value-id]')).toHaveLength(0);
        document.querySelector('[data-testid="row-group-new-heading"]').click();
        const heading = document.querySelector('[data-testid="row-group-slug"]').closest("fieldset");
        input(heading.querySelector('[data-name-language="fi"]'), "Majoitus");
        input(heading.querySelector('[data-name-language="en"]'), "Stay");
        input(heading.querySelector('[data-testid="row-group-slug"]'), "stay");
        heading.querySelector('button[data-lang-key="row_group_window_new_value"]').click();
        const value = document.querySelector('[data-testid="row-group-slug"]').closest("fieldset").querySelector(".row-group-editor__value");
        input(value.querySelector('[data-name-language="fi"]'), "Hotelli");
        input(value.querySelector('[data-name-language="en"]'), "Hotel");
        input(value.querySelector('[data-testid="row-group-slug"]'), "hotel");
        save();
        await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
        const posts = mocks.endpoint.mock.calls.filter(([route, options]) => route === "adminRowGroups" && options.method === "POST");
        expect(posts.map(([, options]) => options.body_data)).toEqual([
            { classification: { slug: "stay", title: { fi: "Majoitus", en: "Stay" }, sort_order: 0, enabled: true, is_single: false } },
            { slug: "hotel", title: { fi: "Hotelli", en: "Hotel" }, sort_order: 0, enabled: true, classification_id: 10 },
        ]);
        expect(membershipCalls()).toHaveLength(0);
    });
    test("changing a new category to a class keeps only one pending radio value", async () => {
        await open();
        document.querySelector('[data-testid="row-group-new-heading"]').click();
        const newHeading = () => document.querySelector('[data-testid="row-group-slug"]').closest("fieldset");
        newHeading().querySelector('button[data-lang-key="row_group_window_new_value"]').click();
        newHeading().querySelector('button[data-lang-key="row_group_window_new_value"]').click();
        change(control(-2), true);
        change(control(-3), true);
        const type = newHeading().querySelector("select");
        type.value = "true";
        type.dispatchEvent(new Event("change", { bubbles: true }));
        expect(control(-2).type).toBe("radio");
        expect(control(-2).checked).toBe(true);
        expect(control(-3).checked).toBe(false);
    });
    test.each(["fi", "en"])("failure retains names and assignment draft with a translated error (%s)", async (language) => {
        mocks.language = language;
        await open();
        const value = control(3).closest(".row-group-editor__value");
        input(value.querySelector('[data-name-language="fi"]'), "Uusi luonto");
        change(control(3), true);
        mocks.endpoint.mockRejectedValueOnce(new Error("raw English backend error"));
        save();
        await vi.waitFor(() => expect(document.querySelector('[role="status"]').textContent).toBe(mocks.copy.row_group_window_save_failed[language]));
        expect(control(3).checked).toBe(true);
        expect(control(3).closest(".row-group-editor__value").querySelector('[data-name-language="fi"]').value).toBe("Uusi luonto");
        expect(mocks.refresh).not.toHaveBeenCalled();
        expect(document.querySelector('[data-testid="row-group-save"]').disabled).toBe(false);
    });
    test("a partial failure retains remaining draft and retry omits the successful write", async () => {
        await open();
        change(control(3), true);
        change(control(4), false);
        const original = mocks.endpoint.getMockImplementation();
        let failed = false;
        mocks.endpoint.mockImplementation(async (route, options) => {
            if (route === "adminRowGroupMemberships" && options.method === "POST" && !failed) { failed = true; throw new Error("failed"); }
            return original(route, options);
        });
        save();
        await vi.waitFor(() => expect(document.querySelector('[role="status"]').textContent).toContain("Tallennus ei onnistunut"));
        expect(control(3).checked).toBe(true);
        expect(control(4).checked).toBe(false);
        save();
        await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
        expect(membershipCalls().map((options) => options.method)).toEqual(["DELETE", "POST", "POST"]);
    });
    test("rename, order and enable edit only mutable fields and preserve other languages", async () => {
        const data = fixture();
        data.groups[2].title.sv = "Natur";
        mocks.endpoint.mockResolvedValueOnce(data);
        await open();
        const value = control(3).closest(".row-group-editor__value");
        input(value.querySelector('[data-name-language="fi"]'), "Uusi luonto");
        input(value.querySelector('input[type="number"]'), "-7");
        change(value.querySelector('details input[type="checkbox"]'), false);
        save();
        await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
        expect(mocks.endpoint.mock.calls[1][1].body_data).toEqual({ id: 3, title: { fi: "Uusi luonto", en: "Nature", sv: "Natur" }, sort_order: -7, enabled: false });
    });
    test("cancel and successful saving return focus to the opener", async () => {
        const opener = await open();
        document.querySelector('[data-lang-key="cancel"]').click();
        await vi.waitFor(() => expect(document.activeElement).toBe(opener));
        await openRowGroupAssignmentEditor("orders", opener);
        change(control(3), true);
        save();
        await vi.waitFor(() => expect(document.activeElement).toBe(opener));
    });
    test("rejects oversized selection and widened readback without writable controls", async () => {
        mocks.selected.mockReturnValue({ ids: Array.from({ length: 201 }, (_, index) => index + 1) });
        expect(await openRowGroupAssignmentEditor("orders")).toBeNull();
        expect(mocks.endpoint).not.toHaveBeenCalled();
        mocks.selected.mockReturnValue({ ids: [1, 2] });
        mocks.endpoint.mockResolvedValueOnce({ ...fixture(), row_ids: [1, 999] });
        await open();
        expect(document.querySelector('[role="status"]').textContent).toBe(mocks.copy.row_group_window_load_failed.fi);
        expect(document.querySelectorAll('[data-value-id]')).toHaveLength(0);
        expect(document.querySelector('[data-testid="row-group-save"]').disabled).toBe(true);
    });
    test("every editor request keeps dataset out of query parameters", async () => {
        await open();
        change(control(1), true);
        save();
        await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
        for (const [, options] of mocks.endpoint.mock.calls) {
            expect(new URLSearchParams(options.url_params).has("dataset")).toBe(false);
        }
    });
});
