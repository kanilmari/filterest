// table_chat_printer.js
// Renders the filterbar AI chat UI for dataset browsing.
// Bridges chat interactions, backend AI read routes, and dataset table rendering.
// Exists to keep the filterbar chat pinned to the API-first ai-chat facade.

import { createCodingAgentControl } from './table_chat_coding_agent_control.js';
import { renderPendingChanges } from './table_chat_pending_changes.js';
import { createChatAttachments } from './table_chat_attachments.js';
import { refreshTableUnified } from '../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js';
import { endpoint_router } from '../../endpoints/endpoint_router.js';
import { getTranslationForKey } from '../../lang/translation_handler.js';
import {
    isFilterbarAIChatDevEnvironment,
    resolveAvailableFilterbarAIChatMode,
} from './table_chat_mode_resolver.js';
import {
    runApiToolsChatQuery,
    runCodexDevChatQuery,
    hasPendingCodingAgentJob,
    cancelCodingAgentPolling,
} from './table_chat_query_runner.js';
import {
    isOpenAIKeyConfigurationRequired,
    renderOpenAIKeySetupPrompt,
} from './openai_key_setup_printer.js';

// Mapit keskustelun hallintaan
let conversation_map = new Map();
let user_message_history_map = new Map();
let user_history_index_map = new Map();
let user_history_draft_map = new Map();
let conversation_updated_at_map = new Map();
let conversation_load_token_map = new Map();
const LOCAL_CHAT_STORAGE_PREFIX = 'gptChatConversation_';
const codingAgentControls = new Map();
const MAX_CHAT_PREVIEW_LENGTH = 160;
const RESULT_CONTEXT_MESSAGE_PREFIX = '[easelect_result_context]';
const CHAT_PENDING_HEARTBEAT_MS = 10000;

async function start_api_tools_query(table_name, user_message, pending_message = null) {
    const chatResponse = await runApiToolsChatQuery(
        table_name,
        user_message,
        conversation_map.get(table_name) || []
    );
    const assistantReply = String(chatResponse?.answer || 'Request completed.').trim();
    const visibleAssistantReply = append_no_result_fetch_notice(
        assistantReply,
        chatResponse?.resultActionTaken
    );
    const assistantCreatedAt = buildChatCreatedAt();
    add_to_conversation(table_name, {
        role: 'assistant',
        content: visibleAssistantReply,
        created_at: assistantCreatedAt,
        usage: chatResponse?.usage || null,
    });
    if (chatResponse?.memory) {
        replace_result_context_in_conversation(table_name, chatResponse.memory);
    }
    finish_pending_chat_message(table_name, pending_message, 'assistant', visibleAssistantReply, {
        created_at: assistantCreatedAt,
        usage: chatResponse?.usage || null,
    });
}

async function start_codex_dev_query(table_name, user_message, pending_message = null, imageTokens = []) {
    const chatResponse = await runCodexDevChatQuery(
        table_name,
        user_message,
        conversation_map.get(table_name) || [],
        {
            externalRunner: codingAgentControls.get(table_name)?.capability?.runner_kind === 'external',
            imageTokens,
        }
    );
    const assistantReply = String(chatResponse?.answer || 'Codex completed without a visible answer.').trim();
    const visibleAssistantReply = append_no_result_fetch_notice(
        assistantReply,
        chatResponse?.resultActionTaken
    );
    const assistantCreatedAt = buildChatCreatedAt();
    add_to_conversation(table_name, {
        role: 'assistant',
        content: visibleAssistantReply,
        created_at: assistantCreatedAt,
        usage: chatResponse?.usage || null,
    });
    if (chatResponse?.memory) {
        replace_result_context_in_conversation(table_name, chatResponse.memory);
    }
    const message_div = finish_pending_chat_message(table_name, pending_message, 'assistant', visibleAssistantReply, {
        created_at: assistantCreatedAt,
        usage: chatResponse?.usage || null,
    });
    show_pending_changes(table_name, message_div, chatResponse);
}

/** A job that prepared changes shows them for the administrator's approval. */
function show_pending_changes(table_name, message_div, chatResponse) {
    if (!message_div || !Array.isArray(chatResponse?.pendingChanges) || chatResponse.pendingChanges.length === 0) {
        return;
    }
    renderPendingChanges(message_div, {
        dataset: table_name,
        jobId: chatResponse.jobId,
        changes: chatResponse.pendingChanges,
        onApproved: async () => {
            // Approved changes alter the dataset, so the open view is reloaded.
            await refreshTableUnified(table_name, { skipUrlParams: true });
        },
    });
}

/**
 * destroy_chat remains as a compatibility cleanup hook for navigation callers.
 * The filterbar chat no longer holds a legacy EventSource transport to close.
 */
export function destroy_chat(table_name) {
    codingAgentControls.get(table_name)?.destroy();
    codingAgentControls.delete(table_name);
    cancelCodingAgentPolling(table_name);
}

function getConversationStorageKey(table_name) {
    return `${LOCAL_CHAT_STORAGE_PREFIX}${table_name}`;
}

