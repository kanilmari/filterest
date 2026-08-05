// admin_button_builder.js
// Builds admin-only action controls for dataset toolbars.
// Bridges admin permissions, dataset actions, and view helpers into the toolbar button area.
// Exists to keep admin toolbar assembly out of generic dataset view builders.
// PIPELINE_EXCEPTION: EventSource streams cannot use endpoint_router's request/response pipeline.

import {
    createDeleteSelectedButton,
    createColumnManagementButton,
} from "../general_tables/gt_toolbar/toolbar_button_creator.js";
import {
    createGenericViewSelector,
    applyViewStyling
} from "../table_views/view_selector_printer.js";
import { refreshTableUnified } from "../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js";
import { createVanillaDropdown } from "../../reusable_components/vanilla_dropdown/vanilla_dropdown_builder.js";
import { create_chat_ui } from "../ai_features/table_chat/table_chat_printer.js";
import { resolveAvailableFilterbarAIChatMode } from "../ai_features/table_chat/table_chat_mode_resolver.js";
import {
    hasDatasetPermission,
} from "../route_permission_checker.js";
import { createMaskIconSpan } from "../../icons/icon_mask_builder.js";
import { get_endpoint_url } from "../endpoints/endpoint_router.js";
import { getTranslationForKey } from "../lang/translation_handler.js";
import { applyTranslationVariable } from "../lang/translation_handler_helpers.js";
import {
    EXPERIMENTAL_FREE_LAYOUT_CARD_STYLE_VARIANT,
    getCardStyleVariant,
    isExperimentalFreeLayoutAvailable,
    setCardStyleVariant,
    STANDARD_CARD_STYLE_VARIANT,
} from "../table_views/experimental_free_layout_card/experimental_free_layout_card_store.js";
import {
    DATASET_VIEW_SELECTOR_GROUP_DIRECT,
    DATASET_VIEW_SELECTOR_GROUP_MORE,
    DATASET_VIEW_SELECTOR_TEXT,
    getDatasetViewSelectorOptions,
} from "../table_views/dataset_view_registry.js";

/**
 * SSE-yhteyden avaava funktio, joka asuu nyt admin-tiedostossa,
 * koska yleensä vain admin haluaa/voi ajaa tämän.
 */
function embedAllData(table_name) {
    const embedLogId = `${table_name}_embed_log`;
    let embedLog = document.getElementById(embedLogId);
    if (!embedLog) {
        embedLog = document.createElement("div");
        embedLog.id = embedLogId;
        embedLog.style.border = "1px solid var(--border_color)";
        embedLog.style.padding = "0.5rem";
        embedLog.style.maxHeight = "200px";
        embedLog.style.overflowY = "auto";
        embedLog.style.marginTop = "0.5rem";
        const filterBar = document.getElementById(`${table_name}_filterBar`);
        if (filterBar) {
            filterBar.appendChild(embedLog);
        }
    }

    function appendLog(msg) {
        const p = document.createElement("p");
        p.textContent = msg;
        embedLog.appendChild(p);
        embedLog.scrollTop = embedLog.scrollHeight;
    }

    const url = `${get_endpoint_url('openaiEmbedStream')}?dataset=${encodeURIComponent(
        table_name
    )}`;
    const evtSource = new EventSource(url);

    evtSource.addEventListener("progress", (e) => {
        appendLog(`[progress] ${e.data}`);
    });
    evtSource.addEventListener("error", (e) => {
        appendLog(`virhe serveriltä: ${e.data}`);
    });
    evtSource.addEventListener("done", (e) => {
        appendLog(`Valmis: ${e.data}`);
        evtSource.close();
    });

    evtSource.onerror = (err) => {
        console.warn("SSE transport error:", err);
        appendLog("virhe: SSE-yhteys katkesi tai ei onnistu");
        evtSource.close();
    };
}

/**
 * Apunappi, jonka ainoana tarkoituksena on käynnistää edellä oleva embedAllData-funktio.
 */
function createEmbedButton(table_name) {
    const btn = document.createElement("button");
    btn.classList.add("fw-btn");
    btn.textContent = "Luo embedding";
    btn.addEventListener("click", () => {
        embedAllData(table_name);
    });
    return btn;
}

/**
 * Luodaan näkymänvalintanapit vain adminille.
 */
