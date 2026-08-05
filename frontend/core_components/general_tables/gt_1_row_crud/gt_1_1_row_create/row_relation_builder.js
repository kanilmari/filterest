// row_relation_builder.js
// Builds 1-to-many and many-to-many form sections for row creation.
// Between the row creation form, FK data fetching, and the DOM.
// Exists to handle related data input fields with child row management.

import { fetchColumnsInfo, fetchReferencedData } from "./row_api_fetcher.js";
import { get_input_type } from "./row_input_builder.js";
import { buildChildGeometryField } from "./row_geometry_builder.js";
import { createVanillaDropdown } from "../../../../reusable_components/vanilla_dropdown/vanilla_dropdown_builder.js";
import { showWarningToast } from "../../../../reusable_components/notifications/toast_notification_printer.js";
import { getTranslationForKey } from "../../../lang/translation_handler.js";
import { getLanguageWithBrowserFallback } from "../../../state_stores/lang_preference_reader.js";
import { resolveDatasetDisplayValue } from "../../../table_views/dataset_value_localizer.js";

const ASSET_PROFILE_LABELS = {
    image: () => getTranslationForKey("image") || "Image",
    attachment: () => getTranslationForKey("attachments") || "Attachments",
};

const AUTO_MANAGED_ASSET_COLUMNS = new Set([
    "id",
    "created",
    "updated",
    "filename",
    "asset_kind",
    "original_name",
    "mime_type",
    "size_bytes",
    "sort_order",
    "is_primary",
]);

const AUTO_MANAGED_ASSET_METADATA_COLUMNS = new Set([
    "filename",
    "asset_kind",
    "original_name",
    "mime_type",
    "size_bytes",
]);

const SHARED_ASSET_SIGNAL_COLUMNS = new Set([
    "asset_kind",
    "original_name",
    "mime_type",
    "size_bytes",
    "sort_order",
    "is_primary",
]);

const DOCUMENT_EXTENSIONS = new Set([
    "txt", "rtf", "doc", "docx", "odt", "csv", "xls", "xlsx", "ppt", "pptx",
]);

const ARCHIVE_EXTENSIONS = new Set([
    "zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz",
]);

export async function buildOneToManySection(form, oneToManyRelations, modal_form_state) {
    modal_form_state["_childRowsArray"] =
        modal_form_state["_childRowsArray"] || [];

    for (const ref of oneToManyRelations) {
        if (
            ref.insert_new_source_with_target &&
            ref.insert_new_source_with_target.Bool === false
        ) {
            continue;
        }

        try {
            let childColumns = await fetchColumnsInfo(ref.source_table_uid);
            childColumns = childColumns.filter(
                (cc) => cc.column_name !== ref.source_column_name
            );

                let targetInsertSpecs = null;
                try {
                    if (ref.target_insert_specs) {
                        targetInsertSpecs = JSON.parse(ref.target_insert_specs);
                    }
                } catch (parseErr) {
                    console.warn(
                        "virhe target_insert_specs JSON-parsinnassa:",
                        parseErr
                    );
                }
                const fileUploadSpec = targetInsertSpecs?.file_upload || null;
                const uploadProfiles = resolveFileUploadProfiles(fileUploadSpec);
                const isSharedAssetChild = isSharedAssetRelation({
                    datasetName: ref.source_dataset_name,
                    fileUploadSpec,
                    childColumns,
                });
                const hasSharedProfiles = uploadProfiles.length > 1
                    || Boolean(fileUploadSpec?.profiles && Object.keys(fileUploadSpec.profiles).length > 0);

                if (
                    fileUploadSpec &&
                    fileUploadSpec.enabled &&
                    fileUploadSpec.filename_column
                ) {
                    childColumns = childColumns.filter(
                        (cc) =>
                            cc.column_name !== fileUploadSpec.filename_column
                    );
                }

                childColumns = filterManagedChildColumns(
                    childColumns,
                    fileUploadSpec,
                    isSharedAssetChild
                );

                const sectionUploadSpecs = uploadProfiles.length > 0
                    ? uploadProfiles
                    : [null];

                if (childColumns.length > 0 || fileUploadSpec?.enabled) {
                    sectionUploadSpecs.forEach((uploadSpec) => {
                        const fieldset = document.createElement("fieldset");
                        fieldset.style.marginTop = "20px";
                        const activeFileUploadSpec = uploadSpec || fileUploadSpec;
                        fieldset.dataset.relationKind = "one-to-many";
                        fieldset.dataset.relationDatasetLangKey = ref.source_dataset_name;
                        fieldset.dataset.uploadProfile = activeFileUploadSpec?.profile_key || "";

                        appendOneToManyLegend(fieldset, ref.source_dataset_name, activeFileUploadSpec, hasSharedProfiles);

                        const childObjectState = {
                            datasetName: ref.source_dataset_name,
                            referencingColumn: ref.source_column_name,
                            data: {},
                            fileUploadSpec: activeFileUploadSpec,
                            sharedAssetRelation: isSharedAssetChild,
                        };
                        modal_form_state["_childRowsArray"].push(childObjectState);

                        for (const ccol of childColumns) {
                            appendChildColumnInput(
                                fieldset,
                                ref.source_dataset_name,
                                ccol,
                                childObjectState
                            );
                        }

                        if (activeFileUploadSpec?.enabled) {
                            buildFileUploadField(
                                fieldset,
                                activeFileUploadSpec,
                                childObjectState,
                                { required: !hasSharedProfiles }
                            );
                        }

                        form.appendChild(fieldset);
                    });
                }
            } catch (err) {
                console.warn("virhe lapsitaulun sarakkeiden haussa:", err);
            }
    }
}