function parseConversationTimestamp(updated_at) {
    const timestamp = Date.parse(updated_at || '');
    return Number.isFinite(timestamp) ? timestamp : null;
}

function buildChatCreatedAt() {
    return new Date().toISOString();
}

function normalizeChatCreatedAt(created_at) {
    const timestamp = parseConversationTimestamp(created_at);
    return timestamp === null ? '' : new Date(timestamp).toISOString();
}

function readChatUsageNumber(source, keys) {
    for (const key of keys) {
        if (!Object.prototype.hasOwnProperty.call(source, key)) {
            continue;
        }
        const value = Number(source[key]);
        if (Number.isFinite(value)) {
            return Math.max(0, value);
        }
    }
    return 0;
}

function normalizeChatUsageCall(rawCall) {
    if (!rawCall || typeof rawCall !== 'object' || Array.isArray(rawCall)) {
        return null;
    }

    const normalized = {
        label: String(rawCall.label || '').trim(),
        provider: String(rawCall.provider || '').trim(),
        model: String(rawCall.model || '').trim(),
        effort: String(rawCall.effort || '').trim(),
        input_tokens: readChatUsageNumber(rawCall, ['input_tokens', 'inputTokens']),
        cached_input_tokens: readChatUsageNumber(rawCall, ['cached_input_tokens', 'cachedInputTokens']),
        output_tokens: readChatUsageNumber(rawCall, ['output_tokens', 'outputTokens']),
        reasoning_tokens: readChatUsageNumber(rawCall, ['reasoning_tokens', 'reasoningTokens']),
        total_tokens: readChatUsageNumber(rawCall, ['total_tokens', 'totalTokens']),
        cost_usd: readChatUsageNumber(rawCall, ['cost_usd', 'costUSD']),
        estimated: rawCall.estimated === true,
        pricing_note: String(rawCall.pricing_note || rawCall.pricingNote || '').trim(),
    };

    if (
        !normalized.provider &&
        !normalized.model &&
        normalized.total_tokens === 0 &&
        !normalized.pricing_note
    ) {
        return null;
    }
    return normalized;
}

function normalizeChatUsage(rawUsage) {
    const usage = normalizeChatUsageCall(rawUsage);
    if (!usage) {
        return null;
    }

    const calls = Array.isArray(rawUsage.calls)
        ? rawUsage.calls.map((call) => normalizeChatUsageCall(call)).filter(Boolean)
        : [];
    if (calls.length > 0) {
        usage.calls = calls;
    }
    return usage;
}

function normalizeConversationMessage(message) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
        return null;
    }

    const role = String(message.role || '').trim();
    const content = String(message.content || '');
    if (!role || !content) {
        return null;
    }

    const normalizedMessage = { role, content };
    const created_at = normalizeChatCreatedAt(message.created_at);
    if (created_at) {
        normalizedMessage.created_at = created_at;
    }
    const usage = normalizeChatUsage(message.usage);
    if (usage) {
        normalizedMessage.usage = usage;
    }
    return normalizedMessage;
}

function normalizeConversationMessages(messages) {
    if (!Array.isArray(messages)) {
        return [];
    }

    return messages
        .map((message) => normalizeConversationMessage(message))
        .filter(Boolean);
}

function buildPersistableConversationMessages(messages) {
    return normalizeConversationMessages(messages).filter((message) => {
        return !(message.role === 'assistant' && message.content.trim().startsWith('SQL:'));
    });
}

function buildConversationPreview(messages) {
    const latestMessage = [...messages]
        .reverse()
        .find((message) =>
            message?.role !== 'system' &&
            typeof message?.content === 'string' &&
            message.content.trim()
        );

    if (!latestMessage) {
        return '';
    }

    const compactContent = latestMessage.content.replace(/\s+/g, ' ').trim();
    if (compactContent.length <= MAX_CHAT_PREVIEW_LENGTH) {
        return compactContent;
    }

    return `${compactContent.slice(0, MAX_CHAT_PREVIEW_LENGTH - 3).trimEnd()}...`;
}

function writeConversationSnapshotToLocalStorage(table_name, {
    messages,
    updated_at = '',
    needs_sync = false,
}) {
    try {
        localStorage.setItem(
            getConversationStorageKey(table_name),
            JSON.stringify({
                messages: buildPersistableConversationMessages(messages),
                updated_at,
                needs_sync,
            })
        );
    } catch (e) {
        console.warn('virhe tallennettaessa localStorageen:', e);
    }
}

function readConversationSnapshotFromLocalStorage(table_name) {
    try {
        const stored_snapshot = localStorage.getItem(getConversationStorageKey(table_name));
        if (!stored_snapshot) {
            return null;
        }

        const parsed_snapshot = JSON.parse(stored_snapshot);
        if (Array.isArray(parsed_snapshot)) {
            return {
                messages: normalizeConversationMessages(parsed_snapshot),
                updated_at: '',
                needs_sync: false,
            };
        }

        if (!parsed_snapshot || typeof parsed_snapshot !== 'object') {
            return null;
        }

        return {
            messages: normalizeConversationMessages(parsed_snapshot.messages),
            updated_at: typeof parsed_snapshot.updated_at === 'string' ? parsed_snapshot.updated_at : '',
            needs_sync: parsed_snapshot.needs_sync === true,
        };
    } catch (e) {
        console.warn('virhe ladattaessa localStoragesta:', e);
        return null;
    }
}

