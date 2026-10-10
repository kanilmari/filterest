// table_chat_printer.test.js
// Verifies composer and conversation UI through the real chat module.
// Connects shared transport and state fixtures to the browser UI.
// Preserves API-first behavior and request guards without a model or database.
// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from "vitest";
import { resetTableChatPrinterTest, endpointRouterMock, loadModule } from "./table_chat_printer_test_setup.js";

describe("create_chat_ui", () => {
    beforeEach(resetTableChatPrinterTest);

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
        // The attach control sits between clearing the history and sending,
        // because it belongs to the question being written.
        ).toEqual(["Poista historia", "Attach an image", "Send message"]);
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


});