function appendOneToManyLegend(fieldset, datasetName, fileUploadSpec, showProfileLabel) {
    const legend = document.createElement("legend");
    const addChildSpan = document.createElement("span");
    addChildSpan.setAttribute("data-lang-key", "add_sub_item");
    const tableNameSpan = document.createElement("span");
    tableNameSpan.setAttribute("data-lang-key", datasetName);

    legend.appendChild(addChildSpan);
    legend.appendChild(document.createTextNode(" "));
    legend.appendChild(tableNameSpan);

    const profileLabel = showProfileLabel
        ? resolveAssetProfileLabel(fileUploadSpec?.profile_key)
        : "";
    if (profileLabel) {
        legend.appendChild(document.createTextNode(` (${profileLabel})`));
    }

    fieldset.appendChild(legend);
}

function appendChildColumnInput(fieldset, datasetName, ccol, childObjectState) {
    const label = document.createElement("label");
    label.dataset.langKey = ccol.column_name;
    const childId = `child-${datasetName}-${ccol.column_name}-${childObjectState.fileUploadSpec?.profile_key || "default"}`;
    label.htmlFor = childId;
    label.style.margin = "10px 0 5px";

    const dataTypeLower = ccol.data_type.toLowerCase();
    if (
        dataTypeLower.includes("geometry") &&
        ccol.column_name.toLowerCase() === "position"
    ) {
        buildChildGeometryField(
            fieldset,
            datasetName,
            ccol,
            childObjectState
        );
        return;
    }

    let childInput;
    if (
        dataTypeLower === "text" ||
        dataTypeLower.includes("varchar") ||
        dataTypeLower.startsWith("character varying")
    ) {
        childInput = document.createElement("textarea");
        childInput.rows = 1;
        childInput.classList.add("auto_resize_textarea");
    } else {
        childInput = document.createElement("input");
        childInput.type = get_input_type(ccol.data_type);
    }
    childInput.name = childId;
    childInput.id = childId;
    childInput.setAttribute("data-col-name", ccol.column_name);
    childInput.style.marginBottom = "5px";
    childInput.style.border = "1px solid var(--border_color)";
    childInput.style.borderRadius = "4px";

    childInput.addEventListener("input", (e) => {
        childObjectState.data[ccol.column_name] = e.target.value;
    });

    fieldset.appendChild(label);
    fieldset.appendChild(childInput);
}