function rebuildUserHistoryFromConversation(table_name, messages) {
    const userHistory = messages
        .filter((message) => message.role === 'user')
        .map((message) => message.content);

    user_message_history_map.set(table_name, userHistory);
    user_history_index_map.set(table_name, userHistory.length);
}

function setConversationState(table_name, messages, {
    updated_at = '',
    needs_sync = false,
    persist_local = true,
} = {}) {
    const normalizedMessages = normalizeConversationMessages(messages);
    conversation_map.set(table_name, normalizedMessages);
    rebuildUserHistoryFromConversation(table_name, normalizedMessages);

    if (updated_at) {
        conversation_updated_at_map.set(table_name, updated_at);
    }

    if (persist_local) {
        writeConversationSnapshotToLocalStorage(table_name, {
            messages: normalizedMessages,
            updated_at,
            needs_sync,
        });
    }
}

function renderWelcomeMessage(table_name) {
    append_chat_message(table_name, 'assistant', 'Hei! Millaisia tuloksia haluaisit nähdä?', '');
    const chat_container = document.getElementById(`${table_name}_chat_container`);
    if (!chat_container) {
        return;
    }

    const last_bubble = chat_container.lastElementChild;
    if (last_bubble) {
        last_bubble.dataset.langKey = 'chat_welcome_message';
    }
}

function renderConversation(table_name) {
    const chat_container = document.getElementById(`${table_name}_chat_container`);
    if (!chat_container) {
        return;
    }

    chat_container.replaceChildren();
    const messages = conversation_map.get(table_name) || [];

    if (messages.length === 0) {
        renderWelcomeMessage(table_name);
        return;
    }

    messages.forEach((message) => {
        if (message.role === 'system') {
            return;
        }
        append_chat_message(table_name, message.role, message.content, '', {
            created_at: message.created_at,
            usage: message.usage,
        });
    });
}

function nextConversationUpdatedAt(table_name) {
    const previousUpdatedAt = parseConversationTimestamp(conversation_updated_at_map.get(table_name));
    let nextTimestamp = Date.now();

    if (previousUpdatedAt !== null && previousUpdatedAt >= nextTimestamp) {
        nextTimestamp = previousUpdatedAt + 1;
    }

    const nextUpdatedAt = new Date(nextTimestamp).toISOString();
    conversation_updated_at_map.set(table_name, nextUpdatedAt);
    return nextUpdatedAt;
}

async function persistConversationToBackend(table_name, updated_at) {
    const persistableMessages = buildPersistableConversationMessages(conversation_map.get(table_name) || []);

    writeConversationSnapshotToLocalStorage(table_name, {
        messages: persistableMessages,
        updated_at,
        needs_sync: true,
    });

    try {
        await endpoint_router('aiChatConversation', {
            method: 'PUT',
            body_data: {
                dataset: table_name,
                messages: persistableMessages,
                preview: buildConversationPreview(persistableMessages),
                updated_at,
            },
        });

        if (conversation_updated_at_map.get(table_name) === updated_at) {
            writeConversationSnapshotToLocalStorage(table_name, {
                messages: persistableMessages,
                updated_at,
                needs_sync: false,
            });
        }
    } catch (error) {
        console.warn('AI chat conversation save failed:', error);
    }
}

function save_conversation_to_local_storage(table_name) {
    const updated_at = nextConversationUpdatedAt(table_name);
    void persistConversationToBackend(table_name, updated_at);
}

async function hydrateConversationFromBackend(table_name, localSnapshot) {
    const loadToken = Symbol(table_name);
    const initialUpdatedAt = conversation_updated_at_map.get(table_name) || '';
    conversation_load_token_map.set(table_name, loadToken);

    try {
        const response = await endpoint_router('aiChatConversation', {
            url_params: `?dataset=${encodeURIComponent(table_name)}`,
        });

        if (conversation_load_token_map.get(table_name) !== loadToken) {
            return;
        }

        if ((conversation_updated_at_map.get(table_name) || '') !== initialUpdatedAt) {
            return;
        }

        const remoteSnapshot = {
            messages: normalizeConversationMessages(response?.messages),
            updated_at: typeof response?.updated_at === 'string' ? response.updated_at : '',
        };

        const localTimestamp = parseConversationTimestamp(localSnapshot?.updated_at);
        const remoteTimestamp = parseConversationTimestamp(remoteSnapshot.updated_at);
        const shouldPreferLocal = Boolean(localSnapshot) && (
            localSnapshot.needs_sync === true ||
            (localTimestamp !== null && remoteTimestamp !== null && localTimestamp > remoteTimestamp) ||
            (localTimestamp !== null && remoteTimestamp === null)
        );

        if (shouldPreferLocal) {
            if (localSnapshot?.needs_sync && localSnapshot.updated_at) {
                conversation_updated_at_map.set(table_name, localSnapshot.updated_at);
                void persistConversationToBackend(table_name, localSnapshot.updated_at);
            }
            return;
        }

        setConversationState(table_name, remoteSnapshot.messages, {
            updated_at: remoteSnapshot.updated_at,
            needs_sync: false,
            persist_local: true,
        });
        renderConversation(table_name);
    } catch (error) {
        console.warn('AI chat conversation load failed:', error);
    }
}

