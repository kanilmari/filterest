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
            relationFieldset("comments"),
            relationFieldset("service_assets", "image"),
            relationFieldset("service_assets", "attachment")
        );
    }),
    buildManyToManySection: vi.fn(async (container) => {
        await Promise.resolve();
        container.appendChild(relationFieldset("services"));
    }),
}));

import { buildMainForm } from "./row_form_builder.js";

beforeEach(() => {
    document.body.replaceChildren();
    vi.clearAllMocks();
});

describe("buildMainForm", () => {
    test("awaits relations and gives every related element its own page", async () => {
        const state = {};
        const form = await buildMainForm(
            "risks",
            [
                { column_name: "title" },
                { column_name: "service_id", foreign_table_name: "services" },
            ],
            [{}],
            [{}],
            state
        );

        const sections = Array.from(form.querySelectorAll(":scope > section[data-form-section]"));
        expect(sections).toHaveLength(5);
        expect(sections[0].dataset.sectionKey).toBe("details");
        expect(sections[0].dataset.sectionLabelLangKey).toBe("details");
        expect(sections[0].querySelectorAll("input")).toHaveLength(2);
        expect(sections.slice(1).every((section) => section.querySelectorAll(":scope > fieldset").length === 1)).toBe(true);
        expect(sections.map((section) => section.dataset.sectionLabelLangKey)).toEqual([
            "details",
            "comments",
            "row_article_section_images",
            "row_article_section_attachments",
            "services",
        ]);
        expect(sections.map((section) => section.dataset.sectionKey)).toEqual([
            "details",
            "relation-1",
            "relation-2",
            "relation-3",
            "relation-4",
        ]);
        expect(form.dataset.formSectionNextLangKey).toBe("next");
        expect(state._childRowsArray).toEqual([]);
        expect(state._manyToManyRows).toEqual([]);
    });

    test("keeps a single details page when there are no relations", async () => {
        const { buildOneToManySection, buildManyToManySection } = await import("./row_relation_builder.js");
        buildOneToManySection.mockImplementationOnce(async () => {});
        buildManyToManySection.mockImplementationOnce(async () => {});

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