function buildFileUploadField(fieldset, fileUploadSpec, childObjectState, options = {}) {
    const label = document.createElement("label");
    label.dataset.langKey = "choose_file";
    label.style.margin = "10px 0 5px";

    const group = document.createElement("div");
    group.classList.add("shared_asset_file_input_group");

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = buildFileAcceptAttribute(fileUploadSpec.allowed_file_types);
    fileInput.required = options.required === true;
    fileInput.style.marginBottom = "10px";
    fileInput.dataset.testid = `child-file-upload-${fileUploadSpec.profile_key || "default"}`;
    fileInput.multiple = supportsMultipleFileSelection(fileUploadSpec, childObjectState);

    const selectedFiles = document.createElement("div");
    selectedFiles.classList.add("shared_asset_selected_files");
    selectedFiles.dataset.testid = `child-file-upload-selected-${fileUploadSpec.profile_key || "default"}`;

    const helpText = document.createElement("div");
    helpText.classList.add("shared_asset_file_help");
    helpText.textContent = buildFileUploadHelpText(fileUploadSpec, fileInput.multiple);

    fileInput.addEventListener("change", (e) => {
        const pickedFiles = Array.from(e.target.files || []);
        if (pickedFiles.length === 0) {
            return;
        }

        const acceptedFiles = [];
        let rejectedForSize = 0;
        pickedFiles.forEach((file) => {
            if (
                file &&
                fileUploadSpec.max_file_size_mb > 0 &&
                file.size / (1024 * 1024) > fileUploadSpec.max_file_size_mb
            ) {
                rejectedForSize += 1;
                return;
            }
            acceptedFiles.push(file);
        });

        if (acceptedFiles.length > 0) {
            updateSelectedFilesState(childObjectState, fileUploadSpec, acceptedFiles, {
                append: fileInput.multiple,
                replace: !fileInput.multiple,
            });
            renderSelectedFileList(selectedFiles, childObjectState, fileUploadSpec);
        }

        if (rejectedForSize > 0) {
            const maxSizeMessage = getTranslationForKey('max_file_size')
                || `Tiedoston maksimikoko on ${fileUploadSpec.max_file_size_mb} MB.`;
            const rejectedMessage = rejectedForSize > 1
                ? `${maxSizeMessage} ${rejectedForSize} tiedostoa ohitettiin.`
                : maxSizeMessage;
            showWarningToast(rejectedMessage);
        }

        fileInput.value = "";
    });

    fieldset.appendChild(label);
    group.appendChild(fileInput);
    group.appendChild(helpText);
    group.appendChild(selectedFiles);
    fieldset.appendChild(group);
}

function filterManagedChildColumns(childColumns, fileUploadSpec, isSharedAssetChild) {
    if (!Array.isArray(childColumns)) {
        return [];
    }

    const managedColumns = new Set();
    if (fileUploadSpec?.filename_column) {
        managedColumns.add(fileUploadSpec.filename_column);
    }
    if (isSharedAssetChild) {
        AUTO_MANAGED_ASSET_COLUMNS.forEach((columnName) => managedColumns.add(columnName));
    }

    return childColumns.filter((ccol) => !managedColumns.has(ccol.column_name));
}

export function resolveFileUploadProfiles(fileUploadSpec) {
    if (!fileUploadSpec?.enabled) {
        return [];
    }

    const profileEntries = Object.entries(fileUploadSpec.profiles || {})
        .filter(([, profileConfig]) => profileConfig?.enabled !== false);
    if (profileEntries.length === 0) {
        return [normalizeFileUploadSpec(fileUploadSpec)];
    }

    return profileEntries
        .sort(([leftKey], [rightKey]) => sortProfileKeys(leftKey, rightKey))
        .map(([profileKey, profileConfig]) => normalizeFileUploadSpec({
            ...fileUploadSpec,
            ...profileConfig,
            profile_key: profileKey,
            filename_column: fileUploadSpec.filename_column,
            enabled: profileConfig?.enabled !== false,
        }));
}

function normalizeFileUploadSpec(fileUploadSpec) {
    return {
        ...fileUploadSpec,
        asset_kinds: Array.isArray(fileUploadSpec?.asset_kinds)
            ? [...fileUploadSpec.asset_kinds]
            : [],
        allowed_file_types: Array.isArray(fileUploadSpec?.allowed_file_types)
            ? [...fileUploadSpec.allowed_file_types]
            : [],
    };
}

function sortProfileKeys(leftKey, rightKey) {
    const order = ["image", "attachment"];
    const leftIndex = order.indexOf(leftKey);
    const rightIndex = order.indexOf(rightKey);
    if (leftIndex === -1 && rightIndex === -1) {
        return leftKey.localeCompare(rightKey);
    }
    if (leftIndex === -1) {
        return 1;
    }
    if (rightIndex === -1) {
        return -1;
    }
    return leftIndex - rightIndex;
}