// create_chat_ui builds the filterbar AI chat composer and message stream.
// It connects a dataset filterbar surface to the API-first chat query facade.
// The function exists so every dataset gets one reusable chat UI instance.
export function create_chat_ui(table_name, parent_element) {
    if (!parent_element) {
        console.warn(`error: parent_element puuttuu create_chat_ui-funktiolle (table: ${table_name})`);
        return;
    }
    if (document.getElementById(`${table_name}_chat_wrapper`)) {
        return;
    }

    const chat_ui_wrapper = document.createElement('div');
    chat_ui_wrapper.id = `${table_name}_chat_wrapper`;
    chat_ui_wrapper.classList.add('chat_wrapper');

    const chat_container_full = document.createElement('div');
    chat_container_full.classList.add('chat_inner');

    // const chat_title = document.createElement('h3');
    // chat_title.textContent = `Chat (taulu: ${table_name})`;
    // chat_container_full.appendChild(chat_title);

    const chat_container = document.createElement('div');
    chat_container.id = `${table_name}_chat_container`;
    chat_container.classList.add('chat_container');
    chat_container_full.appendChild(chat_container);
    chat_ui_wrapper.addEventListener('wheel', (event) => {
        if (event.target instanceof Node && chat_container.contains(event.target)) {
            return;
        }
        if (chat_container.scrollHeight <= chat_container.clientHeight) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        chat_container.scrollBy({
            top: event.deltaY,
            left: event.deltaX,
        });
    }, { passive: false });

    const chat_input = document.createElement('textarea');
    chat_input.id = `${table_name}_chat_input`;
    chat_input.classList.add('chat_textarea');
    chat_input.rows = 3;
    chat_input.placeholder = getTranslationForKey('write_question') || 'Kirjoita kysymys...';

    chat_input.addEventListener('input', () => {
        const user_history = user_message_history_map.get(table_name) || [];
        const user_history_index = getUserHistoryIndex(table_name, user_history);
        if (user_history_index === user_history.length) {
            user_history_draft_map.set(table_name, chat_input.value);
        }
    });

    chat_input.addEventListener('keydown', (event) => {
        if (handleChatInputHistoryArrowKeydown(event, table_name, chat_input)) {
            return;
        }
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            const send_btn = document.getElementById(`${table_name}_chat_sendBtn`);
            if (send_btn) send_btn.click();
        }
    });

    codingAgentControls.get(table_name)?.destroy();
    const chat_mode_select = createCodingAgentControl(table_name);
    if (chat_mode_select) codingAgentControls.set(table_name, chat_mode_select);

    // Images are for the site assistant, so the control appears only where that
    // assistant is offered at all.
    const chat_attachments = chat_mode_select ? createChatAttachments(table_name) : null;

    const chat_send_btn = document.createElement('button');
    chat_send_btn.id = `${table_name}_chat_sendBtn`;
    chat_send_btn.classList.add('chat_send_button');
    chat_send_btn.textContent = getTranslationForKey('send_message') || getDefaultSendMessageLabel();

    const clear_history_btn = document.createElement('button');
    clear_history_btn.classList.add('chat_clear_history_button');
    clear_history_btn.dataset.langKey = 'delete_history';
    clear_history_btn.textContent = getTranslationForKey('delete_history') || 'Poista historia';
    clear_history_btn.addEventListener('click', () => {
        const updated_at = nextConversationUpdatedAt(table_name);
        setConversationState(table_name, [], {
            updated_at,
            needs_sync: true,
            persist_local: true,
        });
        renderConversation(table_name);
        void persistConversationToBackend(table_name, updated_at);
    });

    const chat_input_row = document.createElement('div');
    chat_input_row.classList.add('chat_input_row');
    chat_input_row.appendChild(chat_input);

    const chat_action_row = document.createElement('div');
    chat_action_row.classList.add('chat_action_row');
    chat_action_row.appendChild(clear_history_btn);
    if (chat_attachments) {
        chat_input_row.appendChild(chat_attachments.row);
        chat_input_row.appendChild(chat_attachments.input);
        chat_action_row.appendChild(chat_attachments.button);
    }
    chat_action_row.appendChild(chat_send_btn);
    chat_input_row.appendChild(chat_action_row);

    if (chat_mode_select) {
        chat_input_row.prepend(chat_mode_select.row);
    }

    chat_container_full.appendChild(chat_input_row);
    chat_ui_wrapper.appendChild(chat_container_full);
    parent_element.appendChild(chat_ui_wrapper);
    if (hasPendingCodingAgentJob(table_name)) {
        const pending = append_pending_chat_message(table_name, 'codex_dev');
        setChatComposerBusy(chat_input, chat_send_btn, clear_history_btn, true);
        void start_codex_dev_query(table_name, '', pending).catch(error => {
            finish_pending_chat_message(table_name, pending, 'error', String(error.message));
        }).finally(() => setChatComposerBusy(chat_input, chat_send_btn, clear_history_btn, false));
    }

    // The send action is now API-first only: filterbar chat no longer keeps a
    // frontend EventSource rollback path to the legacy SSE SQL endpoint.
    chat_send_btn.addEventListener('click', async () => {
        const user_message = chat_input.value.trim();
        if (!user_message) return;
        const userMessageCreatedAt = buildChatCreatedAt();
        append_chat_message(table_name, 'user', user_message, '', {
            created_at: userMessageCreatedAt,
        });
        add_to_conversation(table_name, {
            role: 'user',
            content: user_message,
            created_at: userMessageCreatedAt,
        });
        add_to_user_history(table_name, user_message);
        user_history_draft_map.delete(table_name);
        chat_input.value = '';

        const configuredChatMode = chat_mode_select?.select?.value || 'api_tools';
        const chatMode = resolveAvailableFilterbarAIChatMode({
            configuredMode: configuredChatMode,
            codingAgentCapability: chat_mode_select?.capability,
        });
        const pending_message = append_pending_chat_message(table_name, chatMode || configuredChatMode);
        setChatComposerBusy(chat_input, chat_send_btn, clear_history_btn, true);

        if (chatMode !== 'api_tools') {
            if (chatMode === 'codex_dev') {
                const attached_tokens = chat_attachments ? chat_attachments.tokens() : [];
                try {
                    // The tokens leave the composer with their question, so the
                    // next question does not silently reuse the same images.
                    chat_attachments?.clear();
                    await start_codex_dev_query(table_name, user_message, pending_message, attached_tokens);
                } catch (error) {
                    console.warn('Codex chat query error:', error);
                    finish_pending_chat_message(
                        table_name,
                        pending_message,
                        'error',
                        String(error?.message || 'Unable to complete the Codex query right now.')
                    );
                } finally {
                    setChatComposerBusy(chat_input, chat_send_btn, clear_history_btn, false);
                }
                return;
            }
            finish_pending_chat_message(
                table_name,
                pending_message,
                'error',
                'AI chat is not available for this view.'
            );
            setChatComposerBusy(chat_input, chat_send_btn, clear_history_btn, false);
            return;
        }

        try {
            await start_api_tools_query(table_name, user_message, pending_message);
        } catch (error) {
            if (isOpenAIKeyConfigurationRequired(error)) {
                finish_pending_chat_message(table_name, pending_message, 'assistant', '');
                renderOpenAIKeySetupPrompt(pending_message?.element, {
                    onSaved: async () => {
                        const retryPendingMessage = append_pending_chat_message(table_name, 'api_tools');
                        setChatComposerBusy(chat_input, chat_send_btn, clear_history_btn, true);
                        try {
                            await start_api_tools_query(table_name, user_message, retryPendingMessage);
                        } catch (retryError) {
                            console.warn('AI chat retry error:', retryError);
                            finish_pending_chat_message(
                                table_name,
                                retryPendingMessage,
                                'error',
                                String(retryError?.message || 'Unable to complete the AI query right now.')
                            );
                        } finally {
                            setChatComposerBusy(chat_input, chat_send_btn, clear_history_btn, false);
                        }
                    },
                });
                return;
            }
            console.warn('AI chat query error:', error);
            finish_pending_chat_message(
                table_name,
                pending_message,
                'error',
                String(error?.message || 'Unable to complete the AI query right now.')
            );
        } finally {
            setChatComposerBusy(chat_input, chat_send_btn, clear_history_btn, false);
        }
    });

    load_conversation_from_local_storage(table_name);
}