function createAdminViewButtons(table_name, current_view) {
    const directButtons = getDatasetViewSelectorOptions(
        DATASET_VIEW_SELECTOR_GROUP_DIRECT
    );

    const container = createGenericViewSelector(
        table_name,
        current_view,
        directButtons,
        [],
        { includeHeading: false }
    );

    const dropdownWrapper = document.createElement("div");
    dropdownWrapper.classList.add("more-views-dropdown");
    dropdownWrapper.dataset.testid = "view-dropdown-more";

    createVanillaDropdown({
        containerElement: dropdownWrapper,
        options: getDatasetViewSelectorOptions(DATASET_VIEW_SELECTOR_GROUP_MORE)
            .map((option) => ({
                value: option.viewKey,
                label: option.translateDropdownLabel
                    ? getTranslationForKey(option.langKey, { fallback: option.label })
                    : option.label,
            })),
        placeholder: getTranslationForKey(DATASET_VIEW_SELECTOR_TEXT.moreViews.langKey, {
            fallback: DATASET_VIEW_SELECTOR_TEXT.moreViews.placeholderFallback,
        }),
        showClearButton: false,
        useSearch: false,
        onChange: (value) => {
            if (!value) return;
            const datasetName = table_name;
            localStorage.setItem(`${datasetName}_view`, value);
            applyViewStyling(table_name);
            refreshTableUnified(table_name);
        }
    });

    const dropdownTrigger = dropdownWrapper.querySelector('.vdw-dropdown-input');
    if (dropdownTrigger) {
        dropdownTrigger.dataset.testid = 'view-dropdown-more-trigger';
        dropdownTrigger.dataset.langKey = DATASET_VIEW_SELECTOR_TEXT.moreViews.langKey;
    }

    container.appendChild(dropdownWrapper);

    if (
        current_view === "card" &&
        isExperimentalFreeLayoutAvailable()
    ) {
        container.appendChild(createCardStyleDropdown(table_name));
    }

    return container;
}

function createCardStyleDropdown(table_name) {
    const dropdownWrapper = document.createElement("div");
    dropdownWrapper.classList.add("more-views-dropdown", "card-style-dropdown");
    dropdownWrapper.dataset.testid = "card-style-dropdown";

    const dropdown = createVanillaDropdown({
        containerElement: dropdownWrapper,
        options: [
            {
                value: STANDARD_CARD_STYLE_VARIANT,
                label: "Locked layout",
            },
            {
                value: EXPERIMENTAL_FREE_LAYOUT_CARD_STYLE_VARIANT,
                label: "Free layout (beta)",
            },
        ],
        placeholder: "Card style",
        showClearButton: false,
        useSearch: false,
        onChange: async (value) => {
            setCardStyleVariant(table_name, value);
            await refreshTableUnified(table_name, { skipUrlParams: true });
        },
    });

    dropdown.setValue(getCardStyleVariant(table_name), false);
    return dropdownWrapper;
}


/**
 * Lisää hallintakomponentit.
 * Nyt annamme funktiolle erikseen managementButtonsContainerin ja viewSelectorContainerin.
 */
export async function appendAdminFeatures(
    table_name,
    managementButtonsContainer,
    viewSelectorContainer,
    current_view
) {
    const [
        canDeleteRows,
        canModifyColumns,
        canEmbedRows,
        canChangeViewStyle,
    ] = await Promise.all([
        hasDatasetPermission("/api/delete-rows", table_name),
        hasDatasetPermission("/api/modify-columns", table_name),
        hasDatasetPermission("/api/embedding_stream_handler", table_name),
        hasDatasetPermission("/ui/table-view-style-buttons", table_name),
    ]);

    // 1) Massapoisto
    if (canDeleteRows) {
        const deleteBtn = createDeleteSelectedButton(table_name, current_view);
        managementButtonsContainer.appendChild(deleteBtn);
    }

    // 2) Sarakehallinta
    if (canModifyColumns) {
        const columnBtn = createColumnManagementButton(table_name);
        managementButtonsContainer.appendChild(columnBtn);
    }

    // 3) "Embeditä data" -nappi
    if (canEmbedRows) {
        const embedBtn = createEmbedButton(table_name);
        managementButtonsContainer.appendChild(embedBtn);
    }

    if (managementButtonsContainer.children.length === 0) {
        managementButtonsContainer.style.display = "none";
    }

    // 4) Näkymänvalintanapit erilliseen konttiin
    if (canChangeViewStyle) {
        const viewSelector = createAdminViewButtons(table_name, current_view);
        viewSelectorContainer.appendChild(viewSelector);
    }

    // Row visibility is handled by the caller (filterbar_ui.js) after all
    // permission checks complete via Promise.all().
}


function dispatchChatDockMaximizeToggle(section, maximized) {
    return section.dispatchEvent(new CustomEvent("filterbar-chat-maximize-toggle", {
        bubbles: true,
        cancelable: true,
        detail: {
            maximized,
            section,
        },
    }));
}

function setChatDockMaximized(section, contentShell, toggleButton, maximized) {
    const nextMaximized = Boolean(maximized);
    section.classList.toggle("is-chat-maximized", nextMaximized);
    section.dataset.chatState = nextMaximized ? "maximized" : "collapsed";
    toggleButton.setAttribute("aria-expanded", String(nextMaximized));
    toggleButton.title = nextMaximized ? "Pienennä chat" : "Avaa chat";
    toggleButton.setAttribute(
        "aria-label",
        nextMaximized ? "Pienennä chat" : "Avaa chat"
    );
    contentShell.setAttribute("aria-hidden", String(!nextMaximized));
    contentShell.inert = !nextMaximized;
}