function resolveAssetProfileLabel(profileKey) {
    if (!profileKey) {
        return "";
    }
    const profileLabelFactory = ASSET_PROFILE_LABELS[profileKey];
    return typeof profileLabelFactory === "function"
        ? profileLabelFactory()
        : profileKey;
}

export function buildFileAcceptAttribute(allowedFileTypes) {
    if (!Array.isArray(allowedFileTypes) || allowedFileTypes.length === 0) {
        return "";
    }

    return allowedFileTypes
        .map((ext) => String(ext || "").trim())
        .filter(Boolean)
        .map((ext) => ext.startsWith(".") ? ext : `.${ext}`)
        .join(",");
}

export function applySelectedFileMetadata(childObjectState, fileUploadSpec, file) {
    if (!file) {
        return;
    }

    if (fileUploadSpec.filename_column) {
        childObjectState.data[fileUploadSpec.filename_column] = file.name;
    }

    if (!isSharedAssetChildState(childObjectState)) {
        return;
    }

    const assetKind = resolveAssetKindForSelectedFile(fileUploadSpec, file);
    if (assetKind) {
        childObjectState.data.asset_kind = assetKind;
    }
    childObjectState.data.original_name = file.name;
    childObjectState.data.mime_type = file.type || "";
    childObjectState.data.size_bytes = file.size;
}

export function isSharedAssetRelation({ datasetName = "", fileUploadSpec = null, childColumns = [] } = {}) {
    if (fileUploadSpec?.profiles && Object.keys(fileUploadSpec.profiles).length > 0) {
        return true;
    }

    const childColumnNames = new Set(
        Array.isArray(childColumns)
            ? childColumns.map((column) => String(column?.column_name || "").trim()).filter(Boolean)
            : []
    );
    if ([...SHARED_ASSET_SIGNAL_COLUMNS].some((columnName) => childColumnNames.has(columnName))) {
        return true;
    }

    return String(datasetName || "").endsWith("_assets");
}

export function isSharedAssetChildState(childObjectState = {}) {
    if (childObjectState?.sharedAssetRelation === true) {
        return true;
    }

    return isSharedAssetRelation({
        datasetName: childObjectState?.datasetName,
        fileUploadSpec: childObjectState?.fileUploadSpec,
    });
}

function supportsMultipleFileSelection(fileUploadSpec, childObjectState) {
    if (String(fileUploadSpec?.profile_key || "").trim().toLowerCase() === "attachment") {
        return true;
    }

    if (!isSharedAssetChildState(childObjectState)) {
        return false;
    }

    const assetKinds = Array.isArray(fileUploadSpec?.asset_kinds)
        ? fileUploadSpec.asset_kinds.map((value) => String(value).toLowerCase())
        : [];
    return assetKinds.some((assetKind) => assetKind && assetKind !== "image");
}

function updateSelectedFilesState(childObjectState, fileUploadSpec, incomingFiles, options = {}) {
    const append = options.append === true;
    const replace = options.replace === true;
    const existingFiles = append
        ? readSelectedFilesFromState(childObjectState)
        : [];
    let nextFiles = [];
    if (append) {
        nextFiles = mergeSelectedFiles(existingFiles, incomingFiles);
    } else if (replace) {
        nextFiles = incomingFiles.filter(Boolean);
    } else {
        nextFiles = incomingFiles.slice(0, 1);
    }

    childObjectState._actualFileObjects = nextFiles;
    childObjectState._actualFileObject = nextFiles.length === 1
        ? nextFiles[0]
        : null;

    clearAutoManagedAssetMetadata(childObjectState);
    if (nextFiles.length === 1) {
        applySelectedFileMetadata(childObjectState, fileUploadSpec, nextFiles[0]);
    }
}

