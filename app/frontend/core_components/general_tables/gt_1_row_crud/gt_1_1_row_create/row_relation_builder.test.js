/* @vitest-environment jsdom */

import { beforeEach, describe, expect, test, vi } from "vitest";
import {
    applySelectedFileMetadata,
    applyWebImageSelectionMetadata,
    buildOneToManySection,
    buildFileAcceptAttribute,
    isOptionalLocationRelation,
    isSharedAssetRelation,
    readRelationCreateSetting,
    resolveAssetKindForSelectedFile,
    resolveFileUploadProfiles,
} from "./row_relation_builder.js";

vi.mock("./row_api_fetcher.js", () => ({
    fetchColumnsInfo: vi.fn(),
}));

vi.mock("./row_input_builder.js", () => ({
    get_input_type: vi.fn(() => "text"),
}));

vi.mock("./row_geometry_builder.js", () => ({
    buildChildGeometryField: vi.fn(),
}));

vi.mock("../../../../reusable_components/notifications/toast_notification_printer.js", () => ({
    showWarningToast: vi.fn(),
}));

vi.mock("../../../../reusable_components/image_source_picker/image_source_picker.js", () => ({
    getImageSourcePickerText: vi.fn((_key, fallback) => fallback),
    openImageSourcePicker: vi.fn(),
}));

vi.mock("../../../lang/translation_handler.js", () => ({
    getTranslationForKey: vi.fn(() => ""),
}));

import { fetchColumnsInfo } from "./row_api_fetcher.js";
import { openImageSourcePicker } from "../../../../reusable_components/image_source_picker/image_source_picker.js";

beforeEach(() => {
    vi.clearAllMocks();
    document.body.replaceChildren();
    localStorage.clear();
});

function multilingualTextColumn(columnName) {
    return {
        column_name: columnName,
        data_type: "text",
        is_nullable: "NO",
        is_multilingual: true,
        multilingual_languages: [
            {
                language_code: "fi",
                native_name: "Suomi",
                english_name: "Finnish",
                is_default: true,
            },
            {
                language_code: "en",
                native_name: "English",
                english_name: "English",
                is_default: false,
            },
        ],
    };
}

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

describe("owned child relation classification", () => {
    test("recognizes explicit relation settings and spatial location schemas", () => {
        expect(readRelationCreateSetting({
            insert_new_source_with_target: { Bool: true, Valid: true },
        })).toBe(true);
        expect(readRelationCreateSetting({
            insert_new_source_with_target: { Bool: false, Valid: true },
        })).toBe(false);
        expect(isOptionalLocationRelation([
            { column_name: "position", data_type: "USER-DEFINED", udt_name: "geometry" },
            { column_name: "title", data_type: "text" },
        ])).toBe(false);
        expect(isOptionalLocationRelation([
            { column_name: "position", data_type: "geometry" },
        ])).toBe(true);
    });

    test("builds an optional location child page only for an explicitly enabled spatial relation", async () => {
        fetchColumnsInfo.mockResolvedValue([
            { column_name: "service_id", data_type: "integer" },
            { column_name: "id", data_type: "integer" },
            { column_name: "position", data_type: "geometry" },
            { column_name: "title", data_type: "text", is_nullable: "YES" },
        ]);
        const form = document.createElement("form");
        const modalFormState = {};

        await buildOneToManySection(form, [{
            relation_id: 264,
            source_table_uid: "220",
            source_dataset_name: "app_service_locations",
            source_column_name: "service_id",
            insert_new_source_with_target: { Bool: true, Valid: true },
            target_insert_specs: "{}",
        }], modalFormState);

        expect(form.querySelectorAll("fieldset")).toHaveLength(1);
        expect(modalFormState._childRowsArray).toHaveLength(1);
        expect(modalFormState._childRowsArray[0]).toMatchObject({
            ownedChildKind: "location",
            sharedAssetRelation: false,
        });
        expect(form.querySelector('[data-col-name="id"]')).toBeNull();
        expect(form.querySelector('[data-col-name="title"]')?.required).toBe(false);
    });
});

