/* @vitest-environment jsdom */

import { beforeEach, describe, expect, test, vi } from "vitest";

const setOptionsMock = vi.fn();

vi.mock("./row_api_fetcher.js", () => ({
    fetchLinkableRows: vi.fn(),
}));

vi.mock("../../../../reusable_components/multiselect_dropdown/multiselect_dropdown_builder.js", () => ({
    createMultiselectDropdown: vi.fn(() => ({
        setOptions: setOptionsMock,
    })),
}));

vi.mock("./row_geometry_builder.js", () => ({
    buildGeometryField: vi.fn(),
}));

import { fetchLinkableRows } from "./row_api_fetcher.js";
import { buildForeignKeyField, buildRegularField } from "./row_input_builder.js";

describe("buildForeignKeyField", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        document.body.replaceChildren();
        localStorage.clear();
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