function renderSelectedFileList(container, childObjectState, fileUploadSpec) {
    container.replaceChildren();

    const selectedFiles = readSelectedFilesFromState(childObjectState);
    if (selectedFiles.length === 0) {
        return;
    }

    selectedFiles.forEach((file, index) => {
        const chip = document.createElement("div");
        chip.classList.add("shared_asset_selected_file");
        chip.dataset.testid = `child-file-selected-${fileUploadSpec.profile_key || "default"}-${index}`;

        const label = document.createElement("span");
        label.classList.add("shared_asset_selected_file_label");
        label.textContent = `${file.name} · ${formatSelectedFileSize(file.size)}`;
        chip.appendChild(label);

        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.classList.add("shared_asset_selected_file_remove", "fw-btn", "fw-btn--ghost");
        removeButton.dataset.testid = `child-file-selected-remove-${fileUploadSpec.profile_key || "default"}-${index}`;
        removeButton.textContent = "×";
        removeButton.setAttribute("aria-label", getTranslationForKey("delete") || "Poista");
        removeButton.title = getTranslationForKey("delete") || "Poista";
        removeButton.addEventListener("click", () => {
            const nextFiles = readSelectedFilesFromState(childObjectState)
                .filter((_, fileIndex) => fileIndex !== index);
            updateSelectedFilesState(childObjectState, fileUploadSpec, nextFiles, {
                replace: true,
            });
            renderSelectedFileList(container, childObjectState, fileUploadSpec);
        });
        chip.appendChild(removeButton);

        container.appendChild(chip);
    });
}

function readSelectedFilesFromState(childObjectState) {
    if (Array.isArray(childObjectState?._actualFileObjects)) {
        return childObjectState._actualFileObjects.filter(Boolean);
    }
    if (childObjectState?._actualFileObject) {
        return [childObjectState._actualFileObject];
    }
    return [];
}

function mergeSelectedFiles(existingFiles, incomingFiles) {
    const merged = [];
    const seen = new Set();
    [...existingFiles, ...incomingFiles].forEach((file) => {
        if (!file) {
            return;
        }
        const fingerprint = [
            file.name,
            file.size,
            file.type,
            file.lastModified,
        ].join("::");
        if (seen.has(fingerprint)) {
            return;
        }
        seen.add(fingerprint);
        merged.push(file);
    });
    return merged;
}

function clearAutoManagedAssetMetadata(childObjectState) {
    if (!childObjectState?.data || typeof childObjectState.data !== "object") {
        return;
    }
    AUTO_MANAGED_ASSET_METADATA_COLUMNS.forEach((columnName) => {
        delete childObjectState.data[columnName];
    });
}

function buildFileUploadHelpText(fileUploadSpec, allowMultiple) {
    const allowedTypes = Array.isArray(fileUploadSpec?.allowed_file_types)
        ? fileUploadSpec.allowed_file_types
            .map((ext) => String(ext || "").trim().replace(/^\./u, "").toUpperCase())
            .filter(Boolean)
        : [];

    const hints = [];
    if (allowedTypes.length > 0) {
        hints.push(allowedTypes.join(", "));
    }
    if (Number(fileUploadSpec?.max_file_size_mb) > 0) {
        hints.push(`max ${fileUploadSpec.max_file_size_mb} MB`);
    }
    if (allowMultiple) {
        hints.push("voit valita useita tiedostoja");
    }
    return hints.join(" · ");
}