// isTextareaCursorAtBoundary checks whether history navigation should take over.
// It sits between multiline textarea cursor movement and chat message history.
// This keeps normal arrow navigation intact while preserving the old history UX.
function isTextareaCursorAtBoundary(textarea, direction) {
    const selectionStart = Number.isInteger(textarea.selectionStart) ? textarea.selectionStart : 0;
    const selectionEnd = Number.isInteger(textarea.selectionEnd) ? textarea.selectionEnd : selectionStart;
    if (selectionStart !== selectionEnd) {
        return false;
    }

    if (direction === 'up') {
        return !textarea.value.slice(0, selectionStart).includes('\n');
    }

    return !textarea.value.slice(selectionEnd).includes('\n');
}

function getUserHistoryIndex(table_name, user_history) {
    const storedIndex = user_history_index_map.get(table_name);
    return Number.isInteger(storedIndex) ? storedIndex : user_history.length;
}

function restoreChatInputHistoryValue(textarea, value) {
    textarea.value = value;
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
}

// handleChatInputHistoryArrowKeydown handles intentional message-history browsing.
// It sits between the keydown event, the textarea draft, and per-dataset history.
// The current draft is restored when ArrowDown returns past the newest history item.
function handleChatInputHistoryArrowKeydown(event, table_name, chat_input) {
    const isHistoryUp = event.key === 'ArrowUp';
    const isHistoryDown = event.key === 'ArrowDown';
    if (!isHistoryUp && !isHistoryDown) {
        return false;
    }

    const direction = isHistoryUp ? 'up' : 'down';
    if (!isTextareaCursorAtBoundary(chat_input, direction)) {
        return false;
    }

    const user_history = user_message_history_map.get(table_name) || [];
    if (user_history.length === 0) {
        return false;
    }

    const user_history_index = getUserHistoryIndex(table_name, user_history);
    if (isHistoryUp) {
        event.preventDefault();
        if (user_history_index === user_history.length) {
            user_history_draft_map.set(table_name, chat_input.value);
        }
        const nextIndex = Math.max(0, user_history_index - 1);
        restoreChatInputHistoryValue(chat_input, user_history[nextIndex] || '');
        user_history_index_map.set(table_name, nextIndex);
        return true;
    }

    if (user_history_index >= user_history.length) {
        return false;
    }

    event.preventDefault();
    const nextIndex = Math.min(user_history.length, user_history_index + 1);
    if (nextIndex === user_history.length) {
        const draft = user_history_draft_map.get(table_name) || '';
        restoreChatInputHistoryValue(chat_input, draft);
        user_history_draft_map.delete(table_name);
    } else {
        restoreChatInputHistoryValue(chat_input, user_history[nextIndex] || '');
    }
    user_history_index_map.set(table_name, nextIndex);
    return true;
}

