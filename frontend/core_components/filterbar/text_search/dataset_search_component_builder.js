// dataset_search_component_builder.js
// Builds dataset-search UI components and composes panel and header structures.
// Bridges component events with shared search state, URL synchronisation, and location/execution helpers.
// Exists to isolate DOM construction from shared state and streaming implementation details.

import {
    get_endpoint_url,
} from "../../endpoints/endpoint_router.js";
import {
    DATASET_PREFIX,
    getParams,
    setParams,
    updateURL,
} from "../../navigation/nav_engine/query_params.js";
import { isDatasetRowPath } from "../../navigation/nav_engine/history_navigation_handler_helpers.js";
import { renderActiveFilters } from "../filter_list/active_filter_tag_printer.js";
import { applyPermission } from "../../route_permission_checker.js";
import {
    datasetSearchRegistry,
    datasetSearchLocationState,
    datasetSearchState,
    generateDatasetSearchIdPrefix,
    normalizeVariantName,
    registerDatasetSearchComponent,
    shouldRenderLocationCheckbox,
} from "./dataset_search_state_reader.js";
import {
    DEFAULT_TITLE_LANG_KEY_MODE,
    buildDatasetSearchHeader,
} from "./dataset_search_header_builder.js";
import {
    getStoredGpsCoords,
    requestGpsPosition,
} from "./dataset_search_location_handler.js";
import { do_intelligent_search } from "./dataset_search_executor.js";

export const DEFAULT_SEARCH_CLASSES = {
    wrapper: ["dataset-search-row"],
    fields: ["dataset-search-fields"],
    inputRow: ["dataset-search-input-row"],
    input: ["dataset-search-input"],
    locationRow: ["dataset-search-location-row"],
    button: ["dataset-search-submit-button", "fw-btn"],
};

function applyVisuallyHiddenStyles(element) {
    Object.assign(element.style, {
        position: "absolute",
        width: "1px",
        height: "1px",
        padding: "0",
        margin: "-1px",
        overflow: "hidden",
        clipPath: "inset(50%)",
        whiteSpace: "nowrap",
        border: "0",
    });
}

export function resolveClassList(option, defaults) {
    if (!option && option !== "") return [...defaults];
    if (Array.isArray(option)) {
        return option.filter(Boolean);
    }
    return [option];
}

/**
 * Build one dataset-search control set and wire it to shared search state.
 * Between filterbar/search-only callers and the shared dataset-search stores.
 * Exists so every dataset-search surface can reuse the same DOM + state contract.
 */
