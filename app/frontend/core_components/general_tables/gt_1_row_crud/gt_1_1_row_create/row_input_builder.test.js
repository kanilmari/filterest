/* @vitest-environment jsdom */

import { beforeEach, describe, expect, test, vi } from "vitest";

const setOptionsMock = vi.fn();

vi.mock("./row_api_fetcher.js", () => ({
    fetchLinkableRows: vi.fn(),
}));

vi.mock("../../../../reusable_components/multiselect_dropdown/multiselect_dropdown_builder.js", () => ({
    createMultiselectDropdown: vi.fn(({containerElement}) => {
        const input = document.createElement("input");
        input.setAttribute("role", "combobox");
        containerElement.appendChild(input);
        return {setOptions: setOptionsMock};
    }),
}));

vi.mock("./row_geometry_builder.js", () => ({
    buildGeometryField: vi.fn(),
}));

import {isRequiredForeignKeyColumn} from "./row_input_builder_helpers.js";
import {createMultiselectDropdown} from "../../../../reusable_components/multiselect_dropdown/multiselect_dropdown_builder.js";
import { fetchLinkableRows } from "./row_api_fetcher.js";
import { buildForeignKeyField, buildRegularField } from "./row_input_builder.js";

describe("buildForeignKeyField", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        document.body.replaceChildren();
        localStorage.clear();
    });


    test.each([["NO", "", true], ["YES", "", false], ["NO", "'new'", false]])("marks required relation for nullable=%s/default=%s", (nullable, defaultValue, required) => {
        fetchLinkableRows.mockResolvedValue([]);
        const form = document.createElement("form");
        const fieldset = buildForeignKeyField(form, "tickets", {
            column_name: "status", foreign_table_name: "statuses", foreign_column_name: "slug",
            is_nullable: nullable, column_default: defaultValue,
        }, {});
        const chooser = fieldset.querySelector('[role="combobox"]');
        expect(chooser.getAttribute("aria-required")).toBe(String(required));
        expect(Boolean(fieldset.querySelector("abbr"))).toBe(required);
        chooser.setAttribute("aria-invalid", "true");
        createMultiselectDropdown.mock.calls.at(-1)[0].onChange({includeValues:["new"]});
        expect(form.elements.status.value).toBe("new");
        expect(chooser.hasAttribute("aria-invalid")).toBe(false);
    });


    test.each([
        ["user_id", '{"user_id":"currentUser"}'],
        ["cached_username", '{"cached_username":"currentUserName"}'],
        ["user_id", '{"user_id":"currentUser","other":null}'],
    ])("does not mark the server-filled actor field %s as required", (column_name, source_insert_specs) => {
        fetchLinkableRows.mockResolvedValue([]);
        const form = document.createElement("form");
        const fieldset = buildForeignKeyField(form, "tickets", {
            column_name, source_insert_specs, foreign_table_name: "users", foreign_column_name: "id", is_nullable: "NO",
        }, {});
        expect(fieldset.querySelector('[role="combobox"]').getAttribute("aria-required")).toBe("false");
        expect(fieldset.querySelector("abbr")).toBeNull();
    });


    test.each(['{"user_id":"otherUser"}', '{"cached_username":"currentUserName"}', '{"user_id":7}', '{"user_id":"currentUser","other":7}', 'invalid'])("rejects unsupported actor spec %s", (source_insert_specs) => {
        expect(isRequiredForeignKeyColumn({
            column_name: "user_id", is_nullable: "NO", foreign_table_name: "users", foreign_column_name: "id", source_insert_specs,
        })).toBe(true);
    });

    test("localizes foreign labels while preserving the raw primary-key value", async () => {
        localStorage.setItem("chosen_language", "fi");
        fetchLinkableRows.mockResolvedValue([
            {
                value: 7,
                label: JSON.stringify({ en: "Services", fi: "Palvelut" }),
            },
        ]);
        const form = document.createElement("form");

        buildForeignKeyField(form, "risks", {
            column_name: "service_id",
            foreign_dataset_name: "services",
            foreign_column_name: "id",
        }, {});

        await vi.waitFor(() => expect(setOptionsMock).toHaveBeenCalledTimes(1));
        expect(setOptionsMock).toHaveBeenCalledWith([{
            value: "7",
            label: "Palvelut · #7",
            searchTerms: ["7", "Palvelut", JSON.stringify({ en: "Services", fi: "Palvelut" })],
        }]);
    });
});

describe("buildRegularField", () => {
    test("routes multilingual metadata through separate language inputs", () => {
        const form = document.createElement("form");

        buildRegularField(form, "travel_info", {
            column_name: "title",
            data_type: "text",
            is_nullable: "NO",
            is_multilingual: true,
            multilingual_languages: [
                { language_code: "fi", native_name: "Suomi", english_name: "Finnish" },
                { language_code: "en", native_name: "English", english_name: "English" },
            ],
        }, {});

        expect(form.querySelector('[data-testid="form-input-title-fi"]')).not.toBeNull();
        expect(form.querySelector('[data-testid="form-input-title-en"]')).not.toBeNull();
        expect(form.querySelectorAll('textarea[name="title"]')).toHaveLength(0);
        expect(form.querySelector('input[type="hidden"][name="title"]')).not.toBeNull();
    });
});