function getDefaultSendMessageLabel() {
    const lang = String(document.documentElement.lang || '').toLowerCase();
    return lang.startsWith('en') ? 'Send message' : 'Lähetä viesti';
}

function get_no_result_fetch_notice() {
    const lang = String(document.documentElement.lang || '').toLowerCase();
    return lang.startsWith('en')
        ? 'No results were fetched this turn; the current result view was left unchanged.'
        : 'Tuloksia ei haettu tällä kierroksella; nykyinen näkymä jätettiin ennalleen.';
}

function append_no_result_fetch_notice(assistantReply, resultActionTaken) {
    if (resultActionTaken !== false) {
        return assistantReply;
    }
    const notice = get_no_result_fetch_notice();
    if (assistantReply.includes(notice)) {
        return assistantReply;
    }
    return `${assistantReply}\n\n${notice}`;
}

function setChatComposerBusy(chat_input, chat_send_btn, clear_history_btn, busy) {
    const nextBusy = Boolean(busy);
    chat_input.disabled = nextBusy;
    chat_send_btn.disabled = nextBusy;
    clear_history_btn.disabled = nextBusy;
    chat_send_btn.setAttribute('aria-busy', String(nextBusy));
}

// ----- Yleisviestin näyttäminen chatissa -----
export function append_chat_message(table_name, sender, friendly_explanation, sql_code, metadata = {}) {
    if (sender === 'system') {
        return null;
    }
    const chat_container = document.getElementById(`${table_name}_chat_container`);
    if (!chat_container) return null;

    const message_div = build_chat_message_element(sender, friendly_explanation, metadata);
    chat_container.appendChild(message_div);
    void sql_code;
    scroll_chat_to_bottom(chat_container);
    return message_div;
}

function build_chat_message_element(sender, friendly_explanation, metadata = {}) {
    const message_div = document.createElement('div');
    message_div.classList.add('chat-bubble');
    if (sender === 'user') {
        message_div.classList.add('chat-bubble-user');
    } else if (sender === 'assistant') {
        message_div.classList.add('chat-bubble-assistant');
    } else if (sender === 'error') {
        message_div.classList.add('chat-bubble-error');
    }

    updateChatMessageTimestamp(message_div, metadata.created_at || buildChatCreatedAt());

    const text_elem = document.createElement('div');
    text_elem.classList.add('chat-text');
    text_elem.textContent = friendly_explanation;
    message_div.appendChild(text_elem);
    renderChatUsageSummary(message_div, metadata.usage);
    return message_div;
}

function updateChatMessageTimestamp(message_div, created_at) {
    const normalizedCreatedAt = normalizeChatCreatedAt(created_at) || buildChatCreatedAt();
    let timestamp_elem = message_div.querySelector('.chat-message-timestamp');
    if (!timestamp_elem) {
        timestamp_elem = document.createElement('time');
        timestamp_elem.classList.add('chat-message-timestamp');
        message_div.prepend(timestamp_elem);
    }
    timestamp_elem.dateTime = normalizedCreatedAt;
    timestamp_elem.textContent = formatChatMessageTimestamp(normalizedCreatedAt);
}

function formatChatMessageTimestamp(created_at) {
    const timestamp = parseConversationTimestamp(created_at);
    if (timestamp === null) {
        return '';
    }
    const lang = String(document.documentElement.lang || '').toLowerCase();
    const locale = lang.startsWith('fi') ? 'fi-FI' : undefined;
    try {
        return new Intl.DateTimeFormat(locale, {
            dateStyle: 'short',
            timeStyle: 'short',
        }).format(new Date(timestamp));
    } catch (error) {
        void error;
        return new Date(timestamp).toLocaleString();
    }
}