export function createDatasetSearchComponent(tableName, options = {}) {
    const listenerCleanups = [];
    let destroyed = false;
    function addManagedListener(target, type, handler, options) {
        target.addEventListener(type, handler, options);
        listenerCleanups.push(() => {
            target.removeEventListener(type, handler, options);
        });
    }
    const variant = normalizeVariantName(options.variant || "filterbar");
    const idPrefix = generateDatasetSearchIdPrefix(
        tableName,
        variant,
        options.idPrefix
    );
    const componentId = `${idPrefix}_component`;
    const classConfig = {
        wrapper: resolveClassList(
            options.wrapperClasses,
            DEFAULT_SEARCH_CLASSES.wrapper
        ),
        fields: resolveClassList(
            options.fieldsClasses,
            DEFAULT_SEARCH_CLASSES.fields
        ),
        inputRow: resolveClassList(
            options.inputRowClasses,
            DEFAULT_SEARCH_CLASSES.inputRow
        ),
        input: resolveClassList(
            options.inputClasses,
            DEFAULT_SEARCH_CLASSES.input
        ),
        locationRow: resolveClassList(
            options.locationRowClasses,
            DEFAULT_SEARCH_CLASSES.locationRow
        ),
        button: resolveClassList(
            options.buttonClasses,
            DEFAULT_SEARCH_CLASSES.button
        ),
    };
    const wrapper = document.createElement("div");
    wrapper.classList.add(...classConfig.wrapper);
    wrapper.dataset.datasetSearch = tableName;
    wrapper.dataset.datasetSearchVariant = variant;
    wrapper.dataset.testid =
        variant === "filterbar"
            ? "dataset-search-panel"
            : `dataset-search-panel-${variant}`;
    const searchRoute = get_endpoint_url("getIntelligentResults");
    applyPermission(wrapper, searchRoute, { remove: true });

    const leftColumn = document.createElement("div");
    leftColumn.classList.add(...classConfig.fields);
    const searchRow = document.createElement("div");
    searchRow.classList.add(...classConfig.inputRow);
    const globalSearchInput = document.createElement("input");
    globalSearchInput.type = "text";
    if (!options.placeholder) {
        globalSearchInput.dataset.langKey = `search_for_${tableName}`;
    }
    globalSearchInput.placeholder =
        options.placeholder || `Search for ${tableName}...`;
    globalSearchInput.id = `${idPrefix}_input`;
    globalSearchInput.classList.add(...classConfig.input);
    globalSearchInput.dataset.datasetSearchInput = tableName;
    globalSearchInput.dataset.datasetSearchVariant = variant;
    globalSearchInput.dataset.testid =
        variant === "filterbar"
            ? "dataset-search-input"
            : `dataset-search-input-${variant}`;
    const globalSearchLabel = document.createElement("label");
    globalSearchLabel.setAttribute("for", globalSearchInput.id);
    globalSearchLabel.dataset.langKey = `search_for_${tableName}`;
    globalSearchLabel.textContent =
        options.placeholder || `Search for ${tableName}...`;
    applyVisuallyHiddenStyles(globalSearchLabel);
    searchRow.appendChild(globalSearchLabel);
    searchRow.appendChild(globalSearchInput);

    const locationRow = document.createElement("div");
    locationRow.classList.add(...classConfig.locationRow);
    locationRow.id = `${idPrefix}_location_row`;
    locationRow.dataset.datasetSearch = tableName;
    locationRow.dataset.datasetSearchVariant = variant;
    const locationRowDisplay = options.locationRowDisplay || "flex";
    const useLocationCheckbox = document.createElement("input");
    useLocationCheckbox.type = "checkbox";
    useLocationCheckbox.id = `${idPrefix}_use_location_checkbox`;
    useLocationCheckbox.dataset.testid =
        variant === "filterbar"
            ? "dataset-search-location-toggle"
            : `dataset-search-location-toggle-${variant}`;
    const useLocationLabel = document.createElement("label");
    useLocationLabel.setAttribute("for", useLocationCheckbox.id);
    useLocationLabel.textContent =
        options.locationLabelText || "Use my location";
    locationRow.appendChild(useLocationCheckbox);
    locationRow.appendChild(useLocationLabel);
    const showLocationCheckbox =
        options.showLocationCheckbox ?? shouldRenderLocationCheckbox(tableName);
    if (!showLocationCheckbox) {
        locationRow.style.display = "none";
    } else {
        locationRow.style.display = locationRowDisplay;
    }

    const globalSearchButton = document.createElement("button");
    globalSearchButton.type = "button";
    globalSearchButton.classList.add(...classConfig.button);
    globalSearchButton.title = options.buttonTitle || "Hae";
    globalSearchButton.dataset.testid =
        variant === "filterbar"
            ? "dataset-search-submit"
            : `dataset-search-submit-${variant}`;
    if (options.buttonInnerHTML) {
        globalSearchButton.innerHTML = options.buttonInnerHTML;
        globalSearchButton.setAttribute(
            "aria-label",
            options.buttonAriaLabel || options.buttonLabelText || "Search"
        );
    } else {
        const buttonIcon = document.createElement("span");
        buttonIcon.setAttribute("aria-hidden", "true");
        buttonIcon.classList.add("dataset-search-submit-icon");
        const buttonLabel = document.createElement("span");
        buttonLabel.dataset.langKey = "search";
        buttonLabel.textContent = options.buttonLabelText || "Search";
        applyVisuallyHiddenStyles(buttonLabel);
        globalSearchButton.append(buttonIcon, buttonLabel);
    }

    searchRow.appendChild(globalSearchButton);
    leftColumn.appendChild(searchRow);
    leftColumn.appendChild(locationRow);
    wrapper.appendChild(leftColumn);

    const STORAGE_KEY_HISTORY = `int_search_history_${tableName}`;
    const STORAGE_KEY_DRAFT = `int_search_draft_${tableName}`;
    const STORAGE_KEY_LOCATION = `int_search_use_location_${tableName}`;
    const STORAGE_KEY_GPS = `int_search_gps_${tableName}`;
    let history = [];
    let placeholderFadeTimer = 0;
    let placeholderFadeElement = null;
    try {
        history = JSON.parse(localStorage.getItem(STORAGE_KEY_HISTORY)) || [];
    } catch {
        history = [];
    }
    const savedDraft = localStorage.getItem(STORAGE_KEY_DRAFT);
    const urlParams = getParams(tableName);
    if (urlParams.search !== undefined) {
        globalSearchInput.value = urlParams.search;
    } else if (savedDraft !== null) {
        globalSearchInput.value = savedDraft;
    } else if (history.length) {
        globalSearchInput.value = history[history.length - 1];
    }
    const seededValue = datasetSearchState.initialize(
        tableName,
        globalSearchInput.value
    );
    globalSearchInput.value = seededValue;
    if (
        useLocationCheckbox &&
        localStorage.getItem(STORAGE_KEY_LOCATION) !== null
    ) {
        useLocationCheckbox.checked =
            localStorage.getItem(STORAGE_KEY_LOCATION) === "true";
    }
    const seededUseLocation = datasetSearchLocationState.initialize(
        tableName,
        useLocationCheckbox?.checked === true
    );
    if (useLocationCheckbox) {
        useLocationCheckbox.checked = seededUseLocation;
    }
    let historyIndex = null;
    let currentDraft = "";

    function clearPlaceholderFade() {
        clearTimeout(placeholderFadeTimer);
        placeholderFadeTimer = 0;
        placeholderFadeElement?.remove();
        placeholderFadeElement = null;
    }

    function animatePlaceholderFadeForSyncedValue() {
        if (document.activeElement === globalSearchInput) {
            return;
        }
        const placeholderText = globalSearchInput.placeholder || globalSearchLabel.textContent || "";
        if (!placeholderText) {
            return;
        }

        clearPlaceholderFade();
        const placeholderGhost = document.createElement("span");
        placeholderGhost.classList.add("dataset-search-placeholder-fade");
        placeholderGhost.textContent = placeholderText;
        searchRow.appendChild(placeholderGhost);
        placeholderFadeElement = placeholderGhost;
        placeholderFadeTimer = setTimeout(clearPlaceholderFade, 340);
    }

    async function ensureGpsIfNeeded() {
        if (!useLocationCheckbox.checked) return null;
        const cached = getStoredGpsCoords(STORAGE_KEY_GPS);
        if (cached) return cached;
        try {
            const { lat, lon } = await requestGpsPosition();
            localStorage.setItem(STORAGE_KEY_GPS, `${lat},${lon}`);
            return { lat, lon };
        } catch (err) {
            console.warn("GPS-kysely epäonnistui:", err);
            useLocationCheckbox.checked = false;
            localStorage.setItem(STORAGE_KEY_LOCATION, "false");
            datasetSearchLocationState.set(tableName, false, componentId);
            return null;
        }
    }
    const unsubscribeState = datasetSearchState.subscribe(
        tableName,
        (value, sourceId) => {
            if (sourceId === componentId) {
                return;
            }
            const nextValue = value ?? "";
            if (globalSearchInput.value !== nextValue) {
                if (globalSearchInput.value === "" && String(nextValue) !== "") {
                    animatePlaceholderFadeForSyncedValue();
                }
                globalSearchInput.value = nextValue;
            }
        }
    );
    const unsubscribeLocationState = datasetSearchLocationState.subscribe(
        tableName,
        (checked, sourceId) => {
            if (!useLocationCheckbox || sourceId === componentId) {
                return;
            }
            if (useLocationCheckbox.checked !== checked) {
                useLocationCheckbox.checked = checked;
            }
        }
    );

    function getCommitSearchUrlOptions({ replaceUrl = false } = {}) {
        const urlOptions = {};
        if (replaceUrl) {
            urlOptions.replace = true;
        }
        if (isDatasetRowPath(window.location.pathname, DATASET_PREFIX, tableName)) {
            urlOptions.pathOverride = window.location.pathname;
            urlOptions.state = history.state || {};
        }
        return urlOptions;
    }

    async function commitSearch(options = {}) {
        if (destroyed) return;
        const query = datasetSearchState.get(tableName).trim();
        if (!query) return;
        const useLocation = useLocationCheckbox
            ? datasetSearchLocationState.get(tableName)
            : false;
        const gpsCoords = useLocation ? await ensureGpsIfNeeded() : null;
        do_intelligent_search(tableName, query, {
            useLocation,
            gps: gpsCoords,
        });
        if (history[history.length - 1] !== query) history.push(query);
        localStorage.setItem(
            STORAGE_KEY_HISTORY,
            JSON.stringify(history.slice(-50))
        );
        localStorage.removeItem(STORAGE_KEY_DRAFT);
        historyIndex = null;

        const params = getParams(tableName);
        params.search = query;
        setParams(tableName, params);
        updateURL(tableName, params, undefined, getCommitSearchUrlOptions(options));
        renderActiveFilters(tableName);
    }

    function handleInput() {
        if (destroyed) return;
        datasetSearchState.set(
            tableName,
            globalSearchInput.value,
            componentId
        );
        localStorage.setItem(STORAGE_KEY_DRAFT, globalSearchInput.value);
    }
    addManagedListener(globalSearchInput, "input", handleInput);

    if (useLocationCheckbox) {
        addManagedListener(useLocationCheckbox, "change", async () => {
            const nextChecked = useLocationCheckbox.checked;
            localStorage.setItem(
                STORAGE_KEY_LOCATION,
                nextChecked
            );
            datasetSearchLocationState.set(tableName, nextChecked, componentId);
            if (nextChecked) {
                await ensureGpsIfNeeded();
            }
        });
    }

    function handleQueryParamSync(e) {
        if (destroyed) return;
        if (e.detail.dataset !== tableName) return;
        const params = getParams(tableName);
        const newVal = params.search || "";
        datasetSearchState.set(tableName, newVal, "query-param-sync");
        if (newVal === "") {
            localStorage.removeItem(STORAGE_KEY_DRAFT);
        } else {
            localStorage.setItem(STORAGE_KEY_DRAFT, newVal);
        }
    }
    addManagedListener(window, "dataset-query-params-changed", handleQueryParamSync);

    addManagedListener(globalSearchButton, "click", commitSearch);
    addManagedListener(globalSearchInput, "keypress", (e) => {
        if (e.key === "Enter") commitSearch();
    });
    addManagedListener(globalSearchInput, "keydown", (e) => {
        if (e.key === "ArrowUp") {
            if (!history.length) return;
            if (historyIndex === null) {
                currentDraft = globalSearchInput.value;
                historyIndex = history.length - 1;
            } else if (historyIndex > 0) {
                historyIndex -= 1;
            }
            globalSearchInput.value = history[historyIndex];
            globalSearchInput.dispatchEvent(
                new Event("input", { bubbles: true })
            );
            e.preventDefault();
        } else if (e.key === "ArrowDown") {
            if (historyIndex === null) return;
            if (historyIndex < history.length - 1) {
                historyIndex += 1;
                globalSearchInput.value = history[historyIndex];
            } else {
                historyIndex = null;
                globalSearchInput.value = currentDraft;
            }
            globalSearchInput.dispatchEvent(
                new Event("input", { bubbles: true })
            );
            e.preventDefault();
        }
    });
    if (urlParams.search) {
        const scheduleMicrotask =
            typeof globalThis.queueMicrotask === "function"
                ? globalThis.queueMicrotask.bind(globalThis)
                : (cb) => Promise.resolve().then(cb);
        scheduleMicrotask(() => commitSearch({ replaceUrl: true }));
    }

    let component = null;
    component = {
        element: wrapper,
        input: globalSearchInput,
        variant,
        dataset: tableName,
        focusInput: () => globalSearchInput.focus(),
        id: componentId,
        setLocationRowVisible(visible = true) {
            locationRow.style.display = visible ? locationRowDisplay : "none";
        },
        destroy() {
            if (destroyed) {
                return;
            }
            destroyed = true;
            listenerCleanups.forEach((cleanup) => cleanup());
            listenerCleanups.length = 0;
            clearPlaceholderFade();
            unsubscribeState();
            unsubscribeLocationState();
            const registeredComponents = datasetSearchRegistry.get(tableName);
            if (registeredComponents) {
                registeredComponents.delete(component);
                if (registeredComponents.size === 0) {
                    datasetSearchRegistry.delete(tableName);
                }
            }
        },
    };
    registerDatasetSearchComponent(tableName, component);
    return component;
}

