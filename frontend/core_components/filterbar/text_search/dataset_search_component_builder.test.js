// dataset_search_component_builder.test.js
// Verifies accessible naming for the current dataset search control builder.
// Bridges the live filterbar search DOM factory with jsdom assertions for input and button labels.
// Exists to keep icon-only search controls from regressing into unnamed interactive elements.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";

const getParamsMock = vi.fn(() => ({}));
const setParamsMock = vi.fn();
const updateURLMock = vi.fn();
const renderActiveFiltersMock = vi.fn();
const applyPermissionMock = vi.fn();
const registerComponentMock = vi.fn();
const unregisterStateMock = vi.fn();
const unregisterLocationStateMock = vi.fn();
const datasetSearchRegistryMock = new Map();
let stateSubscriber = null;

const datasetSearchStateMock = {
    initialize: vi.fn((tableName, value) => value),
    subscribe: vi.fn((_tableName, callback) => {
        stateSubscriber = callback;
        return unregisterStateMock;
    }),
    get: vi.fn(() => ""),
    set: vi.fn(),
};

const datasetSearchLocationStateMock = {
    initialize: vi.fn(() => false),
    subscribe: vi.fn(() => unregisterLocationStateMock),
    get: vi.fn(() => false),
    set: vi.fn(),
};

vi.mock("../../endpoints/endpoint_router.js", () => ({
    get_endpoint_url: () => "/api/getIntelligentResults",
}));

vi.mock("../../navigation/nav_engine/query_params.js", () => ({
    DATASET_PREFIX: "/",
    getParams: getParamsMock,
    setParams: setParamsMock,
    updateURL: updateURLMock,
}));

vi.mock("../filter_list/active_filter_tag_printer.js", () => ({
    renderActiveFilters: renderActiveFiltersMock,
}));

vi.mock("../../route_permission_checker.js", () => ({
    applyPermission: applyPermissionMock,
}));

vi.mock("./dataset_search_state_reader.js", () => ({
    datasetSearchRegistry: datasetSearchRegistryMock,
    datasetSearchLocationState: datasetSearchLocationStateMock,
    datasetSearchState: datasetSearchStateMock,
    generateDatasetSearchIdPrefix: (tableName, variant) => `${tableName}_${variant}`,
    normalizeVariantName: (variant) => variant,
    registerDatasetSearchComponent: (tableName, component) => {
        registerComponentMock(tableName, component);
        if (!datasetSearchRegistryMock.has(tableName)) {
            datasetSearchRegistryMock.set(tableName, new Set());
        }
        datasetSearchRegistryMock.get(tableName).add(component);
    },
    shouldRenderLocationCheckbox: () => true,
}));

vi.mock("./dataset_search_header_builder.js", () => ({
    DEFAULT_TITLE_LANG_KEY_MODE: "dataset",
    buildDatasetSearchHeader: () => document.createElement("div"),
}));

vi.mock("./dataset_search_location_handler.js", () => ({
    getStoredGpsCoords: () => null,
    requestGpsPosition: vi.fn().mockResolvedValue({ lat: 60.17, lon: 24.94 }),
}));

vi.mock("./dataset_search_executor.js", () => ({
    do_intelligent_search: vi.fn(),
}));

