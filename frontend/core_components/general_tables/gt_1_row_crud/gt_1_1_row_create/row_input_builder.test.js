/* @vitest-environment jsdom */

import { beforeEach, describe, expect, test, vi } from "vitest";

const setOptionsMock = vi.fn();

vi.mock("./row_api_fetcher.js", () => ({
    fetchReferencedData: vi.fn(),
}));

vi.mock("../../../../reusable_components/vanilla_dropdown/vanilla_dropdown_builder.js", () => ({
    createVanillaDropdown: vi.fn(() => ({
        setOptions: setOptionsMock,
    })),
}));

vi.mock("./row_geometry_builder.js", () => ({
    buildGeometryField: vi.fn(),
}));

import { fetchReferencedData } from "./row_api_fetcher.js";
import { buildForeignKeyField } from "./row_input_builder.js";

describe("buildForeignKeyField", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        document.body.replaceChildren();
        localStorage.clear();
    });

    test("localizes foreign labels while preserving the raw primary-key value", async () => {
        localStorage.setItem("chosen_language", "fi");
        fetchReferencedData.mockResolvedValue([
            {
                id: 7,
                display: JSON.stringify({ en: "Services", fi: "Palvelut" }),
            },
        ]);
        const form = document.createElement("form");

        buildForeignKeyField(form, "risks", {
            column_name: "service_id",
            foreign_table_name: "services",
        }, {});

        await vi.waitFor(() => expect(setOptionsMock).toHaveBeenCalledTimes(1));
        expect(setOptionsMock).toHaveBeenCalledWith([{
            value: 7,
            label: "7 - Palvelut",
        }]);
    });
});
