/* @vitest-environment jsdom */

import { beforeEach, describe, expect, test, vi } from "vitest";
import {
    applySelectedFileMetadata,
    buildManyToManySection,
    buildOneToManySection,
    buildFileAcceptAttribute,
    isSharedAssetRelation,
    resolveAssetKindForSelectedFile,
    resolveFileUploadProfiles,
} from "./row_relation_builder.js";

vi.mock("./row_api_fetcher.js", () => ({
    fetchColumnsInfo: vi.fn(),
    fetchReferencedData: vi.fn(),
}));

vi.mock("./row_input_builder.js", () => ({
    get_input_type: vi.fn(() => "text"),
}));

vi.mock("./row_geometry_builder.js", () => ({
    buildChildGeometryField: vi.fn(),
}));

vi.mock("../../../../reusable_components/vanilla_dropdown/vanilla_dropdown_builder.js", () => ({
    createVanillaDropdown: vi.fn(),
}));

vi.mock("../../../../reusable_components/notifications/toast_notification_printer.js", () => ({
    showWarningToast: vi.fn(),
}));

vi.mock("../../../lang/translation_handler.js", () => ({
    getTranslationForKey: vi.fn(() => ""),
}));

import { fetchColumnsInfo, fetchReferencedData } from "./row_api_fetcher.js";
import { createVanillaDropdown } from "../../../../reusable_components/vanilla_dropdown/vanilla_dropdown_builder.js";

beforeEach(() => {
    vi.clearAllMocks();
    document.body.replaceChildren();
    localStorage.clear();
});

describe("resolveFileUploadProfiles", () => {
    test("expands shared asset profile maps in stable image-then-attachment order", () => {
        const profiles = resolveFileUploadProfiles({
            enabled: true,
            filename_column: "filename",
            profiles: {
                attachment: {
                    enabled: true,
                    asset_kinds: ["pdf", "document", "archive"],
                    allowed_file_types: ["pdf", "docx", "zip"],
                    max_file_size_mb: 25,
                },
                image: {
                    enabled: true,
                    asset_kinds: ["image"],
                    allowed_file_types: ["png", "webp"],
                    max_file_size_mb: 10,
                },
            },
        });

        expect(profiles.map((profile) => profile.profile_key)).toEqual(["image", "attachment"]);
        expect(profiles[0].filename_column).toBe("filename");
        expect(profiles[1].allowed_file_types).toEqual(["pdf", "docx", "zip"]);
    });
});

describe("buildFileAcceptAttribute", () => {
    test("formats file extensions for input accept attribute", () => {
        expect(buildFileAcceptAttribute(["png", ".webp", "pdf"])).toBe(".png,.webp,.pdf");
    });

    test("returns empty string when no types exist", () => {
        expect(buildFileAcceptAttribute([])).toBe("");
        expect(buildFileAcceptAttribute(null)).toBe("");
    });
});

describe("resolveAssetKindForSelectedFile", () => {
    test("infers attachment kind from file metadata", () => {
        const assetKind = resolveAssetKindForSelectedFile(
            { asset_kinds: ["pdf", "document", "archive"] },
            new File(["%PDF-1.4"], "contract.pdf", { type: "application/pdf" })
        );

        expect(assetKind).toBe("pdf");
    });
});

