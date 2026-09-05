/* @vitest-environment jsdom */

import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    createMultiselectDropdown: vi.fn(),
    fetchLinkableRows: vi.fn(),
}));

vi.mock("../../../../reusable_components/multiselect_dropdown/multiselect_dropdown_builder.js", () => ({
    createMultiselectDropdown: mocks.createMultiselectDropdown,
}));

vi.mock("./row_api_fetcher.js", () => ({
    fetchLinkableRows: mocks.fetchLinkableRows,
}));

vi.mock("../../../lang/translation_handler.js", () => ({
    getTranslationForKey: vi.fn(() => ""),
}));

vi.mock("../../../state_stores/lang_preference_reader.js", () => ({
    getLanguageWithBrowserFallback: vi.fn(() => "en"),
}));

import {
    buildExistingRelationFields,
    mapRelationOptions,
} from "./row_existing_relation_builder.js";

beforeEach(() => {
    document.body.replaceChildren();
    vi.clearAllMocks();
    mocks.fetchLinkableRows.mockResolvedValue([]);
    mocks.createMultiselectDropdown.mockImplementation((config) => ({
        setOptions: vi.fn(),
        config,
    }));
});

describe("buildExistingRelationFields", () => {
    test("uses one multiselect per relation and suppresses a duplicate 1:M path", () => {
        const container = document.createElement("section");
        document.body.appendChild(container);
        const state = {};

        const count = buildExistingRelationFields(
            container,
            [
                {
                    relation_id: 12,
                    source_dataset_name: "tickets",
                    target_insert_specs: "{}",
                },
                {
                    relation_id: 13,
                    source_dataset_name: "comments",
                    target_insert_specs: "{}",
                },
                {
                    relation_id: 14,
                    source_dataset_name: "documentation_assets",
                    target_insert_specs: JSON.stringify({ file_upload: { enabled: true } }),
                },
            ],
            [{ relation_id: 22, third_dataset_name: "tickets" }],
            state
        );

        expect(count).toBe(2);
        expect(container.querySelectorAll("fieldset")).toHaveLength(2);
        expect(state._existingRelationLinks).toEqual([
            expect.objectContaining({ relationKind: "one_to_many", relationId: 13, rowIds: [] }),
            expect.objectContaining({ relationKind: "many_to_many", relationId: 22, rowIds: [] }),
        ]);
        expect(mocks.fetchLinkableRows).toHaveBeenCalledWith("comments");
        expect(mocks.fetchLinkableRows).toHaveBeenCalledWith("tickets");

        mocks.createMultiselectDropdown.mock.calls[0][0].onChange({
            includeValues: ["4", "7"],
        });
        expect(state._existingRelationLinks[0].rowIds).toEqual(["4", "7"]);
    });
});

describe("mapRelationOptions", () => {
    test("keeps the display name concise while making the row ID searchable", () => {
        expect(mapRelationOptions([{ value: 31, label: "Security review" }])).toEqual([{
            value: "31",
            label: "Security review · #31",
            searchTerms: ["31", "Security review", "Security review"],
        }]);
    });
});
