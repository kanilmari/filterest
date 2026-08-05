// table_chat_printer.test.js
// Verifies the filterbar AI chat UI uses the API-first query facade.
// Bridges chat input events, endpoint routing, and dataset rendering through jsdom.
// Exists to keep the removed legacy SSE transport from sneaking back into the UI.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";

let configuredChatMode = "api_tools";
const endpointRouterMock = vi.fn();
const generateTableMock = vi.fn();
const disconnectInfiniteScrollMock = vi.fn();
const resetOffsetMock = vi.fn();
const updateOffsetMock = vi.fn();
const hasCachedSearchResultsMock = vi.fn();
const refreshTableUnifiedMock = vi.fn();
const getUnifiedTableStateMock = vi.fn();
const sortCachedSearchResultsMock = vi.fn();
const setUnifiedTableStateMock = vi.fn();
const getParamsMock = vi.fn();
const setParamsMock = vi.fn();
const updateURLMock = vi.fn();
const emitDatasetSortSelectionMock = vi.fn();
const hasRoutePermissionMock = vi.fn();
let tableState;
let queryParamsState;

async function loadModule() {
    vi.resetModules();
    vi.doMock("../../table_views/dataset_view_printer.js", () => ({
        generate_table: generateTableMock,
    }));
    vi.doMock("../../infinite_scroll/infinite_scroll_handler.js", () => ({
        disconnectInfiniteScroll: disconnectInfiniteScrollMock,
        resetOffset: resetOffsetMock,
        updateOffset: updateOffsetMock,
    }));
    vi.doMock(
        "../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js",
        () => ({
            getUnifiedTableState: getUnifiedTableStateMock,
            setUnifiedTableState: setUnifiedTableStateMock,
            refreshTableUnified: refreshTableUnifiedMock,
        })
    );
    vi.doMock("../../endpoints/endpoint_router.js", () => ({
        endpoint_router: endpointRouterMock,
    }));
    vi.doMock("../../lang/translation_handler.js", () => ({
        getTranslationForKey: (key) =>
            ({
                send: "Send",
                write_question: "Write your question",
                results_loaded: "Results loaded.",
            })[key] || "",
    }));
    vi.doMock("../../route_permission_checker.js", () => ({
        hasRoutePermission: hasRoutePermissionMock,
    }));
    vi.doMock("../../navigation/nav_engine/query_params.js", () => ({
        getParams: getParamsMock,
        setParams: setParamsMock,
        updateURL: updateURLMock,
    }));
    vi.doMock("../../filterbar/top_row_buttons/sort_sync_state.js", () => ({
        emitDatasetSortSelection: emitDatasetSortSelectionMock,
    }));
    vi.doMock("../../filterbar/text_search/dataset_search_executor.js", () => ({
        hasCachedSearchResults: hasCachedSearchResultsMock,
        sortCachedSearchResults: sortCachedSearchResultsMock,
    }));
    vi.doMock("../../../ui_config.js", () => ({
        FILTERBAR_AI_CHAT_MODE: configuredChatMode,
    }));
    return import("./table_chat_printer.js");
}

