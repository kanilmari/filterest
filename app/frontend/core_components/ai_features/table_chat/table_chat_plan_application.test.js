// table_chat_plan_application.test.js
// Verifies query plan application and runner recovery through the real chat module.
// Connects shared transport and state fixtures to the browser UI.
// Preserves API-first behavior and request guards without a model or database.
// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from "vitest";
import { resetTableChatPrinterTest, endpointRouterMock, generateTableMock, hasCachedSearchResultsMock, refreshTableUnifiedMock, sortCachedSearchResultsMock, setUnifiedTableStateMock, setParamsMock, updateURLMock, emitDatasetSortSelectionMock, hasRoutePermissionMock, loadModule, setChatQueryParamsState } from "./table_chat_printer_test_setup.js";

describe("create_chat_ui", () => {
    beforeEach(resetTableChatPrinterTest);

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

    // Answers the chat's own routes and one coding-agent job, the way the server does.
    function mockCodingAgentRoutes({ modes, post = null, job }) {
        hasRoutePermissionMock.mockImplementation((route) => route === "/api/app/ai-chat/query");
        endpointRouterMock.mockImplementation((routeName, options = {}) => {
            if (routeName === "aiChatConversation" && !options.method) {
                return Promise.resolve({ dataset: "app_service_catalog", messages: [], preview: "", updated_at: null });
            }
            if (routeName === "aiChatConversation" && options.method === "PUT") {
                return Promise.resolve({ dataset: "app_service_catalog", ...options.body_data });
            }
            if (routeName === "aiChatCodexQuery" && options.method === "GET") {
                return String(options.url_params).includes("job_id=")
                    ? Promise.resolve({ job_id: "00000000-0000-0000-0000-000000000077", ...job })
                    : Promise.resolve({ feature_enabled: true, runner_ready: true, modes });
            }
            if (routeName === "aiChatCodexQuery" && options.method === "POST") {
                return post || Promise.resolve({ job_id: "00000000-0000-0000-0000-000000000077", status: "queued" });
            }
            return Promise.resolve({});
        });
    }

    async function chooseModeAndSend(mode, question) {
        const { create_chat_ui } = await loadModule();
        create_chat_ui("app_service_catalog", document.getElementById("chat-host"));
        const modeSelect = document.getElementById("app_service_catalog_chat_mode");
        await vi.waitFor(() => {
            expect(modeSelect.querySelector(`[value="${mode}"]`)?.disabled).toBe(false);
        });
        modeSelect.value = mode;
        modeSelect.dispatchEvent(new Event("change"));
        refreshTableUnifiedMock.mockClear();
        const input = document.getElementById("app_service_catalog_chat_input");
        const sendButton = document.getElementById("app_service_catalog_chat_sendBtn");
        input.value = question;
        sendButton.click();
        return sendButton;
    }

    const chatText = () => document.getElementById("app_service_catalog_chat_container")?.textContent || "";

    test("routes a code workspace question to the runner and applies the application's filter plan", async () => {
        document.head.innerHTML = '<meta name="app-env" content="dev">';
        mockCodingAgentRoutes({
            modes: [{ mode: "code_workspace", ready: true }, { mode: "site_assistant", ready: true }],
            job: {
                status: "completed", mode: "code_workspace",
                answer: "Codex: tarkista user_id-haku backendin capability-polusta.",
                plan: { mode: "rows_page", canonical_path: "/api/get-results", uses_sql: false, filters: { cached_username: "serlog" } },
            },
        });

        await chooseModeAndSend("code_workspace", "Miksi user_id-haku ei löydä serlog-palvelua?");

        await vi.waitFor(() => {
            expect(endpointRouterMock).toHaveBeenCalledWith("aiChatCodexQuery", {
                method: "POST",
                body_data: {
                    request_id: expect.any(String),
                    dataset: "app_service_catalog",
                    query: "Miksi user_id-haku ei löydä serlog-palvelua?",
                    mode: "code_workspace",
                    lang: "en",
                    messages: [expect.objectContaining({ role: "user", content: "Miksi user_id-haku ei löydä serlog-palvelua?" })],
                },
            });
        });
        await vi.waitFor(() => expect(chatText()).toContain("Codex: tarkista user_id-haku"));
        expect(chatText()).toContain("Answered by: Code workspace (Codex)");
        expect(setParamsMock).toHaveBeenCalledWith("app_service_catalog", { cached_username: "serlog" });
        expect(refreshTableUnifiedMock).toHaveBeenCalled();
        await vi.waitFor(() => {
            expect(endpointRouterMock).toHaveBeenCalledWith("aiChatConversation", expect.objectContaining({
                method: "PUT",
                body_data: expect.objectContaining({
                    messages: expect.arrayContaining([expect.objectContaining({ role: "assistant", mode: "code_workspace" })]),
                }),
            }));
        });
        expect(endpointRouterMock).not.toHaveBeenCalledWith("aiChatQuery", expect.anything());
    });

    test.each([
        { theme: "light", environment: "dev", mode: "code_workspace", label: "Code workspace (Codex)",
          startedText: "Code workspace started working.", otherAgentText: "Site assistant started working." },
        { theme: "dark", environment: "prod", mode: "site_assistant", label: "Site assistant (Codex)",
          startedText: "Site assistant started working.", otherAgentText: "Code workspace started working." },
    ])("shows the $mode waiting text and answer footer in the $theme theme", async ({
        theme, environment, mode, label, startedText, otherAgentText,
    }) => {
        document.head.innerHTML = `<meta name="app-env" content="${environment}">`;
        document.documentElement.dataset.theme = theme;
        let acceptJob;
        mockCodingAgentRoutes({
            modes: [{ mode, ready: true }],
            post: new Promise((resolve) => { acceptJob = resolve; }),
            job: { status: "completed", mode, answer: "Valmis vastaus Codexilta." },
        });

        const sendButton = await chooseModeAndSend(mode, "Tutki miksi localhost ei aukea Codexista");

        await vi.waitFor(() => {
            expect(chatText()).toContain(startedText);
            expect(chatText()).not.toContain(otherAgentText);
            expect(chatText()).toContain("00:00");
        });
        expect(document.querySelector(".chat-bubble-pending .chat-pending-mode")?.textContent).toBe(label);
        expect(sendButton.disabled).toBe(true);
        expect(document.querySelector(".chat-bubble-pending .chat-typing-dots")).not.toBeNull();
        expect(JSON.parse(localStorage.getItem("codingAgentJob_app_service_catalog")).mode).toBe(mode);

        acceptJob({ job_id: "00000000-0000-0000-0000-000000000077", status: "queued", mode });

        await vi.waitFor(() => {
            expect(chatText()).toContain("Valmis vastaus Codexilta.");
            expect(chatText()).not.toContain(startedText);
        });
        expect(document.querySelector(".chat-mode-footer")?.textContent).toBe(`Answered by: ${label}`);
        expect(sendButton.disabled).toBe(false);
        expect(document.querySelector(".chat-bubble-pending")).toBeNull();
    });

    test("a job resumed after a reload keeps its named waiting bubble while the history loads", async () => {
        document.documentElement.lang = "en";
        localStorage.setItem("codingAgentJob_app_service_catalog", JSON.stringify({
            job_id: "00000000-0000-0000-0000-000000000077", mode: "site_assistant" }));
        let finishJob;
        mockCodingAgentRoutes({ modes: [{ mode: "site_assistant", ready: true }], job: { status: "running" } });
        const route = endpointRouterMock.getMockImplementation();
        endpointRouterMock.mockImplementation((routeName, options = {}) => {
            if (routeName === "aiChatConversation" && !options.method) {
                return Promise.resolve({ dataset: "app_service_catalog", preview: "", updated_at: "2026-09-22T10:00:00Z",
                    messages: [{ role: "user", content: "Earlier question", created_at: "2026-09-22T10:00:00Z" }] });
            }
            if (routeName === "aiChatCodexQuery" && String(options.url_params).includes("job_id=")) {
                return new Promise((resolve) => { finishJob = resolve; });
            }
            return route(routeName, options);
        });
        const { create_chat_ui } = await loadModule();
        // The filterbar builds the chat before attaching it to the page.
        const detached = document.createElement("div");
        create_chat_ui("app_service_catalog", detached);
        document.getElementById("chat-host").append(detached);

        await vi.waitFor(() => expect(chatText()).toContain("Earlier question"));
        expect(document.querySelector(".chat-bubble-pending .chat-pending-mode")?.textContent).toBe("Site assistant (Codex)");
        finishJob({ job_id: "00000000-0000-0000-0000-000000000077", status: "completed", mode: "site_assistant", answer: "Two rows." });
        await vi.waitFor(() => expect(document.querySelector(".chat-mode-footer")?.textContent).toBe("Answered by: Site assistant (Codex)"));
        expect(endpointRouterMock).not.toHaveBeenCalledWith("aiChatCodexQuery", expect.objectContaining({ method: "POST" }));
    });

    test("does not rerender dataset content for coding-agent answer-only replies", async () => {
        document.head.innerHTML = '<meta name="app-env" content="dev">';
        mockCodingAgentRoutes({
            modes: [{ mode: "code_workspace", ready: true }],
            job: { status: "completed", mode: "code_workspace", answer: "Voin tarkistaa tätä ilman uutta tuloshakua." },
        });

        await chooseModeAndSend("code_workspace", "Mitä tämä tarkoittaa?");

        await vi.waitFor(() => {
            expect(chatText()).toContain("Voin tarkistaa tätä ilman uutta tuloshakua.");
            expect(chatText()).toContain("No results were fetched this turn; the current result view was left unchanged.");
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

        setChatQueryParamsState({ search: "firefox" });
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
            undefined,
            undefined,
            undefined,
            { datasetAppearance: undefined, appearanceToken: expect.objectContaining({ name: "app_service_catalog" }), isCurrent: expect.any(Function) }
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