describe("buildOneToManySection", () => {
    test("stores child multilingual input as a language map without a scalar fallback", async () => {
        fetchColumnsInfo.mockResolvedValue([
            { column_name: "article_id", data_type: "integer" },
            multilingualTextColumn("caption"),
        ]);

        const form = document.createElement("form");
        const modalFormState = {};

        await buildOneToManySection(form, [{
            relation_id: 41,
            source_table_uid: "501",
            source_dataset_name: "article_captions",
            source_column_name: "article_id",
            target_insert_specs: JSON.stringify({
                file_upload: { enabled: true },
            }),
        }], modalFormState);

        const multilingualGroup = form.querySelector(
            '[data-multilingual-column="caption"]'
        );
        const finnish = multilingualGroup?.querySelector('[data-language-code="fi"]');
        const english = multilingualGroup?.querySelector('[data-language-code="en"]');

        expect(multilingualGroup).not.toBeNull();
        expect(finnish).not.toBeNull();
        expect(english).not.toBeNull();
        expect(form.querySelector('[data-col-name="caption"]')).toBeNull();

        finnish.value = "Sataman iltavalaistus";
        finnish.dispatchEvent(new Event("input"));
        english.value = "Harbour lighting at dusk";
        english.dispatchEvent(new Event("input"));

        expect(modalFormState._childRowsArray).toHaveLength(1);
        expect(JSON.parse(modalFormState._childRowsArray[0].data.caption)).toEqual({
            fi: "Sataman iltavalaistus",
            en: "Harbour lighting at dusk",
        });
    });

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
            relation_id: 42,
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

    test("opens the web picker only for the image profile and keeps the file in that child row", async () => {
        fetchColumnsInfo.mockResolvedValue([
            { column_name: "article_id", data_type: "INTEGER" },
            { column_name: "filename", data_type: "TEXT" },
            { column_name: "asset_kind", data_type: "TEXT" },
            { column_name: "original_name", data_type: "TEXT" },
            { column_name: "mime_type", data_type: "TEXT" },
            { column_name: "size_bytes", data_type: "INTEGER" },
            { column_name: "title", data_type: "TEXT", is_multilingual: false },
            multilingualTextColumn("description"),
            { column_name: "metadata_json", data_type: "TEXT", is_multilingual: false },
        ]);
        const form = document.createElement("form");
        const modalFormState = {};
        await buildOneToManySection(form, [{
            relation_id: 43,
            source_table_uid: "123",
            source_dataset_name: "article_assets",
            source_column_name: "article_id",
            target_insert_specs: JSON.stringify({
                file_upload: {
                    enabled: true,
                    filename_column: "filename",
                    profiles: {
                        image: { enabled: true, asset_kinds: ["image"], allowed_file_types: ["jpg"] },
                        attachment: { enabled: true, asset_kinds: ["document"], allowed_file_types: ["pdf"] },
                    },
                },
            }),
        }], modalFormState);

        expect(form.querySelectorAll('[data-testid="child-image-source-picker-open"]')).toHaveLength(1);
        form.querySelector('[data-testid="child-image-source-picker-open"]').click();
        expect(openImageSourcePicker).toHaveBeenCalledOnce();

        const file = new File(["image"], "pexels-123.jpg", { type: "image/jpeg" });
        openImageSourcePicker.mock.calls[0][0].onSelect({
            file,
            captions: { fi: "Kuva: Tekijä / Pexels.", en: "Photo: Author / Pexels." },
            selection: {
                schema_version: "1",
                provider: "pexels",
                provider_asset_id: "123",
                source_page_url: "https://www.pexels.com/photo/example-123/",
                creator_name: "Author",
                description: "Mountain lake",
                image: { alt_text: "Mountain lake", width: 1200, height: 800 },
            },
        });

        const imageState = modalFormState._childRowsArray.find((row) => row.fileUploadSpec?.profile_key === "image");
        const attachmentState = modalFormState._childRowsArray.find((row) => row.fileUploadSpec?.profile_key === "attachment");
        expect(imageState._actualFileObjects).toEqual([file]);
        expect(attachmentState._actualFileObjects).toBeUndefined();
        expect(JSON.parse(imageState.data.description)).toEqual({
            fi: "Kuva: Tekijä / Pexels.",
            en: "Photo: Author / Pexels.",
        });
        expect(imageState.data.title).toBe("Mountain lake");
        expect(JSON.parse(imageState.data.metadata_json).image_source).toMatchObject({
            provider: "pexels",
            provider_asset_id: "123",
        });
        expect(form.querySelector('[data-testid="child-file-upload-selected-image"]').textContent).toContain("pexels-123.jpg");
    });
});

describe("applyWebImageSelectionMetadata", () => {
    test("does not invent columns that the child table does not have", () => {
        const state = { data: {}, _fieldControls: new Map() };
        applyWebImageSelectionMetadata(state, {
            file: new File(["image"], "image.jpg", { type: "image/jpeg" }),
            selection: { provider: "pexels", provider_asset_id: "1", image: {} },
            captions: { fi: "Kuva", en: "Photo" },
        });
        expect(state.data).toEqual({});
    });
});