describe("create_chat_ui", () => {
    beforeEach(() => {
        configuredChatMode = "api_tools";
        endpointRouterMock.mockReset();
        generateTableMock.mockReset();
        disconnectInfiniteScrollMock.mockReset();
        resetOffsetMock.mockReset();
        updateOffsetMock.mockReset();
        hasRoutePermissionMock.mockReset();
        hasRoutePermissionMock.mockImplementation(
            (route) => route === "/api/app/ai-chat/query"
        );
        generateTableMock.mockResolvedValue(undefined);
        refreshTableUnifiedMock.mockResolvedValue(undefined);
        hasCachedSearchResultsMock.mockReset();
        getUnifiedTableStateMock.mockReset();
        sortCachedSearchResultsMock.mockReset();
        setUnifiedTableStateMock.mockReset();
        getParamsMock.mockReset();
        setParamsMock.mockReset();
        updateURLMock.mockReset();
        emitDatasetSortSelectionMock.mockReset();
        tableState = { filters: {}, sort: { column: null, direction: null }, offset: 0 };
        queryParamsState = {};
        getUnifiedTableStateMock.mockImplementation(() => structuredClone(tableState));
        setUnifiedTableStateMock.mockImplementation((_, nextState) => {
            tableState = structuredClone(nextState);
        });
        getParamsMock.mockImplementation(() => ({ ...queryParamsState }));
        setParamsMock.mockImplementation((_, params) => {
            queryParamsState = { ...params };
        });
        hasCachedSearchResultsMock.mockReturnValue(false);
        sortCachedSearchResultsMock.mockResolvedValue(true);
        localStorage.clear();
        document.documentElement.lang = "en";
        document.head.innerHTML = "";
        document.body.innerHTML = `<div id="chat-host"></div>`;
    });

    test("renders the composer as one full-width textarea row with full-width action buttons", async () => {
        endpointRouterMock.mockResolvedValue({
            dataset: "app_service_catalog",
            messages: [],
            preview: "",
            updated_at: null,
        });

        const { create_chat_ui } = await loadModule();
        const host = document.getElementById("chat-host");

        create_chat_ui("app_service_catalog", host);

        expect(document.querySelector(".chat_input_row textarea")?.id).toBe(
            "app_service_catalog_chat_input"
        );
        expect(document.querySelector(".chat_input_row textarea")?.getAttribute("rows")).toBe("3");
        expect(
            document.querySelector(".chat_inner")?.firstElementChild?.id
        ).toBe("app_service_catalog_chat_container");
        expect(
            document.querySelector(".chat_inner")?.lastElementChild?.classList.contains("chat_input_row")
        ).toBe(true);
        expect(
            Array.from(document.querySelectorAll(".chat_action_row button")).map(
                (button) => button.textContent
            )
        ).toEqual(["Poista historia", "Send message"]);
    });

    test("keeps Enter available for new lines and sends textarea content with Ctrl Enter", async () => {
        endpointRouterMock.mockImplementation((routeName, options = {}) => {
            if (routeName === "aiChatConversation" && !options.method) {
                return Promise.resolve({
                    dataset: "app_service_catalog",
                    messages: [],
                    preview: "",
                    updated_at: null,
                });
            }
            if (routeName === "aiChatConversation" && options.method === "PUT") {
                return Promise.resolve({
                    dataset: "app_service_catalog",
                    messages: options.body_data.messages,
                    preview: options.body_data.preview,
                    updated_at: options.body_data.updated_at,
                });
            }
            if (routeName === "aiChatQuery") {
                return Promise.resolve({
                    answer: "Handled multiline prompt.",
                });
            }
            return Promise.resolve({});
        });

        const { create_chat_ui } = await loadModule();
        const host = document.getElementById("chat-host");

        create_chat_ui("app_service_catalog", host);

        const textarea = document.getElementById("app_service_catalog_chat_input");
        endpointRouterMock.mockClear();

        textarea.value = "first line";
        const enterEvent = new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true,
        });
        textarea.dispatchEvent(enterEvent);

        expect(enterEvent.defaultPrevented).toBe(false);
        expect(endpointRouterMock).not.toHaveBeenCalledWith("aiChatQuery", expect.anything());

        textarea.value = "first line\nsecond line";
        const sendEvent = new KeyboardEvent("keydown", {
            key: "Enter",
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
        });
        textarea.dispatchEvent(sendEvent);

        expect(sendEvent.defaultPrevented).toBe(true);
        await vi.waitFor(() => {
            expect(endpointRouterMock).toHaveBeenCalledWith("aiChatQuery", {
                method: "POST",
                body_data: {
                    dataset: "app_service_catalog",
                    query: "first line\nsecond line",
                    lang: "en",
                    messages: [
                        expect.objectContaining({
                            role: "user",
                            content: "first line\nsecond line",
                            created_at: expect.any(String),
                        }),
                    ],
                },
            });
        });
    });

    test("offers secure inline OpenAI key setup and retries chat after saving", async () => {
        let queryAttempts = 0;
        endpointRouterMock.mockImplementation((routeName, options = {}) => {
            if (routeName === "aiChatConversation" && !options.method) {
                return Promise.resolve({
                    dataset: "app_service_catalog",
                    messages: [],
                    preview: "",
                    updated_at: null,
                });
            }
            if (routeName === "aiChatConversation" && options.method === "PUT") {
                return Promise.resolve({
                    dataset: "app_service_catalog",
                    messages: options.body_data.messages,
                    preview: options.body_data.preview,
                    updated_at: options.body_data.updated_at,
                });
            }
            if (routeName === "aiChatQuery") {
                queryAttempts += 1;
                return Promise.resolve(queryAttempts === 1
                    ? { configuration_required: { code: "openai_api_key_missing" } }
                    : { answer: "Chat works now." });
            }
            if (routeName === "saveOpenAIAPIKey") {
                return Promise.resolve({ saved: true });
            }
            return Promise.resolve({});
        });

        const { create_chat_ui } = await loadModule();
        create_chat_ui("app_service_catalog", document.getElementById("chat-host"));

        const textarea = document.getElementById("app_service_catalog_chat_input");
        textarea.value = "show services";
        document.getElementById("app_service_catalog_chat_sendBtn").click();

        await vi.waitFor(() => {
            expect(document.querySelector(".chat-openai-key-setup input[type='password']")).not.toBeNull();
        });
        expect(document.querySelector(".chat-bubble-error")).toBeNull();

        const secretInput = document.querySelector(".chat-openai-key-setup input");
        secretInput.value = "test-inline-secret";
        document.querySelector(".chat-openai-key-setup").dispatchEvent(new Event("submit", {
            bubbles: true,
            cancelable: true,
        }));

        await vi.waitFor(() => {
            expect(endpointRouterMock).toHaveBeenCalledWith("saveOpenAIAPIKey", {
                method: "POST",
                body_data: { api_key: "test-inline-secret" },
            });
            expect(
                document.getElementById("app_service_catalog_chat_container")?.textContent
            ).toContain("Chat works now.");
        });
        expect(document.body.textContent).not.toContain("test-inline-secret");
        expect(queryAttempts).toBe(2);
    });

    test("restores the in-progress multiline draft after browsing message history", async () => {
        endpointRouterMock.mockImplementation((routeName, options = {}) => {
            if (routeName === "aiChatConversation" && !options.method) {
                return Promise.resolve({
                    dataset: "app_service_catalog",
                    messages: [],
                    preview: "",
                    updated_at: null,
                });
            }
            if (routeName === "aiChatConversation" && options.method === "PUT") {
                return Promise.resolve({
                    dataset: "app_service_catalog",
                    messages: options.body_data.messages,
                    preview: options.body_data.preview,
                    updated_at: options.body_data.updated_at,
                });
            }
            if (routeName === "aiChatQuery") {
                return Promise.resolve({
                    answer: "ok",
                });
            }
            return Promise.resolve({});
        });

        const { create_chat_ui } = await loadModule();
        const host = document.getElementById("chat-host");

        create_chat_ui("app_service_catalog", host);

        const textarea = document.getElementById("app_service_catalog_chat_input");
        const sendButton = document.getElementById("app_service_catalog_chat_sendBtn");

        textarea.value = "first sent message";
        sendButton.click();
        await vi.waitFor(() => {
            expect(endpointRouterMock).toHaveBeenCalledWith("aiChatQuery", expect.objectContaining({
                body_data: expect.objectContaining({ query: "first sent message" }),
            }));
        });
        await vi.waitFor(() => {
            expect(sendButton.disabled).toBe(false);
        });

        textarea.value = "second sent message";
        sendButton.click();
        await vi.waitFor(() => {
            expect(endpointRouterMock).toHaveBeenCalledWith("aiChatQuery", expect.objectContaining({
                body_data: expect.objectContaining({ query: "second sent message" }),
            }));
        });
        await vi.waitFor(() => {
            expect(sendButton.disabled).toBe(false);
        });

        textarea.value = "draft line one\ndraft line two";
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);

        const multilineArrowUpEvent = new KeyboardEvent("keydown", {
            key: "ArrowUp",
            bubbles: true,
            cancelable: true,
        });
        textarea.dispatchEvent(multilineArrowUpEvent);

        expect(multilineArrowUpEvent.defaultPrevented).toBe(false);
        expect(textarea.value).toBe("draft line one\ndraft line two");

        const arrowUpEvent = new KeyboardEvent("keydown", {
            key: "ArrowUp",
            bubbles: true,
            cancelable: true,
        });
        textarea.setSelectionRange(0, 0);
        textarea.dispatchEvent(arrowUpEvent);

        expect(arrowUpEvent.defaultPrevented).toBe(true);
        expect(textarea.value).toBe("second sent message");

        const arrowDownEvent = new KeyboardEvent("keydown", {
            key: "ArrowDown",
            bubbles: true,
            cancelable: true,
        });
        textarea.dispatchEvent(arrowDownEvent);

        expect(arrowDownEvent.defaultPrevented).toBe(true);
        expect(textarea.value).toBe("draft line one\ndraft line two");
        expect(textarea.selectionStart).toBe(textarea.value.length);
    });

    test("hydrates the chat from the server-backed conversation endpoint on init", async () => {
        endpointRouterMock.mockImplementation((routeName, options = {}) => {
            if (routeName === "aiChatConversation" && !options.method) {
                return Promise.resolve({
                    dataset: "app_service_catalog",
                    messages: [
                        { role: "user", content: "Find Finnish CRMs" },
                        { role: "assistant", content: "Here are some candidates." },
                    ],
                    preview: "Here are some candidates.",
                    updated_at: "2026-04-23T12:30:00Z",
                });
            }
            return Promise.resolve({});
        });

        const { create_chat_ui } = await loadModule();
        const host = document.getElementById("chat-host");

        create_chat_ui("app_service_catalog", host);

        await vi.waitFor(() => {
            expect(endpointRouterMock).toHaveBeenCalledWith("aiChatConversation", {
                url_params: "?dataset=app_service_catalog",
            });
        });
        await vi.waitFor(() => {
            expect(
                document.getElementById("app_service_catalog_chat_container")?.textContent
            ).toContain("Here are some candidates.");
        });

        expect(
            JSON.parse(localStorage.getItem("gptChatConversation_app_service_catalog"))
        ).toEqual({
            messages: [
                { role: "user", content: "Find Finnish CRMs" },
                { role: "assistant", content: "Here are some candidates." },
            ],
            updated_at: "2026-04-23T12:30:00Z",
            needs_sync: false,
        });
    });

    test("renders message timestamps above restored chat messages", async () => {
        endpointRouterMock.mockImplementation((routeName, options = {}) => {
            if (routeName === "aiChatConversation" && !options.method) {
                return Promise.resolve({
                    dataset: "app_service_catalog",
                    messages: [
                        {
                            role: "user",
                            content: "Find Finnish CRMs",
                            created_at: "2026-04-23T12:30:00Z",
                        },
                        {
                            role: "assistant",
                            content: "Here are some candidates.",
                            created_at: "2026-04-23T12:31:00Z",
                        },
                    ],
                    preview: "Here are some candidates.",
                    updated_at: "2026-04-23T12:31:00Z",
                });
            }
            return Promise.resolve({});
        });

        const { create_chat_ui } = await loadModule();
        const host = document.getElementById("chat-host");

        create_chat_ui("app_service_catalog", host);

        await vi.waitFor(() => {
            expect(
                document.getElementById("app_service_catalog_chat_container")?.textContent
            ).toContain("Here are some candidates.");
        });

        const timestamps = Array.from(document.querySelectorAll(".chat-message-timestamp"));
        expect(timestamps).toHaveLength(2);
        expect(timestamps[0].dateTime).toBe("2026-04-23T12:30:00.000Z");
        expect(timestamps[1].dateTime).toBe("2026-04-23T12:31:00.000Z");
    });

    test("renders API usage and 100 percent cost metadata only in DEV chat", async () => {
        document.head.innerHTML = '<meta name="app-env" content="dev">';
        endpointRouterMock.mockImplementation((routeName, options = {}) => {
            if (routeName === "aiChatConversation" && !options.method) {
                return Promise.resolve({
                    dataset: "app_service_catalog",
                    messages: [],
                    preview: "",
                    updated_at: null,
                });
            }
            if (routeName === "aiChatConversation" && options.method === "PUT") {
                return Promise.resolve({
                    dataset: "app_service_catalog",
                    messages: options.body_data.messages,
                    preview: options.body_data.preview,
                    updated_at: options.body_data.updated_at,
                });
            }
            if (routeName === "aiChatQuery") {
                return Promise.resolve({
                    answer: "Handled with usage.",
                    usage: {
                        provider: "openai",
                        model: "gpt-5.5",
                        effort: "medium",
                        input_tokens: 1000,
                        output_tokens: 200,
                        total_tokens: 1200,
                        reasoning_tokens: 40,
                        cost_usd: 0.011,
                        pricing_note: "OpenAI standard token pricing.",
                    },
                });
            }
            return Promise.resolve({});
        });

        const { create_chat_ui } = await loadModule();
        const host = document.getElementById("chat-host");

        create_chat_ui("app_service_catalog", host);

        const input = document.getElementById("app_service_catalog_chat_input");
        const sendButton = document.getElementById("app_service_catalog_chat_sendBtn");
        input.value = "How much did this cost?";
        sendButton.click();

        await vi.waitFor(() => {
            const usageText = document.querySelector(".chat-usage-summary")?.textContent || "";
            expect(usageText).toContain("100% API cost");
            expect(usageText).toContain("openai / gpt-5.5");
            expect(usageText).toContain("in 1,000");
            expect(usageText).toContain("out 200");
            expect(usageText).toContain("$0.011");
        });

        const storedMessages = JSON.parse(
            localStorage.getItem("gptChatConversation_app_service_catalog")
        )?.messages || [];
        expect(storedMessages[1]).toEqual(expect.objectContaining({
            role: "assistant",
            content: expect.stringContaining("Handled with usage."),
            usage: expect.objectContaining({
                model: "gpt-5.5",
                total_tokens: 1200,
            }),
        }));
    });

    test("routes send actions through aiChatQuery when api_tools mode is available", async () => {
        const resultMemory = {
            role: "system",
            content: '[easelect_result_context]\n{"rows":[{"title":"Firefox"}]}',
        };
        endpointRouterMock.mockImplementation((routeName, options = {}) => {
            if (routeName === "aiChatConversation" && !options.method) {
                return Promise.resolve({
                    dataset: "app_service_catalog",
                    messages: [],
                    preview: "",
                    updated_at: null,
                });
            }
            if (routeName === "aiChatConversation" && options.method === "PUT") {
                return Promise.resolve({
                    dataset: "app_service_catalog",
                    messages: options.body_data.messages,
                    preview: options.body_data.preview,
                    updated_at: options.body_data.updated_at,
                });
            }
            if (routeName === "aiChatQuery") {
                return Promise.resolve({
                    answer: "Returned 1 result rows through text_search.",
                    memory: resultMemory,
                    result: {
                        columns: ["id", "header"],
                        data: [{ id: 1, header: "Firefox" }],
                        types: { header: "text" },
                        row_count: 1,
                        has_geo: false,
                    },
                });
            }
            return Promise.resolve({});
        });
        const { create_chat_ui } = await loadModule();
        const host = document.getElementById("chat-host");

        create_chat_ui("app_service_catalog", host);

        const input = document.getElementById("app_service_catalog_chat_input");
        const sendButton = document.getElementById("app_service_catalog_chat_sendBtn");
        input.value = "open source browser";
        sendButton.click();

        await vi.waitFor(() => {
            expect(endpointRouterMock).toHaveBeenCalledWith("aiChatQuery", {
                method: "POST",
                body_data: {
                    dataset: "app_service_catalog",
                    query: "open source browser",
                    lang: "en",
                    messages: [
                        expect.objectContaining({
                            role: "user",
                            content: "open source browser",
                            created_at: expect.any(String),
                        }),
                    ],
                },
            });
        });
        await vi.waitFor(() => {
            expect(endpointRouterMock).toHaveBeenCalledWith(
                "aiChatConversation",
                expect.objectContaining({
                    method: "PUT",
                    body_data: expect.objectContaining({
                        dataset: "app_service_catalog",
                        preview: "Returned 1 result rows through text_search.",
                        messages: [
                            expect.objectContaining({
                                role: "user",
                                content: "open source browser",
                                created_at: expect.any(String),
                            }),
                            expect.objectContaining({
                                role: "assistant",
                                content: "Returned 1 result rows through text_search.",
                                created_at: expect.any(String),
                            }),
                            resultMemory,
                        ],
                    }),
                })
            );
        });
        expect(generateTableMock).toHaveBeenCalledWith(
            "app_service_catalog",
            ["id", "header"],
            [{ id: 1, header: "Firefox" }],
            {
                id: { card_element: "details", data_type: "text", show_value_on_card: true },
                header: { card_element: "details", data_type: "text", show_value_on_card: true },
            },
            1,
            false,
            undefined
        );
        expect(disconnectInfiniteScrollMock).toHaveBeenCalledWith("app_service_catalog");
        expect(resetOffsetMock).toHaveBeenCalledWith("app_service_catalog");
        expect(updateOffsetMock).toHaveBeenCalledWith("app_service_catalog", 1);
        expect(resetOffsetMock.mock.invocationCallOrder[0]).toBeLessThan(
            updateOffsetMock.mock.invocationCallOrder[0]
        );
        expect(updateOffsetMock.mock.invocationCallOrder[0]).toBeLessThan(
            generateTableMock.mock.invocationCallOrder[0]
        );
        await vi.waitFor(() => {
            expect(
                document.getElementById("app_service_catalog_chat_container")?.textContent
            ).toContain("Returned 1 result rows through text_search.");
        });
        await vi.waitFor(() => {
            expect(
                JSON.parse(localStorage.getItem("gptChatConversation_app_service_catalog"))
            ).toEqual({
                messages: [
                    expect.objectContaining({
                        role: "user",
                        content: "open source browser",
                        created_at: expect.any(String),
                    }),
                    expect.objectContaining({
                        role: "assistant",
                        content: "Returned 1 result rows through text_search.",
                        created_at: expect.any(String),
                    }),
                    resultMemory,
                ],
                updated_at: expect.any(String),
                needs_sync: false,
            });
        });
        expect(
            document.getElementById("app_service_catalog_chat_container")?.textContent
        ).not.toContain("[easelect_result_context]");

        endpointRouterMock.mockClear();
        input.value = "Which result did you find?";
        sendButton.click();

        await vi.waitFor(() => {
            expect(endpointRouterMock).toHaveBeenCalledWith("aiChatQuery", {
                method: "POST",
                body_data: {
                    dataset: "app_service_catalog",
                    query: "Which result did you find?",
                    lang: "en",
                    messages: [
                        expect.objectContaining({
                            role: "user",
                            content: "open source browser",
                            created_at: expect.any(String),
                        }),
                        expect.objectContaining({
                            role: "assistant",
                            content: "Returned 1 result rows through text_search.",
                            created_at: expect.any(String),
                        }),
                        resultMemory,
                        expect.objectContaining({
                            role: "user",
                            content: "Which result did you find?",
                            created_at: expect.any(String),
                        }),
                    ],
                },
            });
        });
    });

    test("does not rerender dataset content for answer-only chat replies", async () => {
        endpointRouterMock.mockImplementation((routeName, options = {}) => {
            if (routeName === "aiChatConversation" && !options.method) {
                return Promise.resolve({
                    dataset: "app_service_catalog",
                    messages: [],
                    preview: "",
                    updated_at: null,
                });
            }
            if (routeName === "aiChatConversation" && options.method === "PUT") {
                return Promise.resolve({
                    dataset: "app_service_catalog",
                    messages: options.body_data.messages,
                    preview: options.body_data.preview,
                    updated_at: options.body_data.updated_at,
                });
            }
            if (routeName === "aiChatQuery") {
                return Promise.resolve({
                    answer: "Voin auttaa ideoimaan ilman tietokantahakua.",
                    plan: {
                        mode: "answer_only",
                        uses_sql: false,
                    },
                    result: {},
                });
            }
            return Promise.resolve({});
        });

        const { create_chat_ui } = await loadModule();
        const host = document.getElementById("chat-host");

        create_chat_ui("app_service_catalog", host);

        const input = document.getElementById("app_service_catalog_chat_input");
        const sendButton = document.getElementById("app_service_catalog_chat_sendBtn");
        input.value = "Millaisia palveluita tähän kannattaisi lisätä?";
        sendButton.click();

        await vi.waitFor(() => {
            expect(
                document.getElementById("app_service_catalog_chat_container")?.textContent
            ).toContain("Voin auttaa ideoimaan");
        });
        expect(
            document.getElementById("app_service_catalog_chat_container")?.textContent
        ).toContain("No results were fetched this turn; the current result view was left unchanged.");
        expect(generateTableMock).not.toHaveBeenCalled();
        expect(refreshTableUnifiedMock).not.toHaveBeenCalled();
    });

    test("does not rerender dataset content for empty current-dataset AI results", async () => {
        endpointRouterMock.mockImplementation((routeName, options = {}) => {
            if (routeName === "aiChatConversation" && !options.method) {
                return Promise.resolve({
                    dataset: "riskienhallinta",
                    messages: [],
                    preview: "",
                    updated_at: null,
                });
            }
            if (routeName === "aiChatConversation" && options.method === "PUT") {
                return Promise.resolve({
                    dataset: "riskienhallinta",
                    messages: options.body_data.messages,
                    preview: options.body_data.preview,
                    updated_at: options.body_data.updated_at,
                });
            }
            if (routeName === "aiChatQuery") {
                return Promise.resolve({
                    answer: "En löytänyt näkyvistä tuloksista yhtään riskiä, jossa viitattaisiin suoraan tietoturvaan.",
                    plan: {
                        dataset: "riskienhallinta",
                        mode: "text_search",
                        canonical_path: "/api/get-intelligent-results",
                        uses_sql: false,
                        search_query: "tietoturva",
                    },
                    result: {
                        columns: ["id", "riski", "kuvaus"],
                        data: [],
                        types: {
                            id: { card_element: "details", data_type: "integer", show_value_on_card: true },
                            riski: { card_element: "header", data_type: "text", show_value_on_card: true },
                            kuvaus: { card_element: "description", data_type: "text", show_value_on_card: true },
                        },
                        row_count: 30,
                        has_geo: false,
                    },
                });
            }
            return Promise.resolve({});
        });

        const { create_chat_ui } = await loadModule();
        const host = document.getElementById("chat-host");

        create_chat_ui("riskienhallinta", host);

        const input = document.getElementById("riskienhallinta_chat_input");
        const sendButton = document.getElementById("riskienhallinta_chat_sendBtn");
        input.value = "Mitkä näistä riskeistä koskevat tietoturvaa?";
        sendButton.click();

        await vi.waitFor(() => {
            expect(
                document.getElementById("riskienhallinta_chat_container")?.textContent
            ).toContain("En löytänyt näkyvistä tuloksista");
        });
        expect(
            document.getElementById("riskienhallinta_chat_container")?.textContent
        ).toContain("No results were fetched this turn; the current result view was left unchanged.");
        expect(generateTableMock).not.toHaveBeenCalled();
        expect(refreshTableUnifiedMock).not.toHaveBeenCalled();
    });

    test("does not show no-result notice when API chat read another dataset", async () => {
        endpointRouterMock.mockImplementation((routeName, options = {}) => {
            if (routeName === "aiChatConversation" && !options.method) {
                return Promise.resolve({
                    dataset: "app_service_catalog",
                    messages: [],
                    preview: "",
                    updated_at: null,
                });
            }
            if (routeName === "aiChatConversation" && options.method === "PUT") {
                return Promise.resolve({
                    dataset: "app_service_catalog",
                    messages: options.body_data.messages,
                    preview: options.body_data.preview,
                    updated_at: options.body_data.updated_at,
                });
            }
            if (routeName === "aiChatQuery") {
                return Promise.resolve({
                    answer: "Löysin aiheeseen liittyvän tehtävän dev_agent_tasks-datasetistä.",
                    plan: {
                        dataset: "app_service_catalog",
                        mode: "answer_only",
                        uses_sql: false,
                    },
                    result: {},
                    results: [
                        {
                            dataset: "dev_agent_tasks",
                            plan: {
                                dataset: "dev_agent_tasks",
                                mode: "text_search",
                                uses_sql: false,
                                canonical_path: "/api/get-intelligent-results",
                                search_query: "serlog palvelukatalogi",
                            },
                            result: {
                                columns: ["id", "title"],
                                data: [{ id: 42, title: "Korjaa Serlog-palvelukatalogin haku" }],
                                row_count: 1,
                            },
                        },
                    ],
                });
            }
            return Promise.resolve({});
        });

        const { create_chat_ui } = await loadModule();
        const host = document.getElementById("chat-host");

        create_chat_ui("app_service_catalog", host);

        const input = document.getElementById("app_service_catalog_chat_input");
        const sendButton = document.getElementById("app_service_catalog_chat_sendBtn");
        input.value = "Onko tähän liittyviä tehtäviä?";
        sendButton.click();

        await vi.waitFor(() => {
            expect(
                document.getElementById("app_service_catalog_chat_container")?.textContent
            ).toContain("dev_agent_tasks");
        });
        expect(
            document.getElementById("app_service_catalog_chat_container")?.textContent
        ).not.toContain("No results were fetched this turn; the current result view was left unchanged.");
        expect(generateTableMock).not.toHaveBeenCalled();
        expect(refreshTableUnifiedMock).not.toHaveBeenCalled();
    });

    test("preserves stored card metadata when AI result types are only primitive hints", async () => {
        localStorage.setItem(
            "app_service_catalog_dataTypes",
            JSON.stringify({
                id: { card_element: "hidden", data_type: "INTEGER", show_value_on_card: false },
                header: { card_element: "header", data_type: "TEXT", show_value_on_card: true },
                cached_image: { card_element: "image", data_type: "TEXT", show_value_on_card: true },
                description: {
                    card_element: "description1",
                    data_type: "TEXT",
                    show_value_on_card: true,
                },
            })
        );
        endpointRouterMock.mockImplementation((routeName, options = {}) => {
            if (routeName === "aiChatConversation" && !options.method) {
                return Promise.resolve({
                    dataset: "app_service_catalog",
                    messages: [],
                    preview: "",
                    updated_at: null,
                });
            }
            if (routeName === "aiChatConversation" && options.method === "PUT") {
                return Promise.resolve({
                    dataset: "app_service_catalog",
                    messages: options.body_data.messages,
                    preview: options.body_data.preview,
                    updated_at: options.body_data.updated_at,
                });
            }
            if (routeName === "aiChatQuery") {
                return Promise.resolve({
                    answer: "Löysin yhden palvelun.",
                    result: {
                        columns: ["id", "header", "cached_image"],
                        data: [{
                            id: 166,
                            header: "Serlog.com -palvelukatalogi",
                            cached_image: "serlog.png",
                        }],
                        types: {
                            id: "INTEGER",
                            header: "TEXT",
                            cached_image: "TEXT",
                        },
                        row_count: 1,
                        has_geo: false,
                    },
                });
            }
            return Promise.resolve({});
        });

        const { create_chat_ui } = await loadModule();
        const host = document.getElementById("chat-host");

        create_chat_ui("app_service_catalog", host);

        const input = document.getElementById("app_service_catalog_chat_input");
        const sendButton = document.getElementById("app_service_catalog_chat_sendBtn");
        input.value = "Näytä serlog-palvelu";
        sendButton.click();

        await vi.waitFor(() => {
            expect(generateTableMock).toHaveBeenCalled();
        });
        const dataTypes = generateTableMock.mock.calls[0][3];
        expect(dataTypes.header.card_element).toBe("header");
        expect(dataTypes.cached_image.card_element).toBe("image");
        expect(dataTypes.description.card_element).toBe("description1");
        expect(dataTypes.id.show_value_on_card).toBe(false);
    });

    test("does not force text_search when the user asks for the latest rows", async () => {
        endpointRouterMock.mockImplementation((routeName, options = {}) => {
            if (routeName === "aiChatConversation" && !options.method) {
                return Promise.resolve({
                    dataset: "app_service_catalog",
                    messages: [],
                    preview: "",
                    updated_at: null,
                });
            }
            if (routeName === "aiChatConversation" && options.method === "PUT") {
                return Promise.resolve({
                    dataset: "app_service_catalog",
                    messages: options.body_data.messages,
                    preview: options.body_data.preview,
                    updated_at: options.body_data.updated_at,
                });
            }
            if (routeName === "aiChatQuery") {
                return Promise.resolve({
                    answer: "Sorted results by created_at DESC.",
                    plan: {
                        mode: "rows_page",
                        canonical_path: "/api/get-results",
                        uses_sql: false,
                        sort_column: "created_at",
                        sort_order: "DESC",
                        apply_as_sort: true,
                    },
                    result: {
                        columns: ["id", "header", "created_at"],
                        data: [{ id: 7, header: "Latest row", created_at: "2026-04-23T12:00:00Z" }],
                        types: { header: "text", created_at: "timestamp" },
                        row_count: 1,
                        has_geo: false,
                    },
                });
            }
            return Promise.resolve({});
        });

        const { create_chat_ui } = await loadModule();
        const host = document.getElementById("chat-host");

        create_chat_ui("app_service_catalog", host);

        const input = document.getElementById("app_service_catalog_chat_input");
        const sendButton = document.getElementById("app_service_catalog_chat_sendBtn");
        input.value = "Hei, listaa uusimmat tulokset";
        sendButton.click();

        await vi.waitFor(() => {
            expect(endpointRouterMock).toHaveBeenCalledWith("aiChatQuery", {
                method: "POST",
                body_data: {
                    dataset: "app_service_catalog",
                    query: "Hei, listaa uusimmat tulokset",
                    lang: "en",
                    messages: [
                        expect.objectContaining({
                            role: "user",
                            content: "Hei, listaa uusimmat tulokset",
                            created_at: expect.any(String),
                        }),
                    ],
                },
            });
        });
        await vi.waitFor(() => {
            expect(
                document.getElementById("app_service_catalog_chat_container")?.textContent
            ).toContain("Sorted results by created_at DESC.");
        });
        expect(generateTableMock).not.toHaveBeenCalled();
        expect(setParamsMock).toHaveBeenCalledWith("app_service_catalog", {
            sort_column: "created_at",
            sort_order: "DESC",
        });
        expect(updateURLMock).toHaveBeenCalledWith(
            "app_service_catalog",
            {
                sort_column: "created_at",
                sort_order: "DESC",
            },
            undefined,
            { replace: true }
        );
        expect(emitDatasetSortSelectionMock).toHaveBeenCalledWith(
            "app_service_catalog",
            "created_at:DESC"
        );
        expect(refreshTableUnifiedMock).toHaveBeenCalledWith(
            "app_service_catalog",
            { skipUrlParams: true }
        );
    });

    test("routes DEV chat mode through Codex and renders canonical table results", async () => {
        document.head.innerHTML = '<meta name="app-env" content="dev">';
        const resultMemory = {
            role: "system",
            content: '[easelect_result_context]\n{"filters":{"cached_username":"serlog"},"rows":[{"title":"Serlog.com -palvelukatalogi"}]}',
        };
        hasRoutePermissionMock.mockImplementation((route) =>
            [
                "/api/app/ai-chat/query",
                "/api/app/ai-chat/codex-query",
            ].includes(route)
        );
        endpointRouterMock.mockImplementation((routeName, options = {}) => {
            if (routeName === "aiChatConversation" && !options.method) {
                return Promise.resolve({
                    dataset: "app_service_catalog",
                    messages: [],
                    preview: "",
                    updated_at: null,
                });
            }
            if (routeName === "aiChatConversation" && options.method === "PUT") {
                return Promise.resolve({
                    dataset: "app_service_catalog",
                    messages: options.body_data.messages,
                    preview: options.body_data.preview,
                    updated_at: options.body_data.updated_at,
                });
            }
            if (routeName === "aiChatCodexQuery") {
                return Promise.resolve({
                    dataset: "app_service_catalog",
                    mode: "codex",
                    dev_only: true,
                    answer: "Codex: tarkista user_id-haku backendin capability-polusta.",
                    plan: {
                        mode: "rows_page",
                        canonical_path: "/api/get-results",
                        uses_sql: false,
                        filters: { cached_username: "serlog" },
                    },
                    result: {
                        columns: ["id", "header", "cached_username"],
                        data: [
                            {
                                id: 166,
                                header: "Serlog.com -palvelukatalogi",
                                cached_username: "serlog",
                            },
                        ],
                        types: { header: "text", cached_username: "text" },
                        row_count: 1,
                        has_geo: false,
                    },
                    memory: resultMemory,
                });
            }
            return Promise.resolve({});
        });

        const { create_chat_ui } = await loadModule();
        const host = document.getElementById("chat-host");

        create_chat_ui("app_service_catalog", host);

        const modeSelect = document.getElementById("app_service_catalog_chat_mode");
        expect(modeSelect).not.toBeNull();
        modeSelect.value = "codex_dev";
        modeSelect.dispatchEvent(new Event("change"));

        const input = document.getElementById("app_service_catalog_chat_input");
        const sendButton = document.getElementById("app_service_catalog_chat_sendBtn");
        input.value = "Miksi user_id-haku ei löydä serlog-palvelua?";
        sendButton.click();

        await vi.waitFor(() => {
            expect(endpointRouterMock).toHaveBeenCalledWith("aiChatCodexQuery", {
                method: "POST",
                body_data: {
                    dataset: "app_service_catalog",
                    query: "Miksi user_id-haku ei löydä serlog-palvelua?",
                    lang: "en",
                    messages: [
                        expect.objectContaining({
                            role: "user",
                            content: "Miksi user_id-haku ei löydä serlog-palvelua?",
                            created_at: expect.any(String),
                        }),
                    ],
                },
            });
        });
        await vi.waitFor(() => {
            expect(
                document.getElementById("app_service_catalog_chat_container")?.textContent
            ).toContain("Codex: tarkista user_id-haku");
        });
        expect(setParamsMock).toHaveBeenCalledWith("app_service_catalog", {
            cached_username: "serlog",
        });
        expect(generateTableMock).toHaveBeenCalledWith(
            "app_service_catalog",
            ["id", "header", "cached_username"],
            [
                {
                    id: 166,
                    header: "Serlog.com -palvelukatalogi",
                    cached_username: "serlog",
                },
            ],
            {
                id: { card_element: "details", data_type: "text", show_value_on_card: true },
                header: { card_element: "details", data_type: "text", show_value_on_card: true },
                cached_username: { card_element: "details", data_type: "text", show_value_on_card: true },
            },
            1,
            false,
            undefined
        );
        await vi.waitFor(() => {
            expect(endpointRouterMock).toHaveBeenCalledWith(
                "aiChatConversation",
                expect.objectContaining({
                    method: "PUT",
                    body_data: expect.objectContaining({
                        dataset: "app_service_catalog",
                        messages: expect.arrayContaining([resultMemory]),
                    }),
                })
            );
        });
        expect(endpointRouterMock).not.toHaveBeenCalledWith(
            "aiChatQuery",
            expect.anything()
        );
    });

    test("shows a pending Codex heartbeat bubble while the request is running", async () => {
        document.head.innerHTML = '<meta name="app-env" content="dev">';
        document.documentElement.lang = "fi";
        hasRoutePermissionMock.mockImplementation((route) =>
            [
                "/api/app/ai-chat/query",
                "/api/app/ai-chat/codex-query",
            ].includes(route)
        );

        let resolveCodexQuery;
        endpointRouterMock.mockImplementation((routeName, options = {}) => {
            if (routeName === "aiChatConversation" && !options.method) {
                return Promise.resolve({
                    dataset: "app_service_catalog",
                    messages: [],
                    preview: "",
                    updated_at: null,
                });
            }
            if (routeName === "aiChatConversation" && options.method === "PUT") {
                return Promise.resolve({
                    dataset: "app_service_catalog",
                    messages: options.body_data.messages,
                    preview: options.body_data.preview,
                    updated_at: options.body_data.updated_at,
                });
            }
            if (routeName === "aiChatCodexQuery") {
                return new Promise((resolve) => {
                    resolveCodexQuery = resolve;
                });
            }
            return Promise.resolve({});
        });

        const { create_chat_ui } = await loadModule();
        const host = document.getElementById("chat-host");

        create_chat_ui("app_service_catalog", host);

        const modeSelect = document.getElementById("app_service_catalog_chat_mode");
        modeSelect.value = "codex_dev";
        modeSelect.dispatchEvent(new Event("change"));
        refreshTableUnifiedMock.mockClear();

        const input = document.getElementById("app_service_catalog_chat_input");
        const sendButton = document.getElementById("app_service_catalog_chat_sendBtn");
        input.value = "Tutki miksi localhost ei aukea Codexista";
        sendButton.click();

        await vi.waitFor(() => {
            const containerText =
                document.getElementById("app_service_catalog_chat_container")?.textContent || "";
            expect(containerText).toContain("Codex aloitti työn.");
            expect(containerText).toContain("00:00");
        });
        expect(sendButton.disabled).toBe(true);
        expect(document.querySelector(".chat-bubble-pending .chat-typing-dots")).not.toBeNull();

        resolveCodexQuery({
            dataset: "app_service_catalog",
            mode: "codex",
            dev_only: true,
            answer: "Valmis vastaus Codexilta.",
        });

        await vi.waitFor(() => {
            const containerText =
                document.getElementById("app_service_catalog_chat_container")?.textContent || "";
            expect(containerText).toContain("Valmis vastaus Codexilta.");
            expect(containerText).not.toContain("Codex aloitti työn.");
        });
        expect(sendButton.disabled).toBe(false);
        expect(document.querySelector(".chat-bubble-pending")).toBeNull();
    });

    test("does not rerender dataset content for Codex answer-only replies with an empty result shell", async () => {
        document.head.innerHTML = '<meta name="app-env" content="dev">';
        hasRoutePermissionMock.mockImplementation((route) =>
            [
                "/api/app/ai-chat/query",
                "/api/app/ai-chat/codex-query",
            ].includes(route)
        );
        endpointRouterMock.mockImplementation((routeName, options = {}) => {
            if (routeName === "aiChatConversation" && !options.method) {
                return Promise.resolve({
                    dataset: "app_service_catalog",
                    messages: [],
                    preview: "",
                    updated_at: null,
                });
            }
            if (routeName === "aiChatConversation" && options.method === "PUT") {
                return Promise.resolve({
                    dataset: "app_service_catalog",
                    messages: options.body_data.messages,
                    preview: options.body_data.preview,
                    updated_at: options.body_data.updated_at,
                });
            }
            if (routeName === "aiChatCodexQuery") {
                return Promise.resolve({
                    answer: "Voin tarkistaa tätä ilman uutta tuloshakua.",
                    plan: {
                        mode: "answer_only",
                        uses_sql: false,
                    },
                    result: {},
                });
            }
            return Promise.resolve({});
        });

        const { create_chat_ui } = await loadModule();
        const host = document.getElementById("chat-host");

        create_chat_ui("app_service_catalog", host);

        const modeSelect = document.getElementById("app_service_catalog_chat_mode");
        modeSelect.value = "codex_dev";
        modeSelect.dispatchEvent(new Event("change"));
        refreshTableUnifiedMock.mockClear();

        const input = document.getElementById("app_service_catalog_chat_input");
        const sendButton = document.getElementById("app_service_catalog_chat_sendBtn");
        input.value = "Mitä tämä tarkoittaa?";
        sendButton.click();

        await vi.waitFor(() => {
            const containerText =
                document.getElementById("app_service_catalog_chat_container")?.textContent || "";
            expect(containerText).toContain("Voin tarkistaa tätä ilman uutta tuloshakua.");
            expect(containerText).toContain(
                "No results were fetched this turn; the current result view was left unchanged."
            );
        });
        expect(generateTableMock).not.toHaveBeenCalled();
        expect(refreshTableUnifiedMock).not.toHaveBeenCalled();
    });

    test("api-tools sort plan rerenders cached search results when a search is active", async () => {
        endpointRouterMock.mockImplementation((routeName) => {
            if (routeName === "aiChatConversation") {
                return Promise.resolve({ updated_at: "2026-04-24T00:00:00Z", messages: [] });
            }
            if (routeName === "aiChatQuery") {
                return Promise.resolve({
                    answer: "Sorted results by id ASC.",
                    plan: {
                        mode: "rows_page",
                        canonical_path: "/api/get-results",
                        uses_sql: false,
                        sort_column: "id",
                        sort_order: "ASC",
                        apply_as_sort: true,
                    },
                    result: {
                        columns: ["id", "header"],
                        data: [{ id: 1, header: "Oldest" }],
                        types: { header: "text" },
                        row_count: 1,
                    },
                });
            }
            return Promise.resolve({});
        });

        queryParamsState = { search: "firefox" };
        hasCachedSearchResultsMock.mockReturnValue(true);

        const { create_chat_ui } = await loadModule();

        document.body.innerHTML = `<div id="host"></div>`;
        create_chat_ui("app_service_catalog", document.getElementById("host"));
        await Promise.resolve();
        refreshTableUnifiedMock.mockClear();
        sortCachedSearchResultsMock.mockClear();

        const input = document.getElementById("app_service_catalog_chat_input");
        const button = document.getElementById("app_service_catalog_chat_sendBtn");
        input.value = "show results from oldest";
        button.click();

        await vi.waitFor(() => {
            expect(
                document.getElementById("app_service_catalog_chat_container")?.textContent
            ).toContain("Sorted results by id ASC.");
        });
        expect(sortCachedSearchResultsMock).toHaveBeenCalledWith("app_service_catalog", {
            sortColumn: "id",
            sortOrder: "ASC",
        });
        expect(refreshTableUnifiedMock).not.toHaveBeenCalled();
        expect(updateURLMock).toHaveBeenCalledWith(
            "app_service_catalog",
            {
                search: "firefox",
                sort_column: "id",
                sort_order: "ASC",
            },
            undefined,
            { replace: true }
        );
    });

    test("api-tools field filter plan syncs dataset filters before rendering results", async () => {
        endpointRouterMock.mockImplementation((routeName, options = {}) => {
            if (routeName === "aiChatConversation" && !options.method) {
                return Promise.resolve({
                    dataset: "app_service_catalog",
                    messages: [],
                    preview: "",
                    updated_at: null,
                });
            }
            if (routeName === "aiChatConversation" && options.method === "PUT") {
                return Promise.resolve({
                    dataset: "app_service_catalog",
                    messages: options.body_data.messages,
                    preview: options.body_data.preview,
                    updated_at: options.body_data.updated_at,
                });
            }
            if (routeName === "aiChatQuery") {
                return Promise.resolve({
                    answer: "Löysin Serlog.com-palvelukatalogin serlog-käyttäjälle.",
                    plan: {
                        mode: "rows_page",
                        canonical_path: "/api/get-results",
                        uses_sql: false,
                        filters: { cached_username: "serlog" },
                    },
                    result: {
                        columns: ["id", "header", "cached_username"],
                        data: [
                            {
                                id: 99,
                                header: "Serlog.com -palvelukatalogi",
                                cached_username: "serlog",
                            },
                        ],
                        types: { header: "text", cached_username: "text" },
                        row_count: 1,
                    },
                });
            }
            return Promise.resolve({});
        });

        const { create_chat_ui } = await loadModule();
        const host = document.getElementById("chat-host");

        create_chat_ui("app_service_catalog", host);

        const input = document.getElementById("app_service_catalog_chat_input");
        const button = document.getElementById("app_service_catalog_chat_sendBtn");
        input.value = "cached_username:serlog";
        button.click();

        await vi.waitFor(() => {
            expect(
                document.getElementById("app_service_catalog_chat_container")?.textContent
            ).toContain("Serlog.com-palvelukatalogin");
        });

        expect(setUnifiedTableStateMock).toHaveBeenCalledWith(
            "app_service_catalog",
            {
                filters: { cached_username: "serlog" },
                sort: { column: null, direction: null },
                offset: 0,
            }
        );
        expect(setParamsMock).toHaveBeenCalledWith("app_service_catalog", {
            cached_username: "serlog",
        });
        expect(updateURLMock).toHaveBeenCalledWith(
            "app_service_catalog",
            {
                cached_username: "serlog",
            },
            undefined,
            { replace: true }
        );
        expect(generateTableMock).toHaveBeenCalledWith(
            "app_service_catalog",
            ["id", "header", "cached_username"],
            [
                {
                    id: 99,
                    header: "Serlog.com -palvelukatalogi",
                    cached_username: "serlog",
                },
            ],
            {
                id: { card_element: "details", data_type: "text", show_value_on_card: true },
                header: { card_element: "details", data_type: "text", show_value_on_card: true },
                cached_username: { card_element: "details", data_type: "text", show_value_on_card: true },
            },
            1,
            false,
            undefined
        );
    });

    test("shows an unavailable message when the api_tools facade route is not permitted", async () => {
        hasRoutePermissionMock.mockReturnValue(false);
        endpointRouterMock.mockImplementation((routeName, options = {}) => {
            if (routeName === "aiChatConversation" && !options.method) {
                return Promise.resolve({
                    dataset: "app_service_catalog",
                    messages: [],
                    preview: "",
                    updated_at: null,
                });
            }
            if (routeName === "aiChatConversation" && options.method === "PUT") {
                return Promise.resolve({
                    dataset: "app_service_catalog",
                    messages: options.body_data.messages,
                    preview: options.body_data.preview,
                    updated_at: options.body_data.updated_at,
                });
            }
            return Promise.resolve({});
        });

        const { create_chat_ui } = await loadModule();
        const host = document.getElementById("chat-host");

        create_chat_ui("app_service_catalog", host);

        const input = document.getElementById("app_service_catalog_chat_input");
        const sendButton = document.getElementById("app_service_catalog_chat_sendBtn");
        input.value = "legacy fallback";
        sendButton.click();

        await vi.waitFor(() => {
            expect(
                document.getElementById("app_service_catalog_chat_container")?.textContent
            ).toContain("AI chat is not available for this view.");
        });
        expect(generateTableMock).not.toHaveBeenCalled();
        expect(endpointRouterMock).not.toHaveBeenCalledWith(
            "aiChatQuery",
            expect.anything()
        );
    });
});