function formatSelectedFileSize(sizeBytes) {
    const size = Number(sizeBytes);
    if (!Number.isFinite(size) || size <= 0) {
        return "";
    }
    if (size < 1024) {
        return `${size} B`;
    }
    if (size < 1024 * 1024) {
        return `${(size / 1024).toFixed(1)} KB`;
    }
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function resolveAssetKindForSelectedFile(fileUploadSpec, file) {
    const assetKinds = Array.isArray(fileUploadSpec?.asset_kinds)
        ? fileUploadSpec.asset_kinds.map((value) => String(value).toLowerCase())
        : [];
    if (assetKinds.length === 0) {
        return "";
    }
    if (assetKinds.length === 1) {
        return assetKinds[0];
    }

    const lowerName = String(file?.name || "").toLowerCase();
    const lowerType = String(file?.type || "").toLowerCase();
    const extension = lowerName.includes(".")
        ? lowerName.split(".").pop()
        : "";

    if (assetKinds.includes("image") && lowerType.startsWith("image/")) {
        return "image";
    }
    if (assetKinds.includes("pdf") && (extension === "pdf" || lowerType === "application/pdf")) {
        return "pdf";
    }
    if (
        assetKinds.includes("archive") &&
        (
            ARCHIVE_EXTENSIONS.has(extension)
            || lowerType.includes("zip")
            || lowerType.includes("compressed")
            || lowerType.includes("tar")
        )
    ) {
        return "archive";
    }
    if (
        assetKinds.includes("document") &&
        (
            DOCUMENT_EXTENSIONS.has(extension)
            || lowerType.startsWith("text/")
            || lowerType.includes("word")
            || lowerType.includes("sheet")
            || lowerType.includes("presentation")
        )
    ) {
        return "document";
    }

    return assetKinds[0];
}

/** Rakentaa monesta->moneen-lomakesektion */
export async function buildManyToManySection(form, manyToManyInfos, modal_form_state) {
    modal_form_state["_manyToManyRows"] =
        modal_form_state["_manyToManyRows"] || [];

    for (const info of manyToManyInfos) {
        const relationInfo = normalizeManyToManyInfo(info);
        if (
            !relationInfo.linkTableName ||
            !relationInfo.mainTableFkColumn ||
            !relationInfo.thirdTableName ||
            !relationInfo.thirdTableUID ||
            !relationInfo.thirdTableFkColumn
        ) {
            console.warn("puutteellinen m2m-relaatiometadata:", info);
            continue;
        }

        const fieldset = document.createElement("fieldset");
        fieldset.dataset.testid = `many-to-many-section-${relationInfo.thirdTableName}`;
        fieldset.dataset.relationKind = "many-to-many";
        fieldset.dataset.relationDatasetLangKey = relationInfo.thirdTableName;
        fieldset.style.marginTop = "20px";
        const legend = document.createElement("legend");
        const m2mLabelSpan = document.createElement("span");
        m2mLabelSpan.dataset.langKey = 'add_many_to_many_relation';
        const m2mDatasetSpan = document.createElement("span");
        m2mDatasetSpan.dataset.langKey = relationInfo.thirdTableName;
        legend.appendChild(m2mLabelSpan);
        legend.appendChild(document.createTextNode(" "));
        legend.appendChild(m2mDatasetSpan);
        fieldset.appendChild(legend);

        // Haetaan "kolmannen taulun" sarakkeet
        try {
            const thirdTableColumns = await fetchColumnsInfo(relationInfo.thirdTableUID);
            const exclude_cols = [
                "id",
                "created",
                "updated",
                "embedding_vector",
                "creation_spec",
            ];
            const sanitizedThirdCols = thirdTableColumns.filter(
                (tc) => !exclude_cols.includes(tc.column_name)
            );

            // Valinta: olemassaoleva rivi / uusi rivi
            const radioContainer = document.createElement("div");
            radioContainer.style.display = "flex";
            radioContainer.style.gap = "1em";

            const existingRadio = document.createElement("input");
            existingRadio.type = "radio";
            existingRadio.name = relationInfo.modeRadioName;
            existingRadio.value = "existing";
            existingRadio.checked = true;
            const existingRadioLabel = document.createElement("label");
            // existingRadioLabel.textContent = 'Valitse olemassaolevista';
            existingRadioLabel.setAttribute(
                "data-lang-key",
                "choose_from_existing"
            );

            const newRadio = document.createElement("input");
            newRadio.type = "radio";
            newRadio.name = relationInfo.modeRadioName;
            newRadio.value = "new";
            const newRadioLabel = document.createElement("label");
            // newRadioLabel.textContent = 'Luo kokonaan uusi rivi';
            newRadioLabel.dataset.langKey = "create_new_row";

            radioContainer.appendChild(existingRadio);
            radioContainer.appendChild(existingRadioLabel);
            radioContainer.appendChild(newRadio);
            radioContainer.appendChild(newRadioLabel);
            fieldset.appendChild(radioContainer);

            // Dropdown + hidden input
            const dropdown_container = document.createElement("div");
            dropdown_container.style.marginTop = "1em";

            const hiddenInput = document.createElement("input");
            hiddenInput.type = "hidden";
            hiddenInput.name = `_m2m_existing_${relationInfo.linkTableName}_${relationInfo.thirdTableName}`;
            dropdown_container.appendChild(hiddenInput);

            // Haetaan kolmannen taulun data
            fetchReferencedData(relationInfo.thirdTableName)
                .then((thirdTableOptions) => {
                    if (!Array.isArray(thirdTableOptions)) return;
                    const chosenLanguage = getLanguageWithBrowserFallback();
                    const mapped = thirdTableOptions.map((opt) => {
                        const pk = Object.keys(opt).find(
                            (k) => k !== "display"
                        );
                        return {
                            value: opt[pk],
                            label: `${opt[pk]} - ${resolveDatasetDisplayValue(
                                opt["display"],
                                null,
                                chosenLanguage
                            )}`,
                        };
                    });
                    createVanillaDropdown({
                        containerElement: dropdown_container,
                        options: mapped,
                        placeholder: getTranslationForKey('select') || "Valitse...",
                        searchPlaceholder: getTranslationForKey('search') || "Hae...",
                        showClearButton: true,
                        useSearch: true,
                        onChange: (val) => {
                            hiddenInput.value = val || "";
                        },
                    });
                })
                .catch((err) =>
                    console.warn(
                        "virhe kolmannen taulun datan haussa:",
                        err
                    )
                );

            fieldset.appendChild(dropdown_container);

            // Uuden rivin luontikentät
            const newRowFieldset = document.createElement("div");
            newRowFieldset.style.display = "none";
            newRowFieldset.style.marginTop = "1em";
            newRowFieldset.style.borderLeft = "2px solid #ccc";
            newRowFieldset.style.paddingLeft = "10px";

            // Tallennetaan tilaan tieto, että luodaan uusi
            const newRowState = { data: {} };
            modal_form_state[`_m2m_new_${relationInfo.thirdTableName}`] = newRowState.data;
            modal_form_state["_manyToManyRows"].push({
                linkTableName: relationInfo.linkTableName,
                mainTableFkColumn: relationInfo.mainTableFkColumn,
                thirdTableName: relationInfo.thirdTableName,
                thirdTableFkColumn: relationInfo.thirdTableFkColumn,
                modeRadioName: relationInfo.modeRadioName,
                existingHiddenInput: hiddenInput,
                newRowState,
            });

            for (const col of sanitizedThirdCols) {
                const l = document.createElement("label");
                // l.textContent = col.column_name;
                l.dataset.langKey = col.column_name;
                l.style.display = "block";
                l.style.marginTop = "5px";

                const inp = document.createElement("input");
                inp.type = get_input_type(col.data_type);
                inp.style.display = "block";
                inp.style.marginBottom = "5px";
                inp.addEventListener("input", (e) => {
                    newRowState.data[col.column_name] = e.target.value;
                });

                newRowFieldset.appendChild(l);
                newRowFieldset.appendChild(inp);
            }
            fieldset.appendChild(newRowFieldset);

            // Radio-logiikka
            existingRadio.addEventListener("change", () => {
                if (existingRadio.checked) {
                    dropdown_container.style.display = "block";
                    newRowFieldset.style.display = "none";
                    modal_form_state[
                        `_m2m_mode_${relationInfo.thirdTableName}`
                    ] = "existing";
                }
            });
            newRadio.addEventListener("change", () => {
                if (newRadio.checked) {
                    dropdown_container.style.display = "none";
                    newRowFieldset.style.display = "block";
                    modal_form_state[
                        `_m2m_mode_${relationInfo.thirdTableName}`
                    ] = "new";
                }
            });

            form.appendChild(fieldset);
        } catch (err) {
            console.warn("virhe m2m-sarakkeiden haussa:", err);
        }
    }
}

function normalizeManyToManyInfo(info = {}) {
    const thirdTableName = String(
        info.third_dataset_name ||
        info.thirdTableName ||
        ""
    ).trim();

    return {
        linkTableName: String(
            info.bridging_dataset_name ||
            info.link_dataset_name ||
            info.linkTableName ||
            ""
        ).trim(),
        mainTableFkColumn: String(
            info.main_dataset_fk_column ||
            info.mainTableFkColumn ||
            ""
        ).trim(),
        thirdTableUID: String(
            info.third_table_uid ||
            info.thirdTableUID ||
            ""
        ).trim(),
        thirdTableName,
        thirdTableFkColumn: String(
            info.third_dataset_fk_column ||
            info.thirdTableFkColumn ||
            ""
        ).trim(),
        modeRadioName: `m2m_mode_${thirdTableName}`,
    };
}