/**
 * Build the dataset-search panel wrapper around the shared search component.
 * Between filterbar callers and the reusable dataset-search component builder.
 * Exists so panel chrome and search teardown stay bundled together.
 */
export function createDatasetSearchPanel(tableName, options = {}) {
    const {
        variant = "filterbar",
        panelClasses = ["dataset-search-panel"],
        titleLangKeyMode = DEFAULT_TITLE_LANG_KEY_MODE,
        headerClassList = [],
        titleWrapperClasses = ["dataset-search-title"],
        titleTextClasses = ["dataset-search-title-text"],
        subtitleWrapperClasses = ["dataset-search-subtitle"],
        subtitleTextClasses = ["dataset-search-subtitle-text"],
        subtitleLangKey = null,
        subtitleFallbackText = "",
        actionsWrapperClasses = [],
        headerActions = [],
        searchComponentOptions = {},
        placeholder = undefined,
        skipHeader = false,
    } = options;

    const normalizedVariant = normalizeVariantName(variant);

    const searchPanel = document.createElement("div");
    searchPanel.classList.add(...panelClasses.filter(Boolean));
    searchPanel.dataset.datasetSearch = tableName;
    searchPanel.dataset.datasetSearchVariant = normalizedVariant;

    if (!skipHeader) {
        const titleRow = buildDatasetSearchHeader(tableName, {
            titleLangKeyMode,
            headerClassList,
            titleWrapperClasses,
            titleTextClasses,
            subtitleWrapperClasses,
            subtitleTextClasses,
            subtitleLangKey,
            subtitleFallbackText,
            actionsWrapperClasses,
            headerActions,
        });
        searchPanel.appendChild(titleRow);
    }

    const searchComponent = createDatasetSearchComponent(tableName, {
        placeholder,
        ...searchComponentOptions,
        variant: normalizedVariant,
    });

    searchPanel.appendChild(searchComponent.element);

    return {
        element: searchPanel,
        searchComponent,
        destroy() {
            if (typeof searchComponent.destroy === "function") {
                searchComponent.destroy();
            }
        },
    };
}