function toggleChatDockMaximized(section, contentShell, toggleButton) {
    const maximized = !section.classList.contains("is-chat-maximized");
    const shouldApplyFallback = dispatchChatDockMaximizeToggle(section, maximized);
    if (shouldApplyFallback) {
        setChatDockMaximized(section, contentShell, toggleButton, maximized);
    }
}

// Formats raw dataset identifiers into a readable fallback label between
// table metadata and the filterbar chat title when no translation exists.
function formatFallbackDatasetTitle(tableName) {
    return String(tableName || "")
        .split("_")
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
}

// Resolves the chat title between language keys, localized dataset metadata,
// and a readable identifier fallback so the dock avoids raw table names.
function resolveChatTitleText(tableName, tableDisplayName = "") {
    const prettyName = resolveDatasetTitleText(tableName, tableDisplayName);
    const titleTemplate = getTranslationForKey("chat_for_table", {
        fallback: "Keskustelu - $table_name",
    }) || "Keskustelu - $table_name";
    return applyTranslationVariable(titleTemplate, prettyName);
}

// Resolves a dataset label from explicit metadata, then the dataset's own
// language key, and only finally from a formatted technical identifier.
function resolveDatasetTitleText(tableName, tableDisplayName = "") {
    const explicitDisplayName = String(tableDisplayName || "").trim();
    if (explicitDisplayName) {
        return explicitDisplayName;
    }
    return getTranslationForKey(tableName, {
        fallback: formatFallbackDatasetTitle(tableName),
        countUsage: false,
    });
}

export function appendChatUIIfAllowed(table_name, filter_bar = null, options = {}) {
    const chatMode = resolveAvailableFilterbarAIChatMode();
    if (!chatMode) return null;
    const tableDisplayName = options && typeof options === "object"
        ? options.tableDisplayName
        : "";

    const section = document.createElement("section");
    section.classList.add(
        "filterbar-chat-dock",
        "filterbar-chat-section",
        "chat-collapsible"
    );
    section.dataset.chatMode = chatMode;
    section.dataset.filterbarSectionKey = "chat";

    const header = document.createElement("div");
    header.classList.add("filterbar-chat-dock__header", "filterbar-section-heading");
    header.setAttribute("role", "button");
    header.tabIndex = 0;

    const titleGroup = document.createElement("span");
    titleGroup.classList.add("filterbar-chat-dock__title-group");
    const titleIcon = createMaskIconSpan(
        "/frontend/icons/general/chat-message-icon.svg",
        ["filterbar-section-heading-icon", "filterbar-section-heading-icon--chat"]
    );
    titleIcon.setAttribute("aria-hidden", "true");

    const title = document.createElement("span");
    title.classList.add("filterbar-chat-dock__title");
    title.dataset.langKey = "chat_for_table";
    title.dataset.langVariable = resolveDatasetTitleText(table_name, tableDisplayName);
    title.dataset.langVariableKey = table_name;
    title.textContent = resolveChatTitleText(table_name, tableDisplayName);
    titleGroup.append(titleIcon, title);

    const contentId = `${table_name}_filterbar_chat_content`;
    const toggleButton = document.createElement("button");
    toggleButton.type = "button";
    toggleButton.classList.add("filterbar-chat-dock__toggle", "fw-btn");
    toggleButton.setAttribute("aria-controls", contentId);
    toggleButton.appendChild(
        createMaskIconSpan(
            "/frontend/icons/general/chevron-down-icon.svg",
            ["filterbar-chat-dock__toggle-icon"]
        )
    );

    header.append(titleGroup, toggleButton);

    const contentShell = document.createElement("div");
    contentShell.id = contentId;
    contentShell.classList.add(
        "filterbar-chat-content",
        "filterbar-chat-dock__content"
    );

    const chatContainerDiv = document.createElement("div");
    chatContainerDiv.classList.add("filterbar-chat-dock__content-inner");
    create_chat_ui(table_name, chatContainerDiv);
    contentShell.appendChild(chatContainerDiv);

    section.append(header, contentShell);

    setChatDockMaximized(section, contentShell, toggleButton, false);
    section.__setMaximized = (maximized) => {
        setChatDockMaximized(section, contentShell, toggleButton, maximized);
    };

    header.addEventListener("click", () => {
        toggleChatDockMaximized(section, contentShell, toggleButton);
    });

    header.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") {
            return;
        }
        event.preventDefault();
        toggleChatDockMaximized(section, contentShell, toggleButton);
    });

    toggleButton.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleChatDockMaximized(section, contentShell, toggleButton);
    });

    if (filter_bar instanceof HTMLElement) {
        filter_bar.appendChild(section);
    }

    return section;
}
