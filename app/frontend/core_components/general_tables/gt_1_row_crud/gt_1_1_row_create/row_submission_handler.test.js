/* @vitest-environment jsdom */

import { describe, expect, test } from "vitest";
import {
    appendFormActions,
    collectChildRowsForSubmission,
    collectExistingLinksForSubmission,
    collectExistingImagesForSubmission,
    shouldSubmitChildRow,
} from "./row_submission_handler.js";
import { initializeFormSectionNavigator } from "../../../../reusable_components/form_section_navigator/form_section_navigator.js";

describe("appendFormActions", () => {
    test("shows Add only on the final form page while Next advances to it", () => {
        const form = document.createElement("form");
        form.dataset.formSectionNavigator = "";
        form.dataset.formSectionNextLangKey = "next";
        form.dataset.formSectionNextLabel = "Next";
        ["details", "images"].forEach((key) => {
            const section = document.createElement("section");
            section.dataset.formSection = "";
            section.dataset.sectionKey = key;
            section.dataset.sectionLabel = key;
            form.appendChild(section);
        });

        appendFormActions(form, "table-uid", [], {}, () => {});
        initializeFormSectionNavigator(form);

        const sections = form.querySelectorAll(":scope > section[data-form-section]");
        const submitButton = form.querySelector('[data-testid="btn-add-row-submit"]');
        const nextButton = form.querySelector('[data-form-section-footer-direction="next"]');
        expect(submitButton.closest("section")).toBe(sections[1]);
        expect(sections[1].hidden).toBe(true);
        expect(nextButton.dataset.langKey).toBe("next");
        expect(nextButton.textContent).toBe("Next");

        nextButton.click();
        expect(sections[1].hidden).toBe(false);
        expect(nextButton.hidden).toBe(true);
    });
});

describe("shouldSubmitChildRow", () => {
    test("skips empty shared-asset child placeholders", () => {
        expect(shouldSubmitChildRow({
            datasetName: "contracts_assets",
            data: {},
        })).toBe(false);
    });

    test("keeps rows that contain a selected file", () => {
        expect(shouldSubmitChildRow({
            datasetName: "contracts_assets",
            data: {},
            _actualFileObject: { name: "contract.pdf" },
        })).toBe(true);
    });

    test("treats explicit shared-asset metadata as authoritative even without _assets suffix", () => {
        expect(shouldSubmitChildRow({
            datasetName: "contracts_media",
            sharedAssetRelation: true,
            data: {},
            _actualFileObject: { name: "contract.pdf" },
        })).toBe(true);
    });

    test("refuses typed child data for ordinary non-asset child rows", () => {
        expect(shouldSubmitChildRow({
            datasetName: "contracts_notes",
            data: {
                title: "Offer sheet",
            },
        })).toBe(false);
    });

    test("submits an optional location child only after the user provides location data", () => {
        expect(shouldSubmitChildRow({
            datasetName: "service_locations",
            ownedChildKind: "location",
            data: { position: "", title: "" },
        })).toBe(false);
        expect(shouldSubmitChildRow({
            datasetName: "service_locations",
            ownedChildKind: "location",
            data: { position: "POINT(24.94 60.17)" },
        })).toBe(true);
    });

    test("keeps shared-asset rows that contain multiple selected files", () => {
        expect(shouldSubmitChildRow({
            datasetName: "contracts_assets",
            data: {},
            _actualFileObjects: [
                { name: "offer.pdf" },
                { name: "notes.docx" },
            ],
        })).toBe(true);
    });
});

describe("collectExistingLinksForSubmission", () => {
    test("keeps stable relation identifiers and deduplicated row IDs", () => {
        expect(collectExistingLinksForSubmission([{
            relationKind: "many_to_many",
            relationId: "72",
            rowIds: ["8", 8, "11", "invalid"],
        }])).toEqual([{
            relationKind: "many_to_many",
            relationId: 72,
            rowIds: [8, 11],
        }]);
    });

    test("drops empty and invalid relation selections", () => {
        expect(collectExistingLinksForSubmission([
            { relationKind: "one_to_many", relationId: 0, rowIds: [1] },
            { relationKind: "many_to_many", relationId: 2, rowIds: [] },
        ])).toEqual([]);
    });
});

describe("collectChildRowsForSubmission", () => {
	test("keeps a filled location child without requiring a file", () => {
		const { childRowsToSend, childFiles } = collectChildRowsForSubmission([{
			relationId: 264,
			datasetName: "app_service_locations",
			referencingColumn: "service_id",
			ownedChildKind: "location",
			data: { position: "POINT(24.94 60.17)" },
		}]);

		expect(childRowsToSend).toHaveLength(1);
		expect(childRowsToSend[0].data.position).toBe("POINT(24.94 60.17)");
		expect(childFiles).toEqual([null]);
	});

    test("expands shared attachment selections into one child row per file", () => {
        const files = [
            new File(["%PDF-1.4"], "offer.pdf", { type: "application/pdf" }),
            new File(["hello"], "notes.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
        ];

        const { childRowsToSend, childFiles } = collectChildRowsForSubmission([
            {
                datasetName: "contracts_assets",
                referencingColumn: "contract_id",
                data: {},
                fileUploadSpec: {
                    filename_column: "filename",
                    profile_key: "attachment",
                    asset_kinds: ["pdf", "document", "archive"],
                },
                _actualFileObjects: files,
            },
        ]);

        expect(childRowsToSend).toHaveLength(2);
        expect(childFiles).toHaveLength(2);
        expect(childFiles[0]?.name).toBe("offer.pdf");
        expect(childFiles[1]?.name).toBe("notes.docx");
        expect(childRowsToSend[0].data).toMatchObject({
            filename: "offer.pdf",
            original_name: "offer.pdf",
            mime_type: "application/pdf",
            asset_kind: "pdf",
        });
        expect(childRowsToSend[1].data).toMatchObject({
            filename: "notes.docx",
            original_name: "notes.docx",
            asset_kind: "document",
        });
    });

    test("expands explicit shared-asset child rows even when dataset name is not suffixed with _assets", () => {
        const files = [
            new File(["%PDF-1.4"], "offer.pdf", { type: "application/pdf" }),
            new File(["hello"], "notes.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
        ];

        const { childRowsToSend } = collectChildRowsForSubmission([
            {
                datasetName: "contracts_media",
                sharedAssetRelation: true,
                referencingColumn: "contract_id",
                data: {},
                fileUploadSpec: {
                    filename_column: "filename",
                    profile_key: "attachment",
                    asset_kinds: ["pdf", "document", "archive"],
                },
                _actualFileObjects: files,
            },
        ]);

        expect(childRowsToSend).toHaveLength(2);
        expect(childRowsToSend[0].data.asset_kind).toBe("pdf");
        expect(childRowsToSend[1].data.asset_kind).toBe("document");
    });
});


describe("existing image submission", () => {
    test("sends only server identities and no pretend upload or source path", () => {
        const child = { sharedAssetRelation: true, _existingImage: { relation_id: 17, source_row_id: 9, url: "/private" } };
        expect(collectExistingImagesForSubmission([child])).toEqual([{ relation_id: 17, source_row_id: 9 }]);
        expect(collectChildRowsForSubmission([child])).toEqual({ childRowsToSend: [], childFiles: [] });
    });
    test("skips invalid or cleared selections", () => {
        expect(collectExistingImagesForSubmission([{}, { _existingImage: { relation_id: -1, source_row_id: 9 } }])).toEqual([]);
    });
});