function formatChatUsageNumber(value) {
    return Math.round(Number(value) || 0).toLocaleString('en-US');
}

function formatChatUsageCost(value) {
    const cost = Number(value);
    if (!Number.isFinite(cost) || cost <= 0) {
        return '';
    }
    return `$${cost.toLocaleString('en-US', {
        minimumFractionDigits: cost < 0.01 ? 6 : 4,
        maximumFractionDigits: 8,
    })}`;
}

function renderChatUsageSummary(message_div, rawUsage) {
    const existing = message_div.querySelector('.chat-usage-summary');
    if (existing) {
        existing.remove();
    }

    const usage = normalizeChatUsage(rawUsage);
    if (!usage || !isFilterbarAIChatDevEnvironment()) {
        return;
    }

    const summary = document.createElement('div');
    summary.classList.add('chat-usage-summary');

    const lang = String(document.documentElement.lang || '').toLowerCase();
    const isFinnish = lang.startsWith('fi');
    const label = isFinnish ? '100 % API-kulu' : '100% API cost';
    const unavailableLabel = isFinnish ? 'ei saatavilla' : 'unavailable';

    const title = document.createElement('div');
    title.classList.add('chat-usage-title');
    const modelParts = [usage.provider, usage.model].filter(Boolean).join(' / ');
    const effortText = usage.effort ? ` · effort: ${usage.effort}` : '';
    title.textContent = `${label}: ${modelParts || unavailableLabel}${effortText}`;
    summary.appendChild(title);

    if (usage.total_tokens > 0) {
        const tokens = document.createElement('div');
        tokens.classList.add('chat-usage-line');
        const inputLabel = isFinnish ? 'sisään' : 'in';
        const outputLabel = isFinnish ? 'ulos' : 'out';
        const totalLabel = isFinnish ? 'yht.' : 'total';
        tokens.textContent = [
            `${inputLabel} ${formatChatUsageNumber(usage.input_tokens)}`,
            `${outputLabel} ${formatChatUsageNumber(usage.output_tokens)}`,
            `${totalLabel} ${formatChatUsageNumber(usage.total_tokens)}`,
        ].join(' · ');
        summary.appendChild(tokens);
    }

    const detailParts = [];
    if (usage.cached_input_tokens > 0) {
        detailParts.push(`${isFinnish ? 'cached' : 'cached'} ${formatChatUsageNumber(usage.cached_input_tokens)}`);
    }
    if (usage.reasoning_tokens > 0) {
        detailParts.push(`${isFinnish ? 'reasoning' : 'reasoning'} ${formatChatUsageNumber(usage.reasoning_tokens)}`);
    }
    const costText = formatChatUsageCost(usage.cost_usd);
    if (costText) {
        detailParts.push(costText);
    }
    if (detailParts.length > 0) {
        const details = document.createElement('div');
        details.classList.add('chat-usage-line');
        details.textContent = detailParts.join(' · ');
        summary.appendChild(details);
    }

    if (usage.pricing_note) {
        const note = document.createElement('div');
        note.classList.add('chat-usage-note');
        note.textContent = usage.pricing_note;
        summary.appendChild(note);
    }

    message_div.appendChild(summary);
}

function scroll_chat_to_bottom(chat_container) {
    setTimeout(() => {
        chat_container.scrollTop = chat_container.scrollHeight;
    }, 0);
}

function getPendingStatusMessages(mode) {
    const isEnglish = String(document.documentElement.lang || '').toLowerCase().startsWith('en');
    if (mode === 'codex_dev') {
        return isEnglish
            ? [
                'Codex started working.',
                'Codex is reading the chat and context.',
                'Codex may inspect and edit the configured code workspace.',
                'Codex is still working.',
                'Long coding jobs may take up to 40 minutes.',
            ]
            : [
                'Codex aloitti työn.',
                'Codex lukee keskustelua ja kontekstia.',
                'Codex voi tarkistaa ja muokata sille määritettyä koodityötilaa.',
                'Codex työskentelee edelleen.',
                'Pitkä koodaustyö voi kestää enintään 40 minuuttia.',
            ];
    }
    return isEnglish
        ? [
            'AI is writing.',
            'AI is reading the result context.',
            'AI is still working.',
        ]
        : [
            'AI kirjoittaa.',
            'AI lukee tuloskontekstia.',
            'AI työskentelee edelleen.',
        ];
}

function formatPendingElapsed(started_at_ms) {
    const elapsed_seconds = Math.max(0, Math.floor((Date.now() - started_at_ms) / 1000));
    const minutes = String(Math.floor(elapsed_seconds / 60)).padStart(2, '0');
    const seconds = String(elapsed_seconds % 60).padStart(2, '0');
    return `${minutes}:${seconds}`;
}

