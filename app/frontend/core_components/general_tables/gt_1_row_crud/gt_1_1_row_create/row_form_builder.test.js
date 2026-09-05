/* @vitest-environment jsdom */

// Verifies that add-row fields and relations are split into stable navigable pages.

import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("./row_input_builder.js", () => ({
    buildForeignKeyField: vi.fn((container, _tableName, column) => {
        const input = document.createElement("input");
        input.name = column.column_name;
        container.appendChild(input);
    }),
    buildRegularField: vi.fn((container, _tableName, column) => {
        const input = document.createElement("input");
        input.name = column.column_name;
        container.appendChild(input);
    }),
}));

function relationFieldset(datasetLangKey, uploadProfileKey = "") {
    const fieldset = document.createElement("fieldset");
    fieldset.dataset.relationDatasetLangKey = datasetLangKey;
    fieldset.dataset.uploadProfile = uploadProfileKey;
    const legend = document.createElement("legend");
    const datasetLabel = document.createElement("span");
    datasetLabel.dataset.langKey = datasetLangKey;
    legend.appendChild(datasetLabel);
    fieldset.appendChild(legend);
    if (uploadProfileKey) {
        const fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.dataset.testid = `child-file-upload-${uploadProfileKey}`;
        fieldset.appendChild(fileInput);
    }
    return fieldset;
}

vi.mock("./row_relation_builder.js", () => ({
    buildOneToManySection: vi.fn(async (container) => {
        await Promise.resolve();
        container.append(
            relationFieldset("service_assets", "image"),
            relationFieldset("service_assets", "attachment")
        );
    }),
}));

vi.mock("./row_existing_relation_builder.js", () => ({
    manyToManyRelatedDatasetNames: vi.fn(() => new Set(["services"])),
    buildExistingRelationFields: vi.fn((container) => {
        container.append(
            relationFieldset("comments"),
            relationFieldset("services")
        );
        return 2;
    }),
}));

import { buildMainForm } from "./row_form_builder.js";

beforeEach(() => {
    document.body.replaceChildren();
    vi.clearAllMocks();
});

describe("buildMainForm", () => {
    test("uses one shared link page and keeps asset profiles on their own pages", async () => {
        const state = {};
        const form = await buildMainForm(
            "risks",
            [
                { column_name: "title" },
                {
                    column_name: "service_id",
                    foreign_table_name: "services",
                    is_nullable: "YES",
                },
            ],
            [{}],
            [{}],
            state
        );

        const sections = Array.from(form.querySelectorAll(":scope > section[data-form-section]"));
        expect(sections).toHaveLength(4);
        expect(sections[0].dataset.sectionKey).toBe("details");
        expect(sections[0].dataset.sectionLabelLangKey).toBe("details");
        expect(sections[0].querySelectorAll("input")).toHaveLength(1);
        expect(sections[1].querySelectorAll(":scope > fieldset")).toHaveLength(2);
        expect(sections.map((section) => section.dataset.sectionLabelLangKey)).toEqual([
            "details",
            "link_existing_data",
            "row_article_section_images",
            "row_article_section_attachments",
        ]);
        expect(sections.map((section) => section.dataset.sectionKey)).toEqual([
            "details",
            "link-existing-data",
            "relation-1",
            "relation-2",
        ]);
        expect(form.dataset.formSectionNextLangKey).toBe("next");
        expect(state._childRowsArray).toEqual([]);
        expect(state._manyToManyRows).toBeUndefined();
    });

    test("keeps a single details page when there are no relations", async () => {
        const { buildOneToManySection } = await import("./row_relation_builder.js");
        const { buildExistingRelationFields } = await import("./row_existing_relation_builder.js");
        buildOneToManySection.mockImplementationOnce(async () => {});
        buildExistingRelationFields.mockImplementationOnce(() => 0);

        const form = await buildMainForm(
            "notes",
            [{ column_name: "title" }],
            [],
            [],
            {}
        );

        expect(form.querySelectorAll(":scope > section[data-form-section]")).toHaveLength(1);
    });
});
