// table_chat_result_rendering.test.js
// Verifies dataset result rendering through the real chat module.
// Connects shared transport and state fixtures to the browser UI.
// Preserves API-first behavior and request guards without a model or database.
// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from "vitest";
import { resetTableChatPrinterTest, endpointRouterMock, generateTableMock, disconnectInfiniteScrollMock, resetOffsetMock, updateOffsetMock, refreshTableUnifiedMock, loadModule } from "./table_chat_printer_test_setup.js";

describe("create_chat_ui", () => {
    beforeEach(resetTableChatPrinterTest);

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
            undefined,
            undefined,
            undefined,
            { datasetAppearance: undefined, appearanceToken: expect.objectContaining({ name: "app_service_catalog" }), isCurrent: expect.any(Function) }
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


});