function render_pending_chat_message(pending_message) {
    if (!pending_message || pending_message.done) {
        return;
    }
    const messageIndex = Math.min(
        pending_message.status_index,
        pending_message.status_messages.length - 1
    );
    pending_message.status_text.textContent = pending_message.status_messages[messageIndex];
    pending_message.elapsed_text.textContent = formatPendingElapsed(pending_message.started_at_ms);
}

function append_pending_chat_message(table_name, mode) {
    const chat_container = document.getElementById(`${table_name}_chat_container`);
    if (!chat_container) return null;

    const message_div = build_chat_message_element('assistant', '');
    message_div.classList.add('chat-bubble-pending');
    message_div.dataset.pending = 'true';
    message_div.setAttribute('aria-live', 'polite');

    const text_elem = message_div.querySelector('.chat-text');
    text_elem.textContent = '';

    const status_text = document.createElement('span');
    status_text.classList.add('chat-pending-status');

    const dots = document.createElement('span');
    dots.classList.add('chat-typing-dots');
    dots.setAttribute('aria-hidden', 'true');
    for (let index = 0; index < 3; index += 1) {
        const dot = document.createElement('span');
        dot.classList.add('chat-typing-dot');
        dots.appendChild(dot);
    }

    const elapsed_text = document.createElement('span');
    elapsed_text.classList.add('chat-pending-elapsed');

    text_elem.append(status_text, dots, elapsed_text);
    chat_container.appendChild(message_div);

    const pending_message = {
        element: message_div,
        text_elem,
        status_text,
        elapsed_text,
        status_messages: getPendingStatusMessages(mode),
        status_index: 0,
        started_at_ms: Date.now(),
        interval_id: 0,
        done: false,
    };

    render_pending_chat_message(pending_message);
    pending_message.interval_id = window.setInterval(() => {
        pending_message.status_index += 1;
        render_pending_chat_message(pending_message);
    }, CHAT_PENDING_HEARTBEAT_MS);
    scroll_chat_to_bottom(chat_container);
    return pending_message;
}

/** Returns the finished message element so callers can attach follow-up UI. */
function finish_pending_chat_message(table_name, pending_message, sender, message_text, metadata = {}) {
    if (!pending_message || pending_message.done || !pending_message.element?.isConnected) {
        return append_chat_message(table_name, sender, message_text, '', metadata);
    }
    pending_message.done = true;
    window.clearInterval(pending_message.interval_id);
    pending_message.element.classList.remove(
        'chat-bubble-assistant',
        'chat-bubble-error',
        'chat-bubble-pending'
    );
    pending_message.element.classList.add(
        sender === 'error' ? 'chat-bubble-error' : 'chat-bubble-assistant'
    );
    pending_message.element.removeAttribute('data-pending');
    updateChatMessageTimestamp(pending_message.element, metadata.created_at || buildChatCreatedAt());
    pending_message.text_elem.textContent = message_text;
    renderChatUsageSummary(pending_message.element, metadata.usage);

    const chat_container = document.getElementById(`${table_name}_chat_container`);
    if (chat_container) {
        scroll_chat_to_bottom(chat_container);
    }
    return pending_message.element;
}

// Tallennus
function add_to_conversation(table_name, msg) {
    const normalizedMessage = normalizeConversationMessage(msg);
    if (!normalizedMessage) {
        return;
    }
    if (!conversation_map.has(table_name)) {
        conversation_map.set(table_name, []);
    }
    const conv = conversation_map.get(table_name);
    conv.push(normalizedMessage);
    conversation_map.set(table_name, conv);
    save_conversation_to_local_storage(table_name);
}

function replace_result_context_in_conversation(table_name, msg) {
    const memoryMessage = normalizeConversationMessage(msg);
    if (
        !memoryMessage ||
        memoryMessage.role !== 'system' ||
        !memoryMessage.content.startsWith(RESULT_CONTEXT_MESSAGE_PREFIX)
    ) {
        return;
    }

    const conv = (conversation_map.get(table_name) || []).filter((message) => {
        return !(
            message?.role === 'system' &&
            typeof message?.content === 'string' &&
            message.content.startsWith(RESULT_CONTEXT_MESSAGE_PREFIX)
        );
    });
    conv.push(memoryMessage);
    conversation_map.set(table_name, conv);
    save_conversation_to_local_storage(table_name);
}

function add_to_user_history(table_name, user_message) {
    if (!user_message_history_map.has(table_name)) {
        user_message_history_map.set(table_name, []);
    }
    const history = user_message_history_map.get(table_name);
    history.push(user_message);
    user_message_history_map.set(table_name, history);
    user_history_index_map.set(table_name, history.length);
}

function load_conversation_from_local_storage(table_name) {
    const localSnapshot = readConversationSnapshotFromLocalStorage(table_name);

    setConversationState(table_name, localSnapshot?.messages || [], {
        updated_at: localSnapshot?.updated_at || '',
        needs_sync: localSnapshot?.needs_sync === true,
        persist_local: localSnapshot !== null,
    });
    renderConversation(table_name);
    void hydrateConversationFromBackend(table_name, localSnapshot);
}