describe("applySelectedFileMetadata", () => {
    test("writes canonical shared-asset metadata for _assets rows", () => {
        const childObjectState = {
            datasetName: "contracts_assets",
            data: {},
        };

        applySelectedFileMetadata(
            childObjectState,
            {
                filename_column: "filename",
                asset_kinds: ["pdf", "document", "archive"],
            },
            new File(["hello"], "contract.pdf", { type: "application/pdf" })
        );

        expect(childObjectState.data).toMatchObject({
            filename: "contract.pdf",
            original_name: "contract.pdf",
            mime_type: "application/pdf",
            asset_kind: "pdf",
        });
        expect(typeof childObjectState.data.size_bytes).toBe("number");
        expect(childObjectState.data.size_bytes).toBeGreaterThan(0);
    });

    test("writes canonical shared-asset metadata when relation metadata marks the child as shared assets", () => {
        const childObjectState = {
            datasetName: "contracts_media",
            data: {},
            sharedAssetRelation: true,
        };

        applySelectedFileMetadata(
            childObjectState,
            {
                filename_column: "filename",
                asset_kinds: ["pdf", "document", "archive"],
            },
            new File(["hello"], "contract.pdf", { type: "application/pdf" })
        );

        expect(childObjectState.data).toMatchObject({
            filename: "contract.pdf",
            original_name: "contract.pdf",
            mime_type: "application/pdf",
            asset_kind: "pdf",
        });
    });

    test("keeps legacy non-asset child rows on filename-only metadata", () => {
        const childObjectState = {
            datasetName: "contracts_gallery",
            data: {},
        };

        applySelectedFileMetadata(
            childObjectState,
            {
                filename_column: "filename",
                asset_kinds: ["image"],
            },
            new File(["hello"], "cover.png", { type: "image/png" })
        );

        expect(childObjectState.data).toEqual({
            filename: "cover.png",
        });
    });
});

describe("isSharedAssetRelation", () => {
    test("detects shared asset relations from file-upload profiles without relying on dataset suffix", () => {
        expect(isSharedAssetRelation({
            datasetName: "contracts_media",
            fileUploadSpec: {
                enabled: true,
                profiles: {
                    image: { enabled: true },
                    attachment: { enabled: true },
                },
            },
        })).toBe(true);
    });

    test("detects shared asset relations from metadata columns without relying on dataset suffix", () => {
        expect(isSharedAssetRelation({
            datasetName: "contracts_media",
            childColumns: [
                { column_name: "asset_kind" },
                { column_name: "mime_type" },
            ],
        })).toBe(true);
    });
});