describe("createDatasetSearchComponent", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        vi.clearAllMocks();
        getParamsMock.mockReturnValue({});
        datasetSearchStateMock.initialize.mockImplementation((_tableName, value) => value);
        datasetSearchStateMock.get.mockReturnValue("");
        datasetSearchLocationStateMock.get.mockReturnValue(false);
        datasetSearchRegistryMock.clear();
        stateSubscriber = null;
        window.history.replaceState({}, "", "/");
    });

    test("adds accessible labels to the search input and icon-only submit button", async () => {
        const { createDatasetSearchComponent } = await import("./dataset_search_component_builder.js");

        const component = createDatasetSearchComponent("app_users");
        const inputLabel = component.element.querySelector(`label[for="${component.input.id}"]`);
        const submitButton = component.element.querySelector("button");
        const buttonLabel = submitButton.querySelector('span[data-lang-key="search"]');
        const buttonIcon = submitButton.querySelector(".dataset-search-submit-icon");

        expect(inputLabel).not.toBeNull();
        expect(inputLabel.dataset.langKey).toBe("search_for_app_users");
        expect(submitButton).not.toBeNull();
        expect(buttonIcon).not.toBeNull();
        expect(buttonLabel).not.toBeNull();
        expect(buttonLabel.textContent).toBe("Search");

        component.destroy();
    });

    test("destroy unregisters shared subscriptions and detaches query-param sync listeners", async () => {
        const { createDatasetSearchComponent } = await import("./dataset_search_component_builder.js");

        const component = createDatasetSearchComponent("app_users");
        expect(datasetSearchRegistryMock.get("app_users")?.has(component)).toBe(true);

        datasetSearchStateMock.set.mockClear();
        component.destroy();
        window.dispatchEvent(new CustomEvent("dataset-query-params-changed", {
            detail: { dataset: "app_users" },
        }));

        expect(unregisterStateMock).toHaveBeenCalled();
        expect(unregisterLocationStateMock).toHaveBeenCalled();
        expect(datasetSearchStateMock.set).not.toHaveBeenCalled();
        expect(datasetSearchRegistryMock.has("app_users")).toBe(false);
    });

    test("fades placeholder only when another search surface syncs a value into an empty input", async () => {
        vi.useFakeTimers();
        try {
            const { createDatasetSearchComponent } = await import("./dataset_search_component_builder.js");

            const component = createDatasetSearchComponent("app_users", {
                placeholder: "Search users",
            });
            expect(component.input.value).toBe("");
            expect(stateSubscriber).toEqual(expect.any(Function));

            stateSubscriber("alice", "other-search-component");

            expect(component.input.value).toBe("alice");
            const fadeGhost = component.element.querySelector(".dataset-search-placeholder-fade");
            expect(fadeGhost).not.toBeNull();
            expect(fadeGhost.textContent).toBe("Search users");

            vi.advanceTimersByTime(340);
            expect(component.element.querySelector(".dataset-search-placeholder-fade")).toBeNull();

            component.destroy();
        } finally {
            vi.useRealTimers();
        }
    });

    test("URL-seeded search preserves the current row path while syncing params", async () => {
        const historyState = { bigCard: true, dataset: "dev_agent_tasks", rowId: "853" };
        window.history.replaceState(
            historyState,
            "",
            "/dev_agent_tasks/853-filterest-application-platform-component-inventory?search=853&view=article",
        );
        getParamsMock.mockReturnValue({ search: "853", view: "article" });
        datasetSearchStateMock.get.mockReturnValue("853");
        const { createDatasetSearchComponent } = await import("./dataset_search_component_builder.js");

        const component = createDatasetSearchComponent("dev_agent_tasks");
        await Promise.resolve();
        await Promise.resolve();

        expect(updateURLMock).toHaveBeenCalledWith(
            "dev_agent_tasks",
            { search: "853", view: "article" },
            undefined,
            {
                replace: true,
                pathOverride: "/dev_agent_tasks/853-filterest-application-platform-component-inventory",
                state: expect.any(Object),
            },
        );

        component.destroy();
    });

    test("manual search on an article row keeps the row path but still allows a push", async () => {
        const historyState = { bigCard: true, dataset: "dev_agent_tasks", rowId: "853" };
        window.history.replaceState(
            historyState,
            "",
            "/dev_agent_tasks/853-filterest-application-platform-component-inventory?view=article",
        );
        getParamsMock.mockReturnValue({ view: "article" });
        datasetSearchStateMock.get.mockReturnValue("status");
        const { createDatasetSearchComponent } = await import("./dataset_search_component_builder.js");

        const component = createDatasetSearchComponent("dev_agent_tasks");
        component.element.querySelector("button").click();
        await Promise.resolve();

        expect(updateURLMock).toHaveBeenCalledWith(
            "dev_agent_tasks",
            { view: "article", search: "status" },
            undefined,
            {
                pathOverride: "/dev_agent_tasks/853-filterest-application-platform-component-inventory",
                state: expect.any(Object),
            },
        );

        component.destroy();
    });
});