describe("buildOneToManySection", () => {
    test("renders multi-file attachment selection chips for shared asset profiles", async () => {
        fetchColumnsInfo.mockResolvedValue([
            { column_name: "filename", data_type: "TEXT" },
            { column_name: "title", data_type: "TEXT" },
            { column_name: "asset_kind", data_type: "TEXT" },
            { column_name: "original_name", data_type: "TEXT" },
            { column_name: "mime_type", data_type: "TEXT" },
            { column_name: "size_bytes", data_type: "INTEGER" },
        ]);

        const form = document.createElement("form");
        const modalFormState = {};

        await buildOneToManySection(form, [{
            source_table_uid: "123",
            source_dataset_name: "contracts_assets",
            source_column_name: "contract_id",
            target_insert_specs: JSON.stringify({
                file_upload: {
                    enabled: true,
                    filename_column: "filename",
                    profiles: {
                        image: {
                            enabled: true,
                            asset_kinds: ["image"],
                            allowed_file_types: ["png"],
                            max_file_size_mb: 10,
                        },
                        attachment: {
                            enabled: true,
                            asset_kinds: ["pdf", "document", "archive"],
                            allowed_file_types: ["pdf", "docx", "zip"],
                            max_file_size_mb: 25,
                        },
                    },
                },
            }),
        }], modalFormState);

        const attachmentInput = form.querySelector('[data-testid="child-file-upload-attachment"]');
        expect(attachmentInput).toBeTruthy();
        expect(attachmentInput.multiple).toBe(true);
        const imageFieldset = form.querySelector('fieldset[data-upload-profile="image"]');
        const attachmentFieldset = form.querySelector('fieldset[data-upload-profile="attachment"]');
        expect(imageFieldset?.dataset.relationDatasetLangKey).toBe("contracts_assets");
        expect(attachmentFieldset?.dataset.relationKind).toBe("one-to-many");

        const files = [
            new File(["%PDF-1.4"], "offer.pdf", { type: "application/pdf" }),
            new File(["hello"], "notes.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
        ];
        Object.defineProperty(attachmentInput, "files", {
            configurable: true,
            value: files,
        });
        attachmentInput.dispatchEvent(new Event("change"));

        const selectedContainer = form.querySelector('[data-testid="child-file-upload-selected-attachment"]');
        expect(selectedContainer.children).toHaveLength(2);
        expect(selectedContainer.textContent).toContain("offer.pdf");
        expect(selectedContainer.textContent).toContain("notes.docx");

        const attachmentChildState = modalFormState._childRowsArray.find((child) => child.fileUploadSpec?.profile_key === "attachment");
        expect(Array.isArray(attachmentChildState?._actualFileObjects)).toBe(true);
        expect(attachmentChildState._actualFileObjects).toHaveLength(2);
    });
});

describe("buildManyToManySection", () => {
    test("normalizes backend M2M metadata and stores submission state", async () => {
        localStorage.setItem("chosen_language", "fi");
        fetchColumnsInfo.mockResolvedValue([
            { column_name: "id", data_type: "integer" },
            { column_name: "riski", data_type: "text" },
            { column_name: "tila", data_type: "text" },
            { column_name: "created", data_type: "timestamp with time zone" },
            { column_name: "updated", data_type: "timestamp with time zone" },
        ]);
        fetchReferencedData.mockResolvedValue([
            {
                id: 7,
                display: JSON.stringify({ en: "Data leak risk", fi: "Tietovuotoriski" }),
            },
        ]);

        const form = document.createElement("form");
        const modalFormState = {};

        await buildManyToManySection(form, [{
            bridging_dataset_name: "palvelukatalogi_riskienhallinta_relation",
            main_dataset_fk_column: "palvelu_id",
            third_table_uid: "3156",
            third_dataset_name: "riskienhallinta",
            third_dataset_fk_column: "riski_id",
        }], modalFormState);

        await Promise.resolve();
        await Promise.resolve();

        expect(fetchColumnsInfo).toHaveBeenCalledWith("3156");
        expect(fetchReferencedData).toHaveBeenCalledWith("riskienhallinta");
        expect(createVanillaDropdown).toHaveBeenCalledTimes(1);
        const relationFieldset = form.querySelector('[data-testid="many-to-many-section-riskienhallinta"]');
        expect(relationFieldset?.dataset.relationKind).toBe("many-to-many");
        expect(relationFieldset?.dataset.relationDatasetLangKey).toBe("riskienhallinta");

        const relationState = modalFormState._manyToManyRows[0];
        expect(relationState).toMatchObject({
            linkTableName: "palvelukatalogi_riskienhallinta_relation",
            mainTableFkColumn: "palvelu_id",
            thirdTableName: "riskienhallinta",
            thirdTableFkColumn: "riski_id",
            modeRadioName: "m2m_mode_riskienhallinta",
        });

        const dropdownConfig = createVanillaDropdown.mock.calls[0][0];
        expect(dropdownConfig.options).toEqual([{
            value: 7,
            label: "7 - Tietovuotoriski",
        }]);
        dropdownConfig.onChange("7");
        expect(relationState.existingHiddenInput.value).toBe("7");

        const newRadio = form.querySelector('input[name="m2m_mode_riskienhallinta"][value="new"]');
        newRadio.checked = true;
        newRadio.dispatchEvent(new Event("change"));

        const newInputs = form.querySelectorAll('[data-testid="many-to-many-section-riskienhallinta"] input[type="text"]');
        newInputs[0].value = "Uusi riski";
        newInputs[0].dispatchEvent(new Event("input"));

        expect(modalFormState._m2m_new_riskienhallinta).toBe(relationState.newRowState.data);
        expect(relationState.newRowState.data).toEqual({ riski: "Uusi riski" });
    });
});
