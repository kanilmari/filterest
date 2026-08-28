// queen_chat_view.js
// Renders the admin browser view for Queen transcript browsing and managed session control.
// Bridges the Queen transcript/session HTTP endpoints with the SPA admin tools shell.
// Exists to make local Queen runs inspectable in-browser and startable from the same admin view.
// PIPELINE_EXCEPTION: Queen transcript/session EventSource streams cannot use endpoint_router's request/response pipeline.

import { endpoint_router, get_endpoint_url } from '../endpoints/endpoint_router.js';
import { showErrorToast, showInfoToast } from '../../reusable_components/notifications/toast_notification_printer.js';
import {
    buildDirectRunLatestHumanReply,
    getDirectRunOutcome,
    buildDirectRunProgressSummary,
    buildDirectRunProcessStatusSummary,
    buildDirectRunTurnSummary,
    buildManagedSessionPendingTurnMeta,
    buildManagedSessionPendingTurnSummary,
    buildQueenContinuationPrompt,
    buildQueenPublicThreadTimeline,
    buildQueenTranscriptSummary,
    buildTerminalHandoffHint,
    buildQueenThreadSummaries,
    canReplyToManagedSession,
    formatQueenTranscriptDisplayText,
    getQueenTranscriptDebugText,
    formatQueenDisplayTimestamp,
    getQueenChatAuthFailure,
    getQueenComposerMode,
    isAwaitingHumanDirectRunTranscript,
    isTerminalManagedSessionStatus,
    isTerminalDirectRunTranscript,
    shouldAutoCollapseQueenMessage,
    shouldAutoFollowManagedSession,
    shouldDetachStaleDirectRunFollow,
    shouldRefreshTerminalSessionTranscriptSnapshot,
} from './queen_chat_helpers.js';

let activeTranscriptStream = null;
let activeSessionStream = null;
let activeSidebarRefreshTimer = null;
const QUEEN_CHAT_STORAGE_KEY = 'easelect:queen_chat_view:v1';
const QUEEN_CHAT_SIDEBAR_REFRESH_MS = 10000;

export async function generate_queen_chat_view(container) {
    if (!container) return;
    stopQueenTranscriptStream();
    stopQueenSessionStream();
    stopQueenSidebarAutoRefresh();
    container.replaceChildren();
    container.classList.add('queen-chat-view');

    const frame = document.createElement('div');
    frame.className = 'tool-content-frame queen-chat-layout oy';
    container.appendChild(frame);

    const listColumn = document.createElement('section');
    listColumn.className = 'queen-chat-sidebar';
    const chatColumn = document.createElement('section');
    chatColumn.className = 'queen-chat-main';
    const detailColumn = document.createElement('section');
    detailColumn.className = 'queen-chat-detail-rail';
    frame.append(listColumn, chatColumn, detailColumn);

    renderRunListShell(listColumn);
    const chatState = renderChatShell(chatColumn, detailColumn);
    chatState.listColumn = listColumn;
    listColumn.__queenChatState = chatState;
    chatState.sendHumanMessageButton?.addEventListener('click', async () => {
        await sendManagedSessionHumanMessage(chatState);
    });
    chatState.cancelComposerButton?.addEventListener('click', () => {
        cancelNewConversation(chatState);
    });
    chatState.humanMessageInput?.addEventListener('input', () => {
        persistQueenChatViewState(chatState);
        syncManagedSessionComposer(chatState);
    });
    chatState.transcriptToggleButton?.addEventListener('click', () => {
        chatState.showInternalAgentTurns = !chatState.showInternalAgentTurns;
        rerenderVisibleQueenThreadTimeline(chatState);
        persistQueenChatViewState(chatState);
        syncTranscriptChrome(chatState);
    });
    chatState.newConversationTaskIdInput?.addEventListener('input', () => {
        persistQueenChatViewState(chatState);
    });
    chatState.newConversationMaxTurnsInput?.addEventListener('input', () => {
        persistQueenChatViewState(chatState);
    });
    hydratePersistedQueenComposerInputs(chatState);
    syncManagedSessionComposer(chatState);

    await refreshQueenSidebarData(listColumn, chatState);
    await restorePersistedQueenView(listColumn, chatState);
    startQueenSidebarAutoRefresh(container, listColumn, chatState);
}

function renderRunListShell(container) {
    const title = document.createElement('h2');
    title.dataset.langKey = 'queen_chat';
    title.textContent = 'Queen Chat';
    title.style.margin = '0';
    container.appendChild(title);

    const description = document.createElement('p');
    description.dataset.langKey = 'queen_chat_admin_description';
    description.textContent = 'Browse Queen run transcripts, inspect message timelines, and start managed runs from the browser.';
    description.classList.add('fw-text-muted');
    description.style.margin = '0';
    container.appendChild(description);

    const sessionFrame = document.createElement('section');
    sessionFrame.className = 'queen-chat-panel queen-chat-panel--accent';
    container.appendChild(sessionFrame);

    const sessionHeading = document.createElement('h3');
    sessionHeading.dataset.langKey = 'queen_managed_sessions';
    sessionHeading.textContent = 'Active Sessions';
    sessionHeading.style.margin = '0';
    sessionFrame.appendChild(sessionHeading);

    const sessionDescription = document.createElement('p');
    sessionDescription.dataset.langKey = 'queen_managed_sessions_description';
    sessionDescription.textContent = 'Only currently active Queen sessions appear here. Use Conversation Threads below to reopen finished conversations without duplicates.';
    sessionDescription.classList.add('fw-text-muted', 'fw-text-sm');
    sessionDescription.style.margin = '0';
    sessionFrame.appendChild(sessionDescription);

    const sessionActions = document.createElement('div');
    sessionActions.className = 'queen-chat-sidebar-actions';
    sessionFrame.appendChild(sessionActions);

    const newConversationButton = document.createElement('button');
    newConversationButton.type = 'button';
    newConversationButton.className = 'button';
    newConversationButton.dataset.testid = 'queen-session-new';
    newConversationButton.textContent = 'New Conversation';
    sessionActions.appendChild(newConversationButton);

    const refreshSessionsButton = document.createElement('button');
    refreshSessionsButton.type = 'button';
    refreshSessionsButton.className = 'button button--small';
    refreshSessionsButton.dataset.testid = 'queen-sessions-refresh';
    refreshSessionsButton.dataset.langKey = 'refresh';
    refreshSessionsButton.textContent = 'Refresh';
    sessionActions.appendChild(refreshSessionsButton);

    const sessionList = document.createElement('div');
    sessionList.dataset.testid = 'queen-managed-session-list';
    sessionList.className = 'queen-chat-list';
    sessionFrame.appendChild(sessionList);

    const threadFrame = document.createElement('section');
    threadFrame.className = 'queen-chat-panel';
    container.appendChild(threadFrame);

    const threadHeader = document.createElement('div');
    threadHeader.className = 'queen-chat-panel-header';
    threadFrame.appendChild(threadHeader);

    const threadHeading = document.createElement('h3');
    threadHeading.textContent = 'Conversation Threads';
    threadHeading.style.margin = '0';
    threadHeader.appendChild(threadHeading);

    const refreshThreadsButton = document.createElement('button');
    refreshThreadsButton.type = 'button';
    refreshThreadsButton.className = 'button button--small';
    refreshThreadsButton.dataset.testid = 'queen-threads-refresh';
    refreshThreadsButton.dataset.langKey = 'refresh';
    refreshThreadsButton.textContent = 'Refresh';
    refreshThreadsButton.addEventListener('click', async () => {
        const chatState = container.__queenChatState;
        if (!chatState) return;
        await refreshQueenSidebarData(container, chatState);
    });
    threadHeader.appendChild(refreshThreadsButton);

    const threadDescription = document.createElement('p');
    threadDescription.textContent = 'Threads are the user-facing Queen conversations. A thread can contain one or more underlying runs.';
    threadDescription.classList.add('fw-text-muted', 'fw-text-sm');
    threadDescription.style.margin = '0';
    threadFrame.appendChild(threadDescription);

    const threadList = document.createElement('div');
    threadList.dataset.testid = 'queen-thread-list';
    threadList.className = 'queen-chat-list';
    threadFrame.appendChild(threadList);

    const runFrame = document.createElement('section');
    runFrame.className = 'queen-chat-panel';
    container.appendChild(runFrame);

    const controls = document.createElement('div');
    controls.className = 'queen-chat-panel-header';
    runFrame.appendChild(controls);

    const heading = document.createElement('h3');
    heading.textContent = 'Debug Runs';
    heading.style.margin = '0';
    controls.appendChild(heading);

    const refreshButton = document.createElement('button');
    refreshButton.type = 'button';
    refreshButton.className = 'button button--small';
    refreshButton.dataset.testid = 'queen-chat-refresh-runs';
    refreshButton.dataset.langKey = 'refresh';
    refreshButton.textContent = 'Refresh';
    refreshButton.addEventListener('click', () => {
        const chatState = container.__queenChatState;
        if (!chatState) return;
        void refreshQueenSidebarData(container, chatState);
    });
    controls.appendChild(refreshButton);

    const runList = document.createElement('div');
    runList.dataset.testid = 'queen-chat-run-list';
    runList.className = 'queen-chat-list';
    runFrame.appendChild(runList);

    newConversationButton.addEventListener('click', async () => {
        const chatState = container.__queenChatState;
        if (!chatState) return;
        beginNewConversation(chatState);
    });

    refreshSessionsButton.addEventListener('click', () => {
        const chatState = container.__queenChatState;
        if (!chatState) return;
        void refreshQueenSidebarData(container, chatState);
    });

    container.__queenNewConversationButton = newConversationButton;
    container.__queenManagedSessionList = sessionList;
    container.__queenThreadList = threadList;
}

function renderChatShell(container, detailRail) {
    const persistedViewState = readQueenChatViewState();
    const transcriptToggleButton = document.createElement('button');
    transcriptToggleButton.type = 'button';
    transcriptToggleButton.className = 'button button--small queen-chat-toggle-button';
    transcriptToggleButton.dataset.testid = 'queen-chat-internal-toggle';
    transcriptToggleButton.hidden = true;
    transcriptToggleButton.textContent = 'Show internal turns';

    const authNotice = document.createElement('section');
    authNotice.className = 'queen-chat-panel queen-chat-panel--accent';
    authNotice.dataset.testid = 'queen-chat-auth-notice';
    authNotice.hidden = true;
    container.appendChild(authNotice);

    const authNoticeTitle = document.createElement('h3');
    authNoticeTitle.style.margin = '0';
    authNotice.appendChild(authNoticeTitle);

    const authNoticeBody = document.createElement('p');
    authNoticeBody.style.margin = '0';
    authNoticeBody.classList.add('fw-text-muted');
    authNotice.appendChild(authNoticeBody);

    const authNoticeMeta = document.createElement('p');
    authNoticeMeta.style.margin = '0';
    authNoticeMeta.classList.add('fw-text-muted', 'fw-text-sm');
    authNotice.appendChild(authNoticeMeta);

    const transcriptBox = document.createElement('div');
    transcriptBox.className = 'queen-chat-transcript-shell';
    transcriptBox.dataset.testid = 'queen-chat-transcript';
    container.appendChild(transcriptBox);

    const conversationOverviewFrame = document.createElement('section');
    conversationOverviewFrame.className = 'queen-chat-panel queen-chat-panel--accent';
    conversationOverviewFrame.dataset.testid = 'queen-chat-conversation-overview';
    detailRail.appendChild(conversationOverviewFrame);

    const conversationOverviewHeading = document.createElement('h4');
    conversationOverviewHeading.textContent = 'Conversation Overview';
    conversationOverviewHeading.style.margin = '0';
    conversationOverviewFrame.appendChild(conversationOverviewHeading);

    const conversationOverviewDescription = document.createElement('p');
    conversationOverviewDescription.textContent = 'Keep the selected thread, transcript mode, terminal handoff, and live orchestration status in one place.';
    conversationOverviewDescription.style.margin = '0';
    conversationOverviewDescription.classList.add('fw-text-muted', 'fw-text-sm');
    conversationOverviewFrame.appendChild(conversationOverviewDescription);

    const conversationOverviewGrid = document.createElement('div');
    conversationOverviewGrid.className = 'queen-chat-details-grid queen-chat-overview-grid';
    conversationOverviewFrame.appendChild(conversationOverviewGrid);

    const conversationSummaryDetail = buildSessionDetailCard('Selected Conversation', 'queen-chat-subtitle');
    conversationSummaryDetail.value.textContent = 'Select a run from the left to inspect its transcript.';

    const transcriptOverviewDetail = buildSessionDetailCard('Transcript View', 'queen-chat-transcript-overview');
    transcriptOverviewDetail.value.textContent = '';
    transcriptOverviewDetail.value.classList.add('queen-chat-detail-card-stack');
    const transcriptMeta = document.createElement('div');
    transcriptMeta.className = 'queen-chat-detail-card-chips';
    const transcriptCountChip = buildQueenChip('0 messages', 'unknown');
    const transcriptModeChip = buildQueenChip('Idle', 'unknown');
    transcriptMeta.append(transcriptCountChip, transcriptModeChip);
    const transcriptOverviewNote = document.createElement('div');
    transcriptOverviewNote.className = 'queen-chat-detail-card-meta';
    transcriptOverviewNote.textContent = 'Switch between the public thread timeline and internal agent turns when available.';
    const transcriptActions = document.createElement('div');
    transcriptActions.className = 'queen-chat-detail-card-actions';
    transcriptActions.appendChild(transcriptToggleButton);
    transcriptOverviewDetail.value.append(transcriptMeta, transcriptOverviewNote, transcriptActions);

    const terminalHandoffDetail = buildSessionDetailCard('Terminal Handoff', 'queen-chat-terminal-hint');
    terminalHandoffDetail.value.textContent = 'Terminal handoff: ./queen chat --sessions';

    const liveProgressDetail = buildSessionDetailCard('Live Progress', 'queen-chat-live-progress');
    liveProgressDetail.value.textContent = '';
    liveProgressDetail.value.classList.add('queen-chat-detail-card-stack');
    const progressOutcomeMeta = document.createElement('div');
    progressOutcomeMeta.className = 'queen-chat-detail-card-chips';
    progressOutcomeMeta.hidden = true;
    const progressOutcomeChip = buildQueenChip('RUNNING', 'running');
    const progressOutcomeSourceChip = buildQueenChip('Transcript', 'unknown');
    progressOutcomeMeta.append(progressOutcomeChip, progressOutcomeSourceChip);
    const processingIndicator = document.createElement('div');
    processingIndicator.className = 'queen-chat-processing-indicator';
    processingIndicator.hidden = true;
    const processingSpinner = document.createElement('span');
    processingSpinner.className = 'queen-chat-processing-spinner';
    processingSpinner.setAttribute('aria-hidden', 'true');
    const processingText = document.createElement('span');
    processingText.dataset.testid = 'queen-chat-processing-text';
    processingIndicator.append(processingSpinner, processingText);
    const progressDetailMeta = document.createElement('div');
    progressDetailMeta.className = 'queen-chat-detail-card-meta';
    progressDetailMeta.dataset.testid = 'queen-chat-progress-meta';
    progressDetailMeta.textContent = 'Open an active managed session to see live orchestration checkpoints.';
    liveProgressDetail.value.append(progressOutcomeMeta, processingIndicator, progressDetailMeta);

    conversationOverviewGrid.append(
        conversationSummaryDetail.card,
        transcriptOverviewDetail.card,
        terminalHandoffDetail.card,
        liveProgressDetail.card,
    );

    const sessionDetailsFrame = document.createElement('section');
    sessionDetailsFrame.className = 'queen-chat-panel';
    sessionDetailsFrame.dataset.testid = 'queen-chat-session-details';
    detailRail.appendChild(sessionDetailsFrame);

    const sessionDetailsHeading = document.createElement('h4');
    sessionDetailsHeading.textContent = 'Session Details';
    sessionDetailsHeading.style.margin = '0';
    sessionDetailsFrame.appendChild(sessionDetailsHeading);

    const sessionDetailsDescription = document.createElement('p');
    sessionDetailsDescription.textContent = 'See what Queen is currently waiting for, which turn is in flight, when the latest state changed, and what the latest human reply looked like.';
    sessionDetailsDescription.style.margin = '0';
    sessionDetailsDescription.classList.add('fw-text-muted', 'fw-text-sm');
    sessionDetailsFrame.appendChild(sessionDetailsDescription);

    const sessionDetailsEmpty = document.createElement('p');
    sessionDetailsEmpty.dataset.testid = 'queen-chat-session-details-empty';
    sessionDetailsEmpty.textContent = 'Select a managed session to inspect its current pause/resume state.';
    sessionDetailsEmpty.style.margin = '0';
    sessionDetailsEmpty.classList.add('fw-text-muted', 'fw-text-sm');
    sessionDetailsFrame.appendChild(sessionDetailsEmpty);

    const sessionDetailsGrid = document.createElement('div');
    sessionDetailsGrid.className = 'queen-chat-details-grid';
    sessionDetailsFrame.appendChild(sessionDetailsGrid);

    const sessionStateDetail = buildSessionDetailCard('Session State', 'queen-chat-session-state');
    const sessionTurnDetail = buildSessionDetailCard('Current Turn', 'queen-chat-session-turn');
    const sessionQuestionDetail = buildSessionDetailCard('Current Question', 'queen-chat-session-question');
    const sessionReplyDetail = buildSessionDetailCard('Latest Human Reply', 'queen-chat-session-reply');
    const sessionUpdateDetail = buildSessionDetailCard('Latest Update', 'queen-chat-session-update');
    sessionDetailsGrid.append(
        sessionStateDetail.card,
        sessionTurnDetail.card,
        sessionQuestionDetail.card,
        sessionReplyDetail.card,
        sessionUpdateDetail.card,
    );

    const eventHistoryFrame = document.createElement('section');
    eventHistoryFrame.className = 'queen-chat-panel';
    eventHistoryFrame.dataset.testid = 'queen-chat-history';
    detailRail.appendChild(eventHistoryFrame);

    const eventHistoryHeading = document.createElement('h4');
    eventHistoryHeading.textContent = 'Decision History';
    eventHistoryHeading.style.margin = '0';
    eventHistoryFrame.appendChild(eventHistoryHeading);

    const eventHistoryDescription = document.createElement('p');
    eventHistoryDescription.textContent = 'See the key pause/resume checkpoints, human replies, and completion markers from the current managed session.';
    eventHistoryDescription.style.margin = '0';
    eventHistoryDescription.classList.add('fw-text-muted', 'fw-text-sm');
    eventHistoryFrame.appendChild(eventHistoryDescription);

    const eventHistoryEmpty = document.createElement('p');
    eventHistoryEmpty.dataset.testid = 'queen-chat-history-empty';
    eventHistoryEmpty.textContent = 'Select a managed session to inspect its decision history.';
    eventHistoryEmpty.style.margin = '0';
    eventHistoryEmpty.classList.add('fw-text-muted', 'fw-text-sm');
    eventHistoryFrame.appendChild(eventHistoryEmpty);

    const eventHistoryList = document.createElement('div');
    eventHistoryList.className = 'queen-chat-history-list';
    eventHistoryFrame.appendChild(eventHistoryList);

    const composerFrame = document.createElement('section');
    composerFrame.className = 'queen-chat-panel queen-chat-composer-panel';
    container.appendChild(composerFrame);

    const cancelComposerButton = document.createElement('button');
    cancelComposerButton.type = 'button';
    cancelComposerButton.className = 'button button--small queen-chat-secondary-action';
    cancelComposerButton.dataset.testid = 'queen-chat-cancel-draft';
    cancelComposerButton.textContent = 'Cancel';
    cancelComposerButton.hidden = true;

    const composerDescription = document.createElement('p');
    composerDescription.textContent = 'Choose a conversation from the left or start a new one. This lower composer is the only writing field in the view.';
    composerDescription.style.margin = '0';
    composerDescription.classList.add('fw-text-muted', 'fw-text-sm');
    composerFrame.appendChild(composerDescription);

    const composerLayout = document.createElement('div');
    composerLayout.className = 'queen-chat-composer-layout';
    composerFrame.appendChild(composerLayout);

    const newConversationTaskIdInput = buildQueenSessionInput('Task ID (optional)', 'queen-session-task-id');
    const newConversationMaxTurnsInput = buildQueenSessionInput('Max turns', 'queen-session-max-turns');
    newConversationTaskIdInput.type = 'number';
    newConversationTaskIdInput.inputMode = 'numeric';
    newConversationMaxTurnsInput.type = 'number';
    newConversationMaxTurnsInput.inputMode = 'numeric';
    newConversationMaxTurnsInput.min = '1';
    newConversationMaxTurnsInput.value = '20';

    const humanMessageInput = document.createElement('textarea');
    humanMessageInput.className = 'fw-form-control queen-chat-textarea';
    humanMessageInput.dataset.testid = 'queen-chat-human-message';
    humanMessageInput.rows = 3;
    humanMessageInput.placeholder = 'Select a managed session that is awaiting human input.';
    humanMessageInput.style.resize = 'vertical';
    composerLayout.appendChild(humanMessageInput);

    const composerActionRail = document.createElement('div');
    composerActionRail.className = 'queen-chat-composer-rail';
    composerLayout.appendChild(composerActionRail);

    const composerOptions = document.createElement('div');
    composerOptions.className = 'queen-chat-composer-meta';
    composerOptions.hidden = true;
    composerActionRail.appendChild(composerOptions);
    composerOptions.append(newConversationTaskIdInput, newConversationMaxTurnsInput);

    const sendHumanMessageButton = document.createElement('button');
    sendHumanMessageButton.type = 'button';
    sendHumanMessageButton.className = 'button queen-chat-primary-action';
    sendHumanMessageButton.dataset.testid = 'queen-chat-human-send';
    sendHumanMessageButton.textContent = 'Send Human Reply';
    composerActionRail.append(sendHumanMessageButton, cancelComposerButton);

    const emptyState = document.createElement('p');
    emptyState.className = 'fw-text-muted queen-chat-inline-note';
    emptyState.dataset.langKey = 'queen_chat_empty_state';
    emptyState.textContent = 'No transcript selected yet.';
    transcriptBox.appendChild(emptyState);

    return {
        subtitle: conversationSummaryDetail.value,
        terminalHint: terminalHandoffDetail.value,
        composerDescription,
        composerOptions,
        cancelComposerButton,
        newConversationTaskIdInput,
        newConversationMaxTurnsInput,
        transcriptCountChip,
        transcriptModeChip,
        transcriptToggleButton,
        processingIndicator,
        processingSpinner,
        processingText,
        progressOutcomeMeta,
        progressOutcomeChip,
        progressOutcomeSourceChip,
        progressDetailMeta,
        authNotice,
        authNoticeTitle,
        authNoticeBody,
        authNoticeMeta,
        transcriptBox,
        sessionDetailsEmpty,
        sessionStateDetailValue: sessionStateDetail.value,
        sessionTurnDetailValue: sessionTurnDetail.value,
        sessionQuestionDetailValue: sessionQuestionDetail.value,
        sessionReplyDetailValue: sessionReplyDetail.value,
        sessionUpdateDetailValue: sessionUpdateDetail.value,
        eventHistoryEmpty,
        eventHistoryList,
        humanMessageInput,
        sendHumanMessageButton,
        selectedRun: null,
        selectedSession: null,
        selectedThread: null,
        currentTranscriptEntries: [],
        currentPublicTimelineEntries: [],
        optimisticPublicMessage: null,
        pendingHumanReplyPreview: '',
        directRunLive: null,
        expandedTranscriptMessageKeys: new Set(),
        newConversationDraft: false,
        following: false,
        transcriptViewMode: 'idle',
        availableRuns: [],
        availableSessions: [],
        availableThreads: [],
        sidebarRefreshInFlight: null,
        threadTranscriptCache: {},
        persistedViewState,
        showInternalAgentTurns: Boolean(persistedViewState?.showInternalAgentTurns),
        authLoss: null,
    };
}

function startQueenSidebarAutoRefresh(container, listColumn, chatState) {
    stopQueenSidebarAutoRefresh();
    if (!container || !listColumn || !chatState) {
        return;
    }
    activeSidebarRefreshTimer = window.setInterval(() => {
        if (!container.isConnected) {
            stopQueenSidebarAutoRefresh();
            return;
        }
        if (isQueenChatAuthLost(chatState)) {
            stopQueenSidebarAutoRefresh();
            return;
        }
        void refreshQueenSidebarData(listColumn, chatState, { quiet: true });
    }, QUEEN_CHAT_SIDEBAR_REFRESH_MS);
}

function stopQueenSidebarAutoRefresh() {
    if (activeSidebarRefreshTimer) {
        window.clearInterval(activeSidebarRefreshTimer);
        activeSidebarRefreshTimer = null;
    }
}

function isQueenChatAuthLost(chatState) {
    return Boolean(chatState?.authLoss?.active);
}

function buildQueenAuthLossMeta(chatState) {
    const authLoss = chatState?.authLoss;
    if (!authLoss?.active) {
        return '';
    }

    const parts = [];
    if (authLoss.status) {
        parts.push(`HTTP ${authLoss.status}`);
    }
    if (String(authLoss.source || '').trim() !== '') {
        parts.push(`While checking ${authLoss.source}`);
    }
    if (String(authLoss.detectedAt || '').trim() !== '') {
        parts.push(`Detected ${formatManagedSessionTimestamp(authLoss.detectedAt)}`);
    }
    return parts.join(' · ');
}

function syncQueenAuthLossUI(chatState) {
    if (!chatState) {
        return;
    }

    const authLoss = chatState.authLoss;
    const notice = chatState.authNotice;
    const title = chatState.authNoticeTitle;
    const body = chatState.authNoticeBody;
    const meta = chatState.authNoticeMeta;
    const transcriptBox = chatState.transcriptBox;
    if (!notice || !title || !body || !meta || !transcriptBox) {
        return;
    }

    if (!authLoss?.active) {
        notice.hidden = true;
        transcriptBox.hidden = false;
        meta.textContent = '';
        return;
    }

    notice.hidden = false;
    transcriptBox.hidden = true;
    title.textContent = authLoss.title;
    body.textContent = authLoss.detail;
    meta.textContent = buildQueenAuthLossMeta(chatState);
}

function setQueenChatAuthLostState(chatState, error, source) {
    const authFailure = getQueenChatAuthFailure(error);
    if (!chatState || !authFailure) {
        return false;
    }

    stopQueenSidebarAutoRefresh();
    stopQueenSessionStream();
    stopQueenTranscriptStream(chatState);
    chatState.authLoss = {
        active: true,
        source: String(source || '').trim(),
        detectedAt: new Date().toISOString(),
        ...authFailure,
    };
    syncQueenAuthLossUI(chatState);
    syncManagedSessionDetails(chatState);
    syncManagedSessionComposer(chatState);
    syncTranscriptChrome(chatState);
    return true;
}

async function probeQueenChatAuthLoss(chatState, source) {
    if (!chatState) {
        return false;
    }
    if (isQueenChatAuthLost(chatState)) {
        return true;
    }
    if (chatState.__queenAuthProbeInFlight) {
        return chatState.__queenAuthProbeInFlight;
    }

    chatState.__queenAuthProbeInFlight = (async () => {
        try {
            await endpoint_router('queenSessions', {
                suppressAuthRedirect: true,
            });
            return false;
        } catch (error) {
            return setQueenChatAuthLostState(chatState, error, source);
        } finally {
            chatState.__queenAuthProbeInFlight = null;
        }
    })();

    return chatState.__queenAuthProbeInFlight;
}

async function refreshQueenSidebarData(listColumn, chatState, options = {}) {
    if (!listColumn || !chatState) return;
    if (isQueenChatAuthLost(chatState)) {
        return;
    }
    if (chatState.sidebarRefreshInFlight) {
        await chatState.sidebarRefreshInFlight;
        return;
    }
    chatState.sidebarRefreshInFlight = (async () => {
        await loadManagedSessions(listColumn, chatState, options);
        if (isQueenChatAuthLost(chatState)) {
            return;
        }
        await loadQueenRuns(listColumn, chatState, options);
    })();
    try {
        await chatState.sidebarRefreshInFlight;
    } finally {
        chatState.sidebarRefreshInFlight = null;
    }
}

async function loadQueenRuns(listColumn, chatState, options = {}) {
    listColumn.__queenChatState = chatState;
    const runList = listColumn.querySelector('[data-testid="queen-chat-run-list"]');
    if (!runList) return;
    const quiet = options?.quiet === true;

    if (!quiet || runList.childElementCount === 0) {
        runList.replaceChildren();
        const loading = document.createElement('p');
        loading.className = 'fw-text-muted queen-chat-inline-note';
        loading.dataset.langKey = 'loading';
        loading.textContent = 'Loading...';
        runList.appendChild(loading);
    }

    try {
        const response = await endpoint_router('queenRuns', {
            suppressAuthRedirect: true,
        });
        const runs = Array.isArray(response?.runs) ? response.runs : [];
        chatState.availableRuns = runs;
        if (chatState.selectedRun?.filename) {
            chatState.selectedRun = runs.find((run) => run.filename === chatState.selectedRun.filename) || chatState.selectedRun;
        }
        renderQueenRunCards(runList, runs, chatState);
        syncQueenThreadList(listColumn, chatState);
    } catch (error) {
        if (setQueenChatAuthLostState(chatState, error, 'Queen runs')) {
            return;
        }
        if (quiet && runList.childElementCount > 0) {
            console.warn('Queen run list refresh failed:', error);
            return;
        }
        runList.replaceChildren();
        const errorNode = document.createElement('p');
        errorNode.className = 'queen-chat-inline-note';
        errorNode.textContent = error.message || 'Failed to load Queen runs.';
        errorNode.style.color = 'var(--danger)';
        runList.appendChild(errorNode);
        showErrorToast(`Queen run list failed: ${error.message || error}`);
    }
}

async function loadManagedSessions(listColumn, chatState, options = {}) {
    listColumn.__queenChatState = chatState;
    const sessionList = listColumn.__queenManagedSessionList;
    if (!sessionList) return;
    const quiet = options?.quiet === true;

    if (!quiet || sessionList.childElementCount === 0) {
        sessionList.replaceChildren();
        const loading = document.createElement('p');
        loading.className = 'fw-text-muted queen-chat-inline-note';
        loading.dataset.langKey = 'loading';
        loading.textContent = 'Loading...';
        sessionList.appendChild(loading);
    }

    try {
        const response = await endpoint_router('queenSessions', {
            suppressAuthRedirect: true,
        });
        const sessions = Array.isArray(response?.sessions) ? response.sessions : [];
        chatState.availableSessions = sessions;
        if (chatState.selectedSession?.id) {
            const refreshedSession = sessions.find((session) => session.id === chatState.selectedSession.id) || null;
            chatState.selectedSession = refreshedSession;
            if (refreshedSession) {
                chatState.subtitle.textContent = buildQueenSessionSubtitle(refreshedSession);
            }
        }
        syncManagedSessionDetails(chatState);
        syncManagedSessionComposer(chatState);
        renderManagedSessionCards(sessionList, sessions, chatState, listColumn);
        syncQueenThreadList(listColumn, chatState);
    } catch (error) {
        if (setQueenChatAuthLostState(chatState, error, 'Queen sessions')) {
            return;
        }
        if (quiet && sessionList.childElementCount > 0) {
            console.warn('Queen sessions refresh failed:', error);
            return;
        }
        sessionList.replaceChildren();
        const errorNode = document.createElement('p');
        errorNode.className = 'queen-chat-inline-note';
        errorNode.textContent = error.message || 'Failed to load Queen sessions.';
        errorNode.style.color = 'var(--danger)';
        sessionList.appendChild(errorNode);
        showErrorToast(`Queen sessions failed: ${error.message || error}`);
    }
}

function renderManagedSessionCards(sessionList, sessions, chatState, listColumn) {
    sessionList.replaceChildren();

    const visibleSessions = sessions.filter((session) => isManagedSessionActiveStatus(session.status));

    if (visibleSessions.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'fw-text-muted queen-chat-inline-note';
        empty.dataset.langKey = 'queen_sessions_empty';
        empty.textContent = 'No active managed Queen sessions right now.';
        sessionList.appendChild(empty);
        return;
    }

    visibleSessions.forEach((session) => {
        const card = document.createElement('div');
        card.className = 'queen-chat-list-card queen-chat-session-card saturate_on_hover';
        card.dataset.sessionId = session.id;
        card.dataset.testid = `queen-session-${session.id}`;
        applyManagedSessionSelection(card, chatState.selectedSession?.id === session.id);

        const openButton = document.createElement('button');
        openButton.type = 'button';
        openButton.className = 'queen-chat-card-button';

        const cardHeader = document.createElement('div');
        cardHeader.className = 'queen-chat-card-heading';
        cardHeader.appendChild(buildQueenChip(formatQueenLabel(session.status), normalizeQueenToken(session.status)));
        if (session.human_followup_queued) {
            cardHeader.appendChild(buildQueenChip('Reply queued', 'resuming'));
        }
        openButton.appendChild(cardHeader);

        const promptPreview = document.createElement('strong');
        promptPreview.className = 'queen-chat-card-preview';
        promptPreview.textContent = truncateQueenText(session.prompt, 120);
        openButton.appendChild(promptPreview);
        openButton.addEventListener('click', async () => {
            await openManagedSession(session, chatState, listColumn);
        });
        card.appendChild(openButton);

        const meta = document.createElement('div');
        meta.className = 'queen-chat-card-meta';
        meta.textContent = `${formatManagedSessionTimestamp(session.created_at)} · ${session.transcript_filename}`;
        card.appendChild(meta);

        if (session.status_reason) {
            const reasonMarker = document.createElement('span');
            reasonMarker.className = 'queen-chat-inline-note';
            reasonMarker.textContent = truncateQueenText(session.status_reason, 180);
            card.appendChild(reasonMarker);
        }

        if (session.human_followup_queued) {
            const queuedMarker = document.createElement('span');
            queuedMarker.className = 'queen-chat-inline-note';
            queuedMarker.textContent = 'Human reply queued; Queen is resuming';
            card.appendChild(queuedMarker);
        }

        if (isManagedSessionActiveStatus(session.status)) {
            const stopButton = document.createElement('button');
            stopButton.type = 'button';
            stopButton.className = 'button button--small';
            stopButton.dataset.testid = `queen-session-stop-${session.id}`;
            stopButton.textContent = 'Stop';
            stopButton.addEventListener('click', async (event) => {
                event.stopPropagation();
                await stopManagedSession(session.id, listColumn, chatState);
            });
            card.appendChild(stopButton);
        }

        sessionList.appendChild(card);
    });

    highlightSelectedManagedSession(sessionList, chatState.selectedSession?.id || null);
}

function syncQueenThreadList(listColumn, chatState) {
    const threadList = listColumn?.__queenThreadList;
    if (!threadList) return;

    const threads = buildQueenThreadSummaries(chatState.availableRuns, chatState.availableSessions);
    chatState.availableThreads = threads;
    syncSelectedQueenThread(chatState);
    renderQueenThreadCards(threadList, threads, chatState, listColumn);
}

function renderQueenThreadCards(threadList, threads, chatState, listColumn) {
    threadList.replaceChildren();

    if (threads.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'fw-text-muted queen-chat-inline-note';
        empty.textContent = 'No Queen conversation threads have been indexed yet.';
        threadList.appendChild(empty);
        return;
    }

    threads.forEach((thread) => {
        const card = document.createElement('div');
        card.className = 'queen-chat-list-card queen-chat-thread-card saturate_on_hover';
        card.dataset.threadKey = thread.key;
        card.dataset.testid = `queen-thread-${thread.key}`;

        const openButton = document.createElement('button');
        openButton.type = 'button';
        openButton.className = 'queen-chat-card-button';
        openButton.addEventListener('click', async () => {
            await openQueenThread(thread, chatState, listColumn);
        });

        const header = document.createElement('div');
        header.className = 'queen-chat-card-heading';
        if (thread.activeSession) {
            header.appendChild(buildQueenChip(formatQueenLabel(thread.activeSession.status), normalizeQueenToken(thread.activeSession.status)));
        } else if (thread.latestSession) {
            header.appendChild(buildQueenChip(formatQueenLabel(thread.latestSession.status), normalizeQueenToken(thread.latestSession.status)));
        } else {
            header.appendChild(buildQueenChip(thread.runCount === 1 ? '1 run' : `${thread.runCount} runs`, 'queen'));
        }
        if (thread.persistent) {
            header.appendChild(buildQueenChip('Thread', 'unknown'));
        }
        openButton.appendChild(header);

        const title = document.createElement('strong');
        title.className = 'queen-chat-card-preview';
        title.textContent = truncateQueenText(thread.title, 120);
        openButton.appendChild(title);

        const meta = document.createElement('span');
        meta.className = 'queen-chat-card-meta';
        const latestMoment = thread.activeSession?.updated_at
            || thread.activeSession?.created_at
            || thread.latestSession?.updated_at
            || thread.latestSession?.created_at
            || thread.latestRun?.timestamp
            || '';
        meta.textContent = [
            latestMoment ? formatManagedSessionTimestamp(latestMoment) : '',
            thread.runCount === 1 ? '1 underlying run' : `${thread.runCount} underlying runs`,
        ].filter(Boolean).join(' · ');
        openButton.appendChild(meta);

        const detail = document.createElement('span');
        detail.className = 'queen-chat-inline-note';
        if (thread.activeSession?.id) {
            detail.textContent = `Live session ${thread.activeSession.id} · ${thread.activeSession.transcript_filename || thread.latestRun?.filename || ''}`;
        } else if (thread.latestSession?.id) {
            detail.textContent = `Latest session ${thread.latestSession.id} · ${formatQueenLabel(thread.latestSession.status)}`;
        } else if (thread.latestRun?.filename) {
            detail.textContent = `Latest run: ${thread.latestRun.filename}`;
        } else {
            detail.textContent = 'No linked run metadata was found yet.';
        }
        openButton.appendChild(detail);

        card.appendChild(openButton);
        threadList.appendChild(card);
    });

    highlightSelectedThread(threadList, chatState.selectedThread?.key || null);
}

function renderQueenRunCards(runList, runs, chatState) {
    runList.replaceChildren();

    if (runs.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'fw-text-muted queen-chat-inline-note';
        empty.dataset.langKey = 'queen_runs_empty';
        empty.textContent = 'No Queen transcripts were found.';
        runList.appendChild(empty);
        return;
    }

    runs.forEach((run) => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'queen-chat-list-card queen-chat-run-card saturate_on_hover';
        card.dataset.testid = `queen-run-${run.filename}`;
        card.dataset.runFilename = run.filename;

        const cardHeader = document.createElement('div');
        cardHeader.className = 'queen-chat-card-heading';
        const runLabel = run.task_id === 'manual' ? 'Manual run' : `Task #${run.task_id}`;
        cardHeader.appendChild(buildQueenChip(runLabel, 'queen'));
        card.appendChild(cardHeader);

        const heading = document.createElement('strong');
        heading.className = 'queen-chat-card-preview';
        heading.textContent = run.task_id === 'manual'
            ? run.filename
            : `Task #${run.task_id} · ${run.filename}`;
        card.appendChild(heading);

        const stamp = document.createElement('span');
        stamp.className = 'queen-chat-card-meta';
        stamp.textContent = formatManagedSessionTimestamp(run.timestamp);
        card.appendChild(stamp);

        const meta = document.createElement('span');
        meta.className = 'queen-chat-inline-note';
        const roleLabel = Array.isArray(run.roles) && run.roles.length > 0
            ? run.roles.join(', ')
            : 'unknown';
        meta.textContent = `${run.message_count} messages · ${roleLabel}`;
        card.appendChild(meta);

        card.addEventListener('click', async () => {
            await openQueenTranscript(run, chatState, runList);
        });

        runList.appendChild(card);
    });
}

function resetDirectRunLiveState(chatState) {
    if (!chatState) return;
    chatState.directRunLive = null;
}

function latestDirectRunTranscriptTimestamp(entries) {
    const safeEntries = Array.isArray(entries) ? entries : [];
    for (let index = safeEntries.length - 1; index >= 0; index -= 1) {
        const timestamp = String(safeEntries[index]?.timestamp || '').trim();
        if (timestamp !== '') {
            return timestamp;
        }
    }
    return '';
}

function updateDirectRunLiveState(chatState, patch = {}) {
    if (!chatState || chatState.selectedSession || !chatState.selectedRun?.filename) {
        return;
    }
    const existing = chatState.directRunLive || {
        filename: chatState.selectedRun.filename,
        connected: false,
        connectedAt: '',
        lastHeartbeatAt: '',
        lastEntryAt: latestDirectRunTranscriptTimestamp(chatState.currentTranscriptEntries),
        lastModifiedAt: '',
        readOffset: 0,
        runtimeState: extractDirectRunRuntimeState(chatState.selectedRun),
    };
    const runtimeState = Object.prototype.hasOwnProperty.call(patch, 'runtimeState')
        ? extractDirectRunRuntimeState(patch.runtimeState)
        : existing.runtimeState;
    chatState.directRunLive = {
        ...existing,
        ...patch,
        filename: chatState.selectedRun.filename,
        runtimeState,
    };
    if (chatState.selectedRun && runtimeState) {
        chatState.selectedRun = {
            ...chatState.selectedRun,
            ...runtimeState,
            pending_turn: runtimeState.pending_turn,
            updated_at: runtimeState.updated_at,
            progress_updated_at: runtimeState.progress_updated_at,
            status_reason: runtimeState.status_reason,
            progress_phase: runtimeState.progress_phase,
            progress_tone: runtimeState.progress_tone,
            progress_note: runtimeState.progress_note,
            process_id: runtimeState.process_id,
            process_alive: runtimeState.process_alive,
            worktree_evidence: runtimeState.worktree_evidence,
        };
    }
}

function extractDirectRunRuntimeState(source) {
    if (!source || typeof source !== 'object') {
        return null;
    }

    const status = String(source.status || '').trim();
    const statusReason = String(source.status_reason || source.reason || '').trim();
    const progressPhase = String(source.progress_phase || '').trim();
    const progressTone = String(source.progress_tone || '').trim();
    const progressNote = String(source.progress_note || '').trim();
    const progressUpdatedAt = String(source.progress_updated_at || source.updated_at || '').trim();
    const processId = Number.parseInt(String(source.process_id || 0), 10);
    const processAliveRaw = source.process_alive;
    const processAlive = typeof processAliveRaw === 'boolean' ? processAliveRaw : null;
    const pendingTurn = source.pending_turn && typeof source.pending_turn === 'object'
        ? source.pending_turn
        : null;
    const worktreeEvidence = source.worktree_evidence && typeof source.worktree_evidence === 'object'
        ? source.worktree_evidence
        : null;

    if (
        status === ''
        && statusReason === ''
        && progressPhase === ''
        && progressTone === ''
        && progressNote === ''
        && progressUpdatedAt === ''
        && processId <= 0
        && processAlive === null
        && !pendingTurn
        && !worktreeEvidence
    ) {
        return null;
    }

    return {
        status,
        status_reason: statusReason,
        progress_phase: progressPhase,
        progress_tone: progressTone,
        progress_note: progressNote,
        progress_updated_at: progressUpdatedAt,
        updated_at: progressUpdatedAt,
        process_id: Number.isNaN(processId) ? 0 : Math.max(0, processId),
        process_alive: processAlive,
        pending_turn: pendingTurn,
        worktree_evidence: worktreeEvidence,
    };
}

function shouldAutoFollowSelectedDirectRun(chatState) {
    if (!chatState?.selectedRun?.filename || chatState?.selectedSession || chatState?.newConversationDraft) {
        return false;
    }
    const runtimeStatus = normalizeQueenToken(chatState.selectedRun?.status || '');
    if (['completed', 'failed', 'stopped', 'awaiting_human'].includes(runtimeStatus)) {
        return false;
    }
    if (
        isTerminalDirectRunTranscript(chatState.currentTranscriptEntries)
        || isAwaitingHumanDirectRunTranscript(chatState.currentTranscriptEntries)
    ) {
        return false;
    }

    const selectedFilename = String(chatState.selectedRun.filename || '').trim();
    const latestThreadFilename = String(chatState.selectedThread?.latestRun?.filename || '').trim();
    if (latestThreadFilename !== '' && selectedFilename === latestThreadFilename) {
        return true;
    }
    const latestRunFilename = String(chatState.availableRuns?.[0]?.filename || '').trim();
    return latestRunFilename !== '' && latestRunFilename === selectedFilename;
}

async function openQueenTranscript(run, chatState, runList) {
    if (isQueenChatAuthLost(chatState)) {
        return;
    }
    stopQueenSessionStream();
    resetDirectRunLiveState(chatState);
    chatState.newConversationDraft = false;
    chatState.selectedSession = null;
    chatState.currentTranscriptEntries = [];
    chatState.currentPublicTimelineEntries = [];
    chatState.threadTranscriptCache = {};
    chatState.optimisticPublicMessage = null;
    chatState.pendingHumanReplyPreview = '';
    resetQueenTranscriptExpansionState(chatState);
    stopQueenTranscriptStream(chatState);
    chatState.selectedRun = run;
    chatState.transcriptViewMode = 'run';
    syncSelectedQueenThread(chatState);
    highlightSelectedManagedSession(chatState.listColumn?.__queenManagedSessionList, null);
    syncManagedSessionDetails(chatState);
    syncManagedSessionComposer(chatState);
    if (runList) {
        highlightSelectedRun(runList, run.filename);
    }
    chatState.subtitle.textContent = `${formatManagedSessionTimestamp(run.timestamp)} · ${run.filename}`;
    chatState.following = false;
    syncTranscriptChrome(chatState);

    chatState.transcriptBox.replaceChildren();

    const loading = document.createElement('p');
    loading.className = 'fw-text-muted queen-chat-inline-note';
    loading.dataset.langKey = 'loading';
    loading.textContent = 'Loading...';
    chatState.transcriptBox.appendChild(loading);

    try {
        const entries = await loadQueenTranscriptEntries(run.filename);
        renderQueenTranscript(chatState.transcriptBox, entries, chatState);
        if (shouldAutoFollowSelectedDirectRun(chatState)) {
            startQueenTranscriptFollow(chatState, { suppressDisconnectToast: true });
        }
    } catch (error) {
        if (setQueenChatAuthLostState(chatState, error, 'Queen transcript')) {
            return;
        }
        chatState.transcriptBox.replaceChildren();
        chatState.currentTranscriptEntries = [];
        syncManagedSessionDetails(chatState);
        syncTranscriptChrome(chatState);
        const errorNode = document.createElement('p');
        errorNode.className = 'queen-chat-inline-note';
        errorNode.textContent = error.message || 'Failed to load transcript.';
        errorNode.style.color = 'var(--danger)';
        chatState.transcriptBox.appendChild(errorNode);
        showErrorToast(`Queen transcript failed: ${error.message || error}`);
        return;
    }
    persistQueenChatViewState(chatState);
}

async function openManagedSession(session, chatState, listColumn) {
    if (isQueenChatAuthLost(chatState)) {
        return;
    }
    const matchingThread = findQueenThreadForSession(chatState, session);
    if (matchingThread) {
        await openQueenThread(matchingThread, chatState, listColumn, { preferredSession: session });
        return;
    }

    stopQueenSessionStream();
    resetDirectRunLiveState(chatState);
    stopQueenTranscriptStream(chatState);
    chatState.newConversationDraft = false;
    if (chatState.selectedSession?.id !== session.id) {
        chatState.pendingHumanReplyPreview = '';
    }
    chatState.selectedSession = session;
    highlightSelectedManagedSession(listColumn.__queenManagedSessionList, session.id);
    syncManagedSessionDetails(chatState);
    syncManagedSessionComposer(chatState);

    const transcriptRun = {
        filename: session.transcript_filename,
        timestamp: session.created_at,
        task_id: session.task_id ?? 'manual',
    };

    const runList = listColumn.querySelector('[data-testid="queen-chat-run-list"]');
    await openQueenTranscript(transcriptRun, chatState, runList);

    chatState.selectedSession = session;
    syncSelectedQueenThread(chatState);
    chatState.subtitle.textContent = buildQueenSessionSubtitle(session);
    highlightSelectedManagedSession(listColumn.__queenManagedSessionList, session.id);
    syncManagedSessionDetails(chatState);
    syncManagedSessionComposer(chatState);
    startQueenSessionStream(session.id, chatState, listColumn);
    if (shouldAutoFollowManagedSession(session)) {
        startQueenTranscriptFollow(chatState, { suppressDisconnectToast: true });
    }
    persistQueenChatViewState(chatState);
}

function renderQueenTranscript(container, entries, chatState = null, options = {}) {
    container.replaceChildren();
    container.__queenChatState = chatState;
    if (chatState) {
        chatState.currentTranscriptEntries = Array.isArray(entries) ? [...entries] : [];
        chatState.currentPublicTimelineEntries = [];
        chatState.threadTranscriptCache = {};
        syncManagedSessionDetails(chatState);
        syncTranscriptChrome(chatState);
    }

    if (entries.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'fw-text-muted queen-chat-inline-note';
        empty.dataset.langKey = 'queen_transcript_empty';
        empty.textContent = 'No messages found in this transcript.';
        container.appendChild(empty);
        return;
    }

    entries.forEach((entry, index) => {
        container.appendChild(buildQueenMessageBubble(entry, {
            chatState,
            index,
            total: entries.length,
        }));
    });
    finalizeQueenTranscriptScroll(container, options);
}

async function loadQueenTranscriptEntries(filename) {
    const response = await endpoint_router('queenTranscript', {
        url_params: `?name=${encodeURIComponent(filename)}`,
        suppressAuthRedirect: true,
    });
    return Array.isArray(response?.entries) ? response.entries : [];
}

async function refreshSelectedQueenTranscriptSnapshot(chatState, transcriptFilename) {
    const normalizedFilename = String(transcriptFilename || '').trim();
    if (!chatState || normalizedFilename === '') {
        return;
    }

    const selectedRunFilename = String(chatState.selectedRun?.filename || '').trim();
    if (selectedRunFilename !== normalizedFilename) {
        return;
    }

    const entries = await loadQueenTranscriptEntries(normalizedFilename);
    if (chatState.transcriptViewMode === 'thread' && chatState.selectedThread) {
        chatState.currentTranscriptEntries = [...entries];
        chatState.threadTranscriptCache = {
            ...(chatState.threadTranscriptCache || {}),
            [normalizedFilename]: [...entries],
        };
        rebuildQueenThreadTimelineEntries(chatState);
        renderQueenPublicTimeline(chatState.transcriptBox, buildVisiblePublicTimelineEntries(chatState));
        syncManagedSessionDetails(chatState);
        syncTranscriptChrome(chatState);
        return;
    }

    renderQueenTranscript(chatState.transcriptBox, entries, chatState);
}

function listQueenThreadRuns(chatState, thread) {
    const availableRuns = Array.isArray(chatState?.availableRuns) ? chatState.availableRuns : [];
    const runMap = new Map(availableRuns.map((run) => [run.filename, run]));
    const filenames = Array.isArray(thread?.runFilenames) ? thread.runFilenames : [];
    const collected = [];

    filenames.forEach((filename) => {
        const normalizedFilename = String(filename || '').trim();
        if (normalizedFilename === '') {
            return;
        }
        const knownRun = runMap.get(normalizedFilename);
        if (knownRun) {
            collected.push(knownRun);
            return;
        }
        collected.push({
            filename: normalizedFilename,
            timestamp: '',
            task_id: 'manual',
            thread_id: thread?.threadId || '',
            thread_title: thread?.title || '',
            message_count: 0,
            roles: [],
        });
    });

    const latestRunFilename = String(thread?.latestRun?.filename || '').trim();
    if (latestRunFilename !== '' && !collected.some((run) => run.filename === latestRunFilename)) {
        collected.push(thread.latestRun);
    }

    return collected.sort((left, right) => {
        const leftTimestamp = Date.parse(String(left?.timestamp || ''));
        const rightTimestamp = Date.parse(String(right?.timestamp || ''));
        if (!Number.isNaN(leftTimestamp) && !Number.isNaN(rightTimestamp) && leftTimestamp !== rightTimestamp) {
            return leftTimestamp - rightTimestamp;
        }
        return String(left?.filename || '').localeCompare(String(right?.filename || ''));
    });
}

async function renderQueenThreadTimeline(thread, chatState) {
    const threadRuns = listQueenThreadRuns(chatState, thread);
    const transcriptCache = {};

    for (const run of threadRuns) {
        const filename = String(run?.filename || '').trim();
        if (filename === '') continue;
        transcriptCache[filename] = await loadQueenTranscriptEntries(filename);
    }

    chatState.threadTranscriptCache = transcriptCache;
    const focusRunFilename = String(
        chatState.selectedSession?.transcript_filename
        || chatState.selectedRun?.filename
        || threadRuns.at(-1)?.filename
        || '',
    ).trim();
    chatState.currentTranscriptEntries = Array.isArray(transcriptCache[focusRunFilename])
        ? [...transcriptCache[focusRunFilename]]
        : [];
    chatState.currentPublicTimelineEntries = buildQueenPublicThreadTimeline(threadRuns, transcriptCache, {
        includeInternalAgentTurns: Boolean(chatState?.showInternalAgentTurns),
    });
    chatState.transcriptBox.__queenChatState = chatState;

    renderQueenPublicTimeline(chatState.transcriptBox, buildVisiblePublicTimelineEntries(chatState));
    syncManagedSessionDetails(chatState);
    syncTranscriptChrome(chatState);
}

function rebuildQueenThreadTimelineEntries(chatState) {
    if (!chatState || chatState.transcriptViewMode !== 'thread' || !chatState.selectedThread) {
        return [];
    }

    const threadRuns = listQueenThreadRuns(chatState, chatState.selectedThread);
    const transcriptCache = chatState.threadTranscriptCache && typeof chatState.threadTranscriptCache === 'object'
        ? chatState.threadTranscriptCache
        : {};
    chatState.currentPublicTimelineEntries = buildQueenPublicThreadTimeline(threadRuns, transcriptCache, {
        includeInternalAgentTurns: Boolean(chatState.showInternalAgentTurns),
    });
    chatState.transcriptBox.__queenChatState = chatState;
    return chatState.currentPublicTimelineEntries;
}

function rerenderVisibleQueenThreadTimeline(chatState) {
    if (!chatState || chatState.transcriptViewMode !== 'thread' || !chatState.selectedThread) {
        return;
    }

    rebuildQueenThreadTimelineEntries(chatState);
    renderQueenPublicTimeline(chatState.transcriptBox, buildVisiblePublicTimelineEntries(chatState));
    syncManagedSessionDetails(chatState);
}

function renderQueenPublicTimeline(container, entries, options = {}) {
    container.replaceChildren();
    const chatState = container.__queenChatState || null;

    if (!Array.isArray(entries) || entries.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'fw-text-muted queen-chat-inline-note';
        empty.textContent = 'No conversation messages are available for this thread yet.';
        container.appendChild(empty);
        return;
    }

    entries.forEach((entry, index) => {
        container.appendChild(buildQueenPublicMessageBubble(entry, {
            chatState,
            index,
            total: entries.length,
        }));
    });
    finalizeQueenTranscriptScroll(container, options);
}

function buildQueenPublicMessageBubble(entry, options = {}) {
    const article = document.createElement('article');
    const normalizedRole = normalizeQueenToken(entry?.role);
    article.className = 'queen-chat-message';
    article.dataset.role = normalizedRole;

    const header = document.createElement('div');
    header.className = 'queen-chat-message-top';
    article.appendChild(header);

    const metaGroup = document.createElement('div');
    metaGroup.className = 'queen-chat-message-meta';
    metaGroup.appendChild(buildQueenChip(
        formatQueenLabel(entry?.role || 'unknown'),
        String(entry?.tone || normalizedRole || 'unknown'),
    ));
    if (entry?.internal) {
        metaGroup.appendChild(buildQueenChip('Internal', 'unknown'));
    }
    const agentLabel = String(entry?.agent || '').trim();
    if (agentLabel !== '' && normalizeQueenToken(agentLabel) !== normalizedRole) {
        metaGroup.appendChild(buildQueenChip(formatQueenLabel(agentLabel), normalizedRole === 'worker' ? 'worker' : 'unknown'));
    }
    if (normalizedRole === 'queen') {
        const outcome = getDirectRunOutcome([entry]);
        if (outcome.label !== 'RUNNING') {
            metaGroup.appendChild(buildQueenChip(outcome.label, outcome.tone));
        }
    }
    if (entry?.optimistic) {
        metaGroup.appendChild(buildQueenChip('Queued', 'starting'));
    }
    header.appendChild(metaGroup);

    const timestamp = document.createElement('span');
    timestamp.className = 'queen-chat-card-meta';
    timestamp.textContent = formatManagedSessionTimestamp(entry?.timestamp, '');
    header.appendChild(timestamp);

    appendQueenMessageBody(article, entry, options);

    return article;
}

function setOptimisticPublicMessage(chatState, message) {
    const normalized = String(message?.text || '').trim();
    if (!chatState || normalized === '') {
        if (chatState) {
            chatState.optimisticPublicMessage = null;
        }
        return;
    }

    chatState.optimisticPublicMessage = {
        text: normalized,
        timestamp: String(message?.timestamp || new Date().toISOString()),
        threadKey: String(message?.threadKey || '').trim(),
    };
}

function buildVisiblePublicTimelineEntries(chatState) {
    const baseEntries = Array.isArray(chatState?.currentPublicTimelineEntries)
        ? [...chatState.currentPublicTimelineEntries]
        : [];
    const optimistic = chatState?.optimisticPublicMessage || null;

    if (!chatState || chatState.transcriptViewMode !== 'thread' || !chatState.selectedThread || !optimistic) {
        return baseEntries;
    }
    if (optimistic.threadKey !== String(chatState.selectedThread.key || '').trim()) {
        return baseEntries;
    }

    const normalizedText = String(optimistic.text || '').trim();
    const alreadyPresent = baseEntries.some((entry) => (
        String(entry?.role || '').trim().toLowerCase() === 'human' &&
        String(entry?.text || '').trim() === normalizedText
    ));
    if (alreadyPresent) {
        chatState.optimisticPublicMessage = null;
        return baseEntries;
    }

    return [
        ...baseEntries,
        {
            role: 'human',
            tone: 'human',
            text: normalizedText,
            timestamp: optimistic.timestamp,
            optimistic: true,
        },
    ];
}

function buildQueenMessageBubble(entry, options = {}) {
    const article = document.createElement('article');
    const normalizedRole = normalizeQueenToken(entry.role);
    article.className = 'queen-chat-message';
    article.dataset.role = normalizedRole;

    const header = document.createElement('div');
    header.className = 'queen-chat-message-top';
    article.appendChild(header);

    const metaGroup = document.createElement('div');
    metaGroup.className = 'queen-chat-message-meta';
    const role = entry.role || 'unknown';
    const agent = entry.agent || 'unknown';
    metaGroup.appendChild(buildQueenChip(formatQueenLabel(role), normalizedRole));
    metaGroup.appendChild(buildQueenChip(agent, 'unknown'));
    if (normalizedRole === 'queen') {
        const outcome = getDirectRunOutcome([entry]);
        if (outcome.label !== 'RUNNING') {
            metaGroup.appendChild(buildQueenChip(outcome.label, outcome.tone));
        }
    }

    const turnLabel = document.createElement('span');
    turnLabel.className = 'queen-chat-card-meta';
    turnLabel.textContent = `Turn ${entry.turn ?? '?'}`;
    metaGroup.appendChild(turnLabel);
    header.appendChild(metaGroup);

    const timestamp = document.createElement('span');
    timestamp.className = 'queen-chat-card-meta';
    timestamp.textContent = formatManagedSessionTimestamp(entry?.timestamp, '');
    header.appendChild(timestamp);

    appendQueenMessageBody(article, entry, options);

    return article;
}

function appendQueenMessageBody(article, entry, options = {}) {
    const chatState = options?.chatState || null;
    const index = Number.parseInt(String(options?.index ?? -1), 10);
    const total = Number.parseInt(String(options?.total ?? 0), 10);
    const collapsible = Boolean(chatState) && shouldAutoCollapseQueenMessage(index, total);
    const messageKey = collapsible ? buildQueenTranscriptMessageKey(entry, index, chatState) : '';
    const expanded = collapsible && chatState?.expandedTranscriptMessageKeys?.has(messageKey);
    const transcriptSummary = buildQueenTranscriptSummary(entry);

    if (messageKey !== '') {
        article.dataset.queenMessageKey = messageKey;
    }

    if (Array.isArray(transcriptSummary?.chips) && transcriptSummary.chips.length > 0) {
        const summaryRow = document.createElement('div');
        summaryRow.className = 'queen-chat-message-summary';
        transcriptSummary.chips.forEach((chip) => {
            const label = String(chip?.label || '').trim();
            if (label === '') return;
            summaryRow.appendChild(buildQueenChip(label, String(chip?.tone || 'unknown')));
        });
        article.appendChild(summaryRow);
    }

    if (String(transcriptSummary?.note || '').trim() !== '') {
        const summaryNote = document.createElement('div');
        summaryNote.className = 'queen-chat-message-summary-note';
        summaryNote.textContent = transcriptSummary.note;
        article.appendChild(summaryNote);
    }

    const body = document.createElement('pre');
    body.className = 'queen-chat-message-body';
    if (collapsible && !expanded) {
        body.classList.add('queen-chat-message-body--collapsed');
    }
    // Keep the collapsed preview lightweight, but once the user opens the
    // message we should render the original transcript text without trimming.
    body.textContent = formatQueenTranscriptDisplayText(entry, {
        condensed: collapsible && !expanded,
    });
    article.appendChild(body);

    if (collapsible && messageKey !== '') {
        const toggleButton = document.createElement('button');
        toggleButton.type = 'button';
        toggleButton.className = 'button button--small queen-chat-message-expand';
        toggleButton.textContent = expanded ? 'Show less' : 'Show full message';
        toggleButton.addEventListener('click', () => {
            toggleQueenTranscriptMessageExpansion(chatState, messageKey);
        });
        article.appendChild(toggleButton);
    }

    const debugText = getQueenTranscriptDebugText(entry);
    if (debugText === '') {
        return;
    }

    const debugDetails = document.createElement('details');
    debugDetails.className = 'queen-chat-message-debug';

    const debugSummary = document.createElement('summary');
    debugSummary.className = 'queen-chat-message-debug-toggle';
    debugSummary.textContent = buildQueenDebugToggleLabel(entry);
    debugDetails.appendChild(debugSummary);

    const debugBody = document.createElement('pre');
    debugBody.className = 'queen-chat-message-body queen-chat-message-body--debug';
    debugBody.textContent = debugText;
    debugDetails.appendChild(debugBody);

    article.appendChild(debugDetails);
}

function buildQueenDebugToggleLabel(entry) {
    return normalizeQueenToken(entry?.role) === 'controller'
        ? 'Show full controller prompt'
        : 'Show full internal message';
}

function buildQueenTranscriptMessageKey(entry, index, chatState) {
    const scope = chatState?.transcriptViewMode === 'thread'
        ? `thread:${String(chatState?.selectedThread?.key || '').trim()}`
        : `run:${String(chatState?.selectedRun?.filename || '').trim()}`;
    return [
        scope,
        String(entry?.runFilename || '').trim(),
        String(entry?.turn ?? ''),
        String(entry?.timestamp || '').trim(),
        String(entry?.role || '').trim(),
        String(entry?.agent || '').trim(),
        String(index),
    ].join('|');
}

function resetQueenTranscriptExpansionState(chatState) {
    if (!chatState) return;
    chatState.expandedTranscriptMessageKeys = new Set();
}

function finalizeQueenTranscriptScroll(container, options = {}) {
    if (restoreQueenTranscriptScrollAnchor(container, options?.preserveScrollAnchor)) {
        return;
    }
    if (options?.scrollToBottom === false) {
        return;
    }
    container.scrollTop = container.scrollHeight;
}

function findQueenTranscriptMessageElement(container, messageKey) {
    if (!container || String(messageKey || '').trim() === '') {
        return null;
    }
    return Array.from(container.querySelectorAll('[data-queen-message-key]')).find(
        (node) => node.dataset.queenMessageKey === messageKey,
    ) || null;
}

function captureQueenTranscriptScrollAnchor(container, messageKey) {
    const anchorElement = findQueenTranscriptMessageElement(container, messageKey);
    if (!anchorElement) {
        return null;
    }
    const containerTop = container.getBoundingClientRect().top;
    return {
        messageKey,
        scrollTop: container.scrollTop,
        viewportOffset: anchorElement.getBoundingClientRect().top - containerTop,
    };
}

function restoreQueenTranscriptScrollAnchor(container, anchorState) {
    if (!container || !anchorState || String(anchorState.messageKey || '').trim() === '') {
        return false;
    }

    container.scrollTop = Number(anchorState.scrollTop) || 0;
    const anchorElement = findQueenTranscriptMessageElement(container, anchorState.messageKey);
    if (!anchorElement) {
        return false;
    }

    const containerTop = container.getBoundingClientRect().top;
    const currentViewportOffset = anchorElement.getBoundingClientRect().top - containerTop;
    container.scrollTop += currentViewportOffset - (Number(anchorState.viewportOffset) || 0);
    return true;
}

function toggleQueenTranscriptMessageExpansion(chatState, messageKey) {
    if (!chatState || String(messageKey || '').trim() === '') {
        return;
    }
    // Message expansion rerenders the transcript tree, so preserve the clicked
    // message's viewport anchor instead of reusing live-follow autoscroll.
    const scrollAnchor = captureQueenTranscriptScrollAnchor(chatState.transcriptBox, messageKey);
    if (!(chatState.expandedTranscriptMessageKeys instanceof Set)) {
        chatState.expandedTranscriptMessageKeys = new Set();
    }
    if (chatState.expandedTranscriptMessageKeys.has(messageKey)) {
        chatState.expandedTranscriptMessageKeys.delete(messageKey);
    } else {
        chatState.expandedTranscriptMessageKeys.add(messageKey);
    }

    if (chatState.transcriptViewMode === 'thread' && chatState.selectedThread) {
        renderQueenPublicTimeline(
            chatState.transcriptBox,
            buildVisiblePublicTimelineEntries(chatState),
            { preserveScrollAnchor: scrollAnchor, scrollToBottom: false },
        );
        return;
    }
    renderQueenTranscript(
        chatState.transcriptBox,
        chatState.currentTranscriptEntries,
        chatState,
        { preserveScrollAnchor: scrollAnchor, scrollToBottom: false },
    );
}

function highlightSelectedRun(runList, filename) {
    if (!runList) return;
    runList.querySelectorAll('[data-run-filename]').forEach((button) => {
        button.classList.toggle('is-selected', button.dataset.runFilename === filename);
    });
}

function highlightSelectedThread(threadList, threadKey) {
    if (!threadList) return;
    threadList.querySelectorAll('[data-thread-key]').forEach((card) => {
        card.classList.toggle('is-selected', card.dataset.threadKey === threadKey);
    });
}

function highlightSelectedManagedSession(sessionList, sessionID) {
    if (!sessionList) return;
    sessionList.querySelectorAll('[data-session-id]').forEach((card) => {
        applyManagedSessionSelection(card, card.dataset.sessionId === sessionID);
    });
}

function applyManagedSessionSelection(card, isSelected) {
    if (!card) return;
    card.classList.toggle('is-selected', Boolean(isSelected));
}

async function openQueenThread(thread, chatState, listColumn, options = {}) {
    return openQueenThreadWithOptions(thread, chatState, listColumn, options);
}

function syncSelectedQueenThread(chatState) {
    if (!chatState) return;
    const availableThreads = Array.isArray(chatState.availableThreads) ? chatState.availableThreads : [];
    let nextSelectedThread = null;

    const selectedSessionThreadID = String(chatState.selectedSession?.thread_id || '').trim();
    if (selectedSessionThreadID !== '') {
        nextSelectedThread = availableThreads.find((thread) => thread.threadId === selectedSessionThreadID) || null;
    }

    if (!nextSelectedThread) {
        const selectedRunThreadID = String(chatState.selectedRun?.thread_id || '').trim();
        if (selectedRunThreadID !== '') {
            nextSelectedThread = availableThreads.find((thread) => thread.threadId === selectedRunThreadID) || null;
        }
    }

    if (!nextSelectedThread) {
        const selectedRunFilename = String(
            chatState.selectedSession?.transcript_filename
            || chatState.selectedRun?.filename
            || '',
        ).trim();
        if (selectedRunFilename !== '') {
            nextSelectedThread = availableThreads.find((thread) => thread.runFilenames.includes(selectedRunFilename))
                || availableThreads.find((thread) => thread.latestRun?.filename === selectedRunFilename)
                || null;
        }
    }

    if (!nextSelectedThread && chatState.selectedThread?.key) {
        nextSelectedThread = availableThreads.find((thread) => thread.key === chatState.selectedThread.key) || null;
    }

    chatState.selectedThread = nextSelectedThread;
    highlightSelectedThread(chatState.listColumn?.__queenThreadList, nextSelectedThread?.key || null);
}

function findQueenThreadForSession(chatState, session) {
    const availableThreads = Array.isArray(chatState?.availableThreads) ? chatState.availableThreads : [];
    const threadID = String(session?.thread_id || '').trim();
    if (threadID !== '') {
        return availableThreads.find((thread) => thread.threadId === threadID) || null;
    }
    const transcriptFilename = String(session?.transcript_filename || '').trim();
    if (transcriptFilename !== '') {
        return availableThreads.find((thread) => thread.runFilenames.includes(transcriptFilename))
            || availableThreads.find((thread) => thread.latestRun?.filename === transcriptFilename)
            || null;
    }
    return null;
}

async function openQueenThreadWithOptions(thread, chatState, listColumn, options = {}) {
    if (!thread) return;
    if (isQueenChatAuthLost(chatState)) {
        return;
    }

    const preferredSession = options.preferredSession || thread.activeSession || thread.latestSession || null;
    const previousSessionID = chatState.selectedSession?.id || '';
    stopQueenSessionStream();
    resetDirectRunLiveState(chatState);
    stopQueenTranscriptStream(chatState);

    chatState.newConversationDraft = false;
    if (previousSessionID !== String(preferredSession?.id || '')) {
        chatState.pendingHumanReplyPreview = '';
    }
    chatState.selectedThread = thread;
    chatState.selectedSession = preferredSession;
    chatState.selectedRun = preferredSession?.transcript_filename
        ? {
            filename: preferredSession.transcript_filename,
            timestamp: preferredSession.created_at || thread.latestRun?.timestamp || '',
            task_id: preferredSession.task_id ?? thread.latestRun?.task_id ?? 'manual',
            thread_id: preferredSession.thread_id || thread.threadId || '',
            thread_title: preferredSession.thread_title || thread.title || '',
        }
        : (thread.latestRun || null);
    chatState.currentTranscriptEntries = [];
    chatState.currentPublicTimelineEntries = [];
    chatState.threadTranscriptCache = {};
    resetQueenTranscriptExpansionState(chatState);
    chatState.transcriptViewMode = 'thread';

    highlightSelectedThread(listColumn?.__queenThreadList, thread.key);
    highlightSelectedManagedSession(listColumn?.__queenManagedSessionList, preferredSession?.id || null);
    highlightSelectedRun(
        listColumn?.querySelector('[data-testid="queen-chat-run-list"]'),
        chatState.selectedRun?.filename || null,
    );

    chatState.subtitle.textContent = `${thread.title || 'Queen conversation'} · ${thread.runCount === 1 ? '1 run' : `${thread.runCount} runs`}`;
    syncManagedSessionDetails(chatState);
    syncManagedSessionComposer(chatState);
    syncTranscriptChrome(chatState);

    chatState.transcriptBox.replaceChildren();
    const loading = document.createElement('p');
    loading.className = 'fw-text-muted queen-chat-inline-note';
    loading.dataset.langKey = 'loading';
    loading.textContent = 'Loading...';
    chatState.transcriptBox.appendChild(loading);

    try {
        await renderQueenThreadTimeline(thread, chatState);
    } catch (error) {
        if (setQueenChatAuthLostState(chatState, error, 'Queen thread transcript')) {
            return;
        }
        chatState.transcriptBox.replaceChildren();
        chatState.currentTranscriptEntries = [];
        chatState.currentPublicTimelineEntries = [];
        chatState.threadTranscriptCache = {};
        syncManagedSessionDetails(chatState);
        syncTranscriptChrome(chatState);
        const errorNode = document.createElement('p');
        errorNode.className = 'queen-chat-inline-note';
        errorNode.textContent = error.message || 'Failed to load conversation thread.';
        errorNode.style.color = 'var(--danger)';
        chatState.transcriptBox.appendChild(errorNode);
        showErrorToast(`Queen thread failed: ${error.message || error}`);
        return;
    }

    if (preferredSession?.id) {
        startQueenSessionStream(preferredSession.id, chatState, listColumn);
        if (shouldAutoFollowManagedSession(preferredSession)) {
            startQueenTranscriptFollow(chatState, { suppressDisconnectToast: true });
        }
    } else if (shouldAutoFollowSelectedDirectRun(chatState)) {
        startQueenTranscriptFollow(chatState, { suppressDisconnectToast: true });
    }
    persistQueenChatViewState(chatState);
}

function startQueenTranscriptFollow(chatState, options = {}) {
    if (!chatState?.selectedRun || isQueenChatAuthLost(chatState)) return;

    const { suppressDisconnectToast = false } = options;
    stopQueenTranscriptStream(chatState);
    const streamUrl = `${get_endpoint_url('queenTranscriptStream')}?name=${encodeURIComponent(chatState.selectedRun.filename)}`;
    const eventSource = new EventSource(streamUrl);
    activeTranscriptStream = eventSource;
    chatState.following = true;
    if (!chatState.selectedSession) {
        updateDirectRunLiveState(chatState, {
            connected: false,
            connectedAt: '',
            lastHeartbeatAt: '',
            lastEntryAt: latestDirectRunTranscriptTimestamp(chatState.currentTranscriptEntries),
            lastModifiedAt: '',
            readOffset: 0,
        });
    }
    syncTranscriptChrome(chatState);

    eventSource.addEventListener('ready', (event) => {
        if (chatState.selectedSession) {
            return;
        }
        try {
            const payload = JSON.parse(event.data);
            const serverTime = String(payload?.server_time || new Date().toISOString());
            updateDirectRunLiveState(chatState, {
                connected: true,
                connectedAt: serverTime,
                lastHeartbeatAt: serverTime,
                lastModifiedAt: String(payload?.modified_at || ''),
                readOffset: Number(payload?.read_offset || 0),
                runtimeState: payload?.runtime_state || null,
            });
            if (shouldDetachStaleDirectRunFollow(chatState.directRunLive, serverTime)) {
                stopQueenTranscriptStream(chatState);
                syncManagedSessionDetails(chatState);
                return;
            }
            syncManagedSessionDetails(chatState);
            syncTranscriptChrome(chatState);
        } catch (error) {
            console.warn('Failed to parse Queen transcript ready event:', error);
        }
    });

    eventSource.addEventListener('heartbeat', (event) => {
        if (chatState.selectedSession) {
            return;
        }
        try {
            const payload = JSON.parse(event.data);
            const serverTime = String(payload?.server_time || new Date().toISOString());
            updateDirectRunLiveState(chatState, {
                connected: true,
                lastHeartbeatAt: serverTime,
                lastModifiedAt: String(payload?.modified_at || ''),
                readOffset: Number(payload?.read_offset || 0),
                runtimeState: payload?.runtime_state || null,
            });
            if (shouldDetachStaleDirectRunFollow(chatState.directRunLive, serverTime)) {
                stopQueenTranscriptStream(chatState);
                syncManagedSessionDetails(chatState);
                return;
            }
            syncManagedSessionDetails(chatState);
            syncTranscriptChrome(chatState);
        } catch (error) {
            console.warn('Failed to parse Queen transcript heartbeat event:', error);
        }
    });

    eventSource.addEventListener('entry', (event) => {
        try {
            const entry = JSON.parse(event.data);
            if (!Array.isArray(chatState.currentTranscriptEntries)) {
                chatState.currentTranscriptEntries = [];
            }
            chatState.currentTranscriptEntries.push(entry);
            const selectedRunFilename = String(chatState.selectedRun?.filename || '').trim();
            if (chatState.transcriptViewMode === 'thread' && selectedRunFilename !== '') {
                const nextCache = {
                    ...(chatState.threadTranscriptCache || {}),
                    [selectedRunFilename]: [...chatState.currentTranscriptEntries],
                };
                chatState.threadTranscriptCache = nextCache;
                rebuildQueenThreadTimelineEntries(chatState);
                renderQueenPublicTimeline(chatState.transcriptBox, buildVisiblePublicTimelineEntries(chatState));
            } else {
                renderQueenTranscript(chatState.transcriptBox, chatState.currentTranscriptEntries, chatState);
            }
            if (entry?.role === 'human') {
                chatState.pendingHumanReplyPreview = '';
                if (
                    chatState.optimisticPublicMessage &&
                    String(entry?.text || '').trim() === String(chatState.optimisticPublicMessage.text || '').trim()
                ) {
                    chatState.optimisticPublicMessage = null;
                }
            }
            if (!chatState.selectedSession) {
                updateDirectRunLiveState(chatState, {
                    connected: true,
                    lastHeartbeatAt: new Date().toISOString(),
                    lastEntryAt: String(entry?.timestamp || new Date().toISOString()),
                });
            }
            syncManagedSessionDetails(chatState);
            syncTranscriptChrome(chatState);
            if (!chatState.selectedSession && isTerminalDirectRunTranscript(chatState.currentTranscriptEntries)) {
                stopQueenTranscriptStream(chatState);
            }
        } catch (error) {
            console.warn('Failed to parse Queen transcript entry:', error);
        }
    });

    eventSource.addEventListener('error', () => {
        void handleQueenTranscriptStreamError(chatState, suppressDisconnectToast);
    });
}

async function handleQueenTranscriptStreamError(chatState, suppressDisconnectToast = false) {
    if (!chatState) {
        return;
    }
    if (!chatState.selectedSession) {
        updateDirectRunLiveState(chatState, {
            connected: false,
            lastHeartbeatAt: new Date().toISOString(),
        });
    }
    stopQueenTranscriptStream(chatState);
    const authLost = await probeQueenChatAuthLoss(chatState, 'Queen transcript stream');
    if (authLost) {
        return;
    }
    if (!suppressDisconnectToast) {
        showErrorToast('Queen transcript live stream disconnected.');
    }
}

function stopQueenTranscriptStream(chatState) {
    if (activeTranscriptStream) {
        activeTranscriptStream.close();
        activeTranscriptStream = null;
    }
    if (!chatState) return;
    chatState.following = false;
    if (chatState.directRunLive && !chatState.selectedSession) {
        chatState.directRunLive = {
            ...chatState.directRunLive,
            connected: false,
        };
    }
    syncTranscriptChrome(chatState);
}

function startQueenSessionStream(sessionID, chatState, listColumn) {
    if (isQueenChatAuthLost(chatState)) {
        return;
    }
    const streamUrl = `${get_endpoint_url('queenSessionStream')}?id=${encodeURIComponent(sessionID)}`;
    const eventSource = new EventSource(streamUrl);
    activeSessionStream = eventSource;

    eventSource.addEventListener('session', (event) => {
        void handleQueenSessionSnapshotEvent(event, chatState, listColumn);
    });

    eventSource.addEventListener('error', () => {
        void handleQueenSessionStreamError(chatState);
    });
}

async function handleQueenSessionStreamError(chatState) {
    stopQueenSessionStream();
    await probeQueenChatAuthLoss(chatState, 'Queen session stream');
}

async function handleQueenSessionSnapshotEvent(event, chatState, listColumn) {
    try {
        const session = JSON.parse(event.data);
        chatState.selectedSession = session;
        syncSelectedQueenThread(chatState);
        if (chatState.transcriptViewMode === 'thread' && chatState.selectedThread) {
            chatState.subtitle.textContent = `${chatState.selectedThread.title || 'Queen conversation'} · ${chatState.selectedThread.runCount === 1 ? '1 run' : `${chatState.selectedThread.runCount} runs`}`;
        } else {
            chatState.subtitle.textContent = buildQueenSessionSubtitle(session);
        }
        highlightSelectedManagedSession(listColumn?.__queenManagedSessionList, session.id);
        syncManagedSessionDetails(chatState);
        syncManagedSessionComposer(chatState);
        syncTranscriptChrome(chatState);

        if (isTerminalManagedSessionStatus(session.status)) {
            stopQueenSessionStream();
            if (chatState.following) {
                stopQueenTranscriptStream(chatState);
            }
            if (shouldRefreshTerminalSessionTranscriptSnapshot(session, chatState.selectedRun?.filename)) {
                await refreshSelectedQueenTranscriptSnapshot(chatState, session.transcript_filename);
            }
            await loadManagedSessions(listColumn, chatState);
            await loadQueenRuns(listColumn, chatState);
            return;
        }

        void loadManagedSessions(listColumn, chatState);
        if (
            shouldAutoFollowManagedSession(session) &&
            !chatState.following &&
            chatState.selectedRun?.filename === session.transcript_filename
        ) {
            startQueenTranscriptFollow(chatState, { suppressDisconnectToast: true });
        }
    } catch (error) {
        if (setQueenChatAuthLostState(chatState, error, 'Queen session snapshot')) {
            return;
        }
        console.warn('Failed to parse Queen session event:', error);
    }
}

function stopQueenSessionStream() {
    if (activeSessionStream) {
        activeSessionStream.close();
        activeSessionStream = null;
    }
}

function buildQueenSessionInput(labelText, testId) {
    const input = document.createElement('input');
    input.className = 'fw-form-control';
    input.type = 'text';
    input.placeholder = labelText;
    input.dataset.testid = testId;
    return input;
}

function beginNewConversation(chatState) {
    if (!chatState || isQueenChatAuthLost(chatState)) return;
    stopQueenSessionStream();
    resetDirectRunLiveState(chatState);
    stopQueenTranscriptStream(chatState);
    chatState.newConversationDraft = true;
    chatState.selectedSession = null;
    chatState.selectedRun = null;
    chatState.selectedThread = null;
    chatState.currentTranscriptEntries = [];
    chatState.currentPublicTimelineEntries = [];
    chatState.threadTranscriptCache = {};
    chatState.optimisticPublicMessage = null;
    chatState.pendingHumanReplyPreview = '';
    chatState.transcriptViewMode = 'idle';
    highlightSelectedManagedSession(chatState.listColumn?.__queenManagedSessionList, null);
    highlightSelectedThread(chatState.listColumn?.__queenThreadList, null);
    highlightSelectedRun(chatState.listColumn?.querySelector('[data-testid="queen-chat-run-list"]'), null);
    if (chatState.transcriptBox) {
        chatState.transcriptBox.replaceChildren();
        const empty = document.createElement('p');
        empty.className = 'fw-text-muted queen-chat-inline-note';
        empty.textContent = 'Starting a new conversation. Write the opening message below.';
        chatState.transcriptBox.appendChild(empty);
    }
    if (chatState.subtitle) {
        chatState.subtitle.textContent = 'New conversation draft';
    }
    syncManagedSessionDetails(chatState);
    syncManagedSessionComposer(chatState);
    syncTranscriptChrome(chatState);
    chatState.humanMessageInput?.focus();
    persistQueenChatViewState(chatState);
}

function cancelNewConversation(chatState) {
    if (isQueenChatAuthLost(chatState) || !chatState?.newConversationDraft) {
        return;
    }
    chatState.newConversationDraft = false;
    resetNewConversationDraftFields(chatState);
    if (chatState.subtitle) {
        chatState.subtitle.textContent = 'Select a run from the left to inspect its transcript.';
    }
    if (chatState.transcriptBox) {
        chatState.transcriptBox.replaceChildren();
        const empty = document.createElement('p');
        empty.className = 'fw-text-muted queen-chat-inline-note';
        empty.dataset.langKey = 'queen_chat_empty_state';
        empty.textContent = 'No transcript selected yet.';
        chatState.transcriptBox.appendChild(empty);
    }
    chatState.currentTranscriptEntries = [];
    chatState.currentPublicTimelineEntries = [];
    chatState.selectedThread = null;
    chatState.threadTranscriptCache = {};
    chatState.optimisticPublicMessage = null;
    chatState.transcriptViewMode = 'idle';
    highlightSelectedThread(chatState.listColumn?.__queenThreadList, null);
    syncManagedSessionDetails(chatState);
    syncManagedSessionComposer(chatState);
    syncTranscriptChrome(chatState);
    persistQueenChatViewState(chatState);
}

function resetNewConversationDraftFields(chatState) {
    if (chatState?.humanMessageInput) {
        chatState.humanMessageInput.value = '';
    }
    if (chatState?.newConversationTaskIdInput) {
        chatState.newConversationTaskIdInput.value = '';
    }
    if (chatState?.newConversationMaxTurnsInput) {
        chatState.newConversationMaxTurnsInput.value = '20';
    }
}

async function startManagedSession(listColumn, chatState, options = {}) {
    if (isQueenChatAuthLost(chatState)) {
        return;
    }
    if (listColumn.__queenSessionStartPending) {
        return;
    }

    const composerMode = String(options.mode || 'new_session');
    const rawMessage = String(options.message ?? chatState.humanMessageInput?.value ?? '').trim();
    if (!rawMessage) {
        showErrorToast('Queen session prompt is required.');
        return;
    }

    const prompt = composerMode === 'continue_ready'
        ? buildQueenContinuationPrompt(chatState, rawMessage)
        : rawMessage;

    const taskIdValue = String(chatState.newConversationTaskIdInput?.value || '').trim();
    const maxTurnsValue = String(chatState.newConversationMaxTurnsInput?.value || '').trim();
    const maxTurns = Number.parseInt(maxTurnsValue || '20', 10);
    if (!Number.isInteger(maxTurns) || maxTurns < 1) {
        showErrorToast('Max turns must be a whole number greater than zero.');
        return;
    }

    const body = {
        prompt,
        max_turns: maxTurns,
        title_hint: composerMode === 'continue_ready'
            ? String(chatState.selectedThread?.title || rawMessage)
            : rawMessage,
    };
    if (taskIdValue !== '') {
        const taskID = Number.parseInt(taskIdValue, 10);
        if (!Number.isInteger(taskID) || taskID < 1) {
            showErrorToast('Task ID must be a whole number greater than zero.');
            return;
        }
        body.task_id = taskID;
    }
    if (composerMode === 'continue_ready') {
        const selectedThreadID = String(chatState.selectedThread?.threadId || '').trim();
        const continueFromRunFilename = String(
            chatState.selectedRun?.filename
            || chatState.selectedThread?.latestRun?.filename
            || '',
        ).trim();
        if (selectedThreadID !== '') {
            body.thread_id = selectedThreadID;
        }
        if (continueFromRunFilename !== '') {
            body.continue_from_run_filename = continueFromRunFilename;
        }
    }

    try {
        setManagedSessionStartPending(listColumn, true);
        setManagedSessionComposerPending(chatState, true, composerMode);
        const response = await endpoint_router('queenSessions', {
            method: 'POST',
            body_data: body,
            suppressAuthRedirect: true,
        });
        const session = response?.session ?? response;
        setOptimisticPublicMessage(chatState, {
            text: rawMessage,
            threadKey: String(session?.thread_id || `run:${session?.transcript_filename || ''}`),
        });
        showInfoToast(composerMode === 'continue_ready'
            ? 'Queen continuation started from the selected conversation.'
            : 'Queen session started.');
        chatState.newConversationDraft = false;
        resetNewConversationDraftFields(chatState);
        await loadManagedSessions(listColumn, chatState);
        await loadQueenRuns(listColumn, chatState);
        await openManagedSession(session, chatState, listColumn);
        persistQueenChatViewState(chatState);
    } catch (error) {
        if (setQueenChatAuthLostState(chatState, error, 'Queen session start')) {
            return;
        }
        showErrorToast(`Could not start Queen session: ${error.message || error}`);
    } finally {
        setManagedSessionComposerPending(chatState, false);
        setManagedSessionStartPending(listColumn, false);
    }
}

async function stopManagedSession(sessionID, listColumn, chatState) {
    try {
        await endpoint_router('stopQueenSession', {
            method: 'POST',
            body_data: { id: sessionID },
            suppressAuthRedirect: true,
        });
        showInfoToast('Queen session stop requested.');
        await loadManagedSessions(listColumn, chatState);
    } catch (error) {
        if (setQueenChatAuthLostState(chatState, error, 'Queen session stop')) {
            return;
        }
        showErrorToast(`Could not stop Queen session: ${error.message || error}`);
    }
}

async function sendManagedSessionHumanMessage(chatState) {
    if (isQueenChatAuthLost(chatState)) {
        return;
    }
    const composerMode = getQueenComposerMode(chatState);
    if (composerMode === 'new_session') {
        if (!chatState.listColumn) {
            showErrorToast('Queen conversation controls are not available right now.');
            return;
        }
        await startManagedSession(chatState.listColumn, chatState);
        return;
    }

    if (composerMode === 'continue_ready') {
        if (!chatState.listColumn) {
            showErrorToast('Queen conversation controls are not available right now.');
            return;
        }
        const continuationMessage = String(chatState.humanMessageInput?.value || '').trim();
        if (!continuationMessage) {
            showErrorToast('Continuation message is required.');
            return;
        }
        await startManagedSession(chatState.listColumn, chatState, {
            mode: 'continue_ready',
            message: continuationMessage,
        });
        return;
    }

    const selectedSession = chatState.selectedSession;
    const canAcceptHumanFollowup = canReplyToManagedSession(selectedSession);
    if (!canAcceptHumanFollowup) {
        showErrorToast('Choose a conversation from the left, or click New Conversation to start a fresh one.');
        syncManagedSessionComposer(chatState);
        return;
    }

    const message = String(chatState.humanMessageInput?.value || '').trim();
    if (!message) {
        showErrorToast('Follow-up message is required.');
        return;
    }

    try {
        setManagedSessionComposerPending(chatState, true, 'reply_ready');
        const response = await endpoint_router('queenSessionMessage', {
            method: 'POST',
            body_data: {
                id: selectedSession.id,
                message,
            },
            suppressAuthRedirect: true,
        });
        chatState.pendingHumanReplyPreview = message;
        chatState.selectedSession = response?.session ?? selectedSession;
        setOptimisticPublicMessage(chatState, {
            text: message,
            threadKey: String(chatState.selectedThread?.key || chatState.selectedSession?.thread_id || ''),
        });
        chatState.humanMessageInput.value = '';
        if (chatState.transcriptViewMode === 'thread') {
            renderQueenPublicTimeline(chatState.transcriptBox, buildVisiblePublicTimelineEntries(chatState));
        }
        persistQueenChatViewState(chatState);
        syncManagedSessionDetails(chatState);
        syncManagedSessionComposer(chatState);
        syncTranscriptChrome(chatState);
        showInfoToast('Human reply sent. Queen is resuming.');
        if (chatState.listColumn) {
            await loadManagedSessions(chatState.listColumn, chatState);
        }
        if (chatState.selectedRun && !chatState.following) {
            startQueenTranscriptFollow(chatState, { suppressDisconnectToast: true });
        }
    } catch (error) {
        if (setQueenChatAuthLostState(chatState, error, 'Queen follow-up submit')) {
            return;
        }
        const errorMessage = String(error?.message || error || '');
        if (errorMessage.toLowerCase().includes('not awaiting human')) {
            showInfoToast('Queen is no longer awaiting human input. Refreshing session state.');
            if (chatState.listColumn) {
                await loadManagedSessions(chatState.listColumn, chatState);
            }
            syncManagedSessionComposer(chatState);
            return;
        }
        showErrorToast(`Could not queue follow-up: ${errorMessage}`);
    } finally {
        setManagedSessionComposerPending(chatState, false);
    }
}

function truncateQueenText(text, maxLength) {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxLength) {
        return normalized;
    }
    return normalized.slice(0, maxLength - 1) + '…';
}

function buildQueenChip(text, tone = 'unknown') {
    const chip = document.createElement('span');
    chip.className = 'queen-chat-chip';
    chip.dataset.tone = tone;
    chip.textContent = text;
    return chip;
}

function syncTranscriptChrome(chatState) {
    if (!chatState) return;
    syncQueenAuthLossUI(chatState);
    const entries = chatState.transcriptViewMode === 'thread'
        ? buildVisiblePublicTimelineEntries(chatState)
        : (Array.isArray(chatState.currentTranscriptEntries) ? chatState.currentTranscriptEntries : []);
    if (chatState.transcriptCountChip) {
        chatState.transcriptCountChip.textContent = entries.length === 1 ? '1 message' : `${entries.length} messages`;
        chatState.transcriptCountChip.dataset.tone = entries.length > 0 ? 'queen' : 'unknown';
    }
    if (chatState.transcriptModeChip) {
        const { label, tone } = buildTranscriptModeSummary(chatState);
        chatState.transcriptModeChip.textContent = label;
        chatState.transcriptModeChip.dataset.tone = tone;
    }
    if (chatState.terminalHint) {
        chatState.terminalHint.textContent = buildTerminalHandoffHint(chatState);
    }
    syncThreadTimelineToggle(chatState);
    syncQueenProcessingIndicator(chatState);
}

function buildTranscriptModeSummary(chatState) {
    if (isQueenChatAuthLost(chatState)) {
        return { label: 'Re-login required', tone: 'failed' };
    }
    if (chatState?.newConversationDraft) {
        return { label: 'New conversation', tone: 'starting' };
    }
    if (chatState?.transcriptViewMode === 'thread' && chatState?.selectedThread) {
        if (chatState.following) {
            if (chatState.showInternalAgentTurns) {
                return { label: 'Live thread + internal', tone: 'running' };
            }
            return { label: 'Live thread', tone: 'running' };
        }
        if (chatState.showInternalAgentTurns) {
            return { label: 'Thread + internal', tone: 'worker' };
        }
        return { label: 'Thread timeline', tone: 'queen' };
    }
    if (!chatState?.selectedRun) {
        return { label: 'Idle', tone: 'unknown' };
    }
    if (chatState.following) {
        return { label: 'Following live', tone: 'running' };
    }
    const status = String(chatState.selectedSession?.status || '').trim();
    if (status !== '') {
        return { label: formatQueenLabel(status), tone: normalizeQueenToken(status) };
    }
    return { label: 'Static transcript', tone: 'unknown' };
}

function syncThreadTimelineToggle(chatState) {
    const toggleButton = chatState?.transcriptToggleButton;
    if (!toggleButton) {
        return;
    }

    const visible = chatState.transcriptViewMode === 'thread' && Boolean(chatState.selectedThread);
    toggleButton.hidden = !visible;
    toggleButton.disabled = !visible;
    if (!visible) {
        toggleButton.classList.remove('is-active');
        toggleButton.setAttribute('aria-pressed', 'false');
        return;
    }

    const isActive = Boolean(chatState.showInternalAgentTurns);
    toggleButton.textContent = isActive ? 'Hide internal turns' : 'Show internal turns';
    toggleButton.title = isActive
        ? 'Hide worker and internal Queen turns from this conversation.'
        : 'Show worker and other internal agent turns inside this conversation.';
    toggleButton.classList.toggle('is-active', isActive);
    toggleButton.setAttribute('aria-pressed', isActive ? 'true' : 'false');
}

function normalizeQueenToken(value) {
    return String(value || 'unknown')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'unknown';
}

function formatQueenLabel(value) {
    const normalized = String(value || 'unknown').replace(/_/g, ' ').trim();
    if (normalized === '') {
        return 'Unknown';
    }
    return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
}

function setManagedSessionStartPending(listColumn, isPending) {
    listColumn.__queenSessionStartPending = isPending;
    const newConversationButton = listColumn.__queenNewConversationButton;
    if (!newConversationButton) return;
    newConversationButton.disabled = isPending;
    newConversationButton.textContent = isPending ? 'Starting...' : 'New Conversation';
}

function readQueenChatViewState() {
    if (typeof window === 'undefined' || !window.localStorage) {
        return null;
    }
    try {
        const raw = window.localStorage.getItem(QUEEN_CHAT_STORAGE_KEY);
        if (!raw) {
            return null;
        }
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (error) {
        console.warn('Failed to read Queen chat localStorage state:', error);
        return null;
    }
}

function persistQueenChatViewState(chatState) {
    if (
        !chatState ||
        chatState.__queenRestoringFromStorage ||
        typeof window === 'undefined' ||
        !window.localStorage
    ) {
        return;
    }

    const payload = {
        selectedThreadKey: String(chatState.selectedThread?.key || ''),
        selectedSessionId: String(chatState.selectedSession?.id || ''),
        selectedRunFilename: String(chatState.selectedRun?.filename || ''),
        transcriptViewMode: String(chatState.transcriptViewMode || 'idle'),
        newConversationDraft: Boolean(chatState.newConversationDraft),
        showInternalAgentTurns: Boolean(chatState.showInternalAgentTurns),
        composerText: String(chatState.humanMessageInput?.value || ''),
        taskIdValue: String(chatState.newConversationTaskIdInput?.value || ''),
        maxTurnsValue: String(chatState.newConversationMaxTurnsInput?.value || '20'),
    };

    try {
        window.localStorage.setItem(QUEEN_CHAT_STORAGE_KEY, JSON.stringify(payload));
        chatState.persistedViewState = payload;
    } catch (error) {
        console.warn('Failed to persist Queen chat localStorage state:', error);
    }
}

function hydratePersistedQueenComposerInputs(chatState) {
    const persisted = chatState?.persistedViewState;
    if (!persisted || typeof persisted !== 'object') {
        return;
    }
    if (chatState.humanMessageInput && typeof persisted.composerText === 'string') {
        chatState.humanMessageInput.value = persisted.composerText;
    }
    if (chatState.newConversationTaskIdInput && typeof persisted.taskIdValue === 'string') {
        chatState.newConversationTaskIdInput.value = persisted.taskIdValue;
    }
    if (chatState.newConversationMaxTurnsInput && typeof persisted.maxTurnsValue === 'string' && persisted.maxTurnsValue.trim() !== '') {
        chatState.newConversationMaxTurnsInput.value = persisted.maxTurnsValue;
    }
}

async function restorePersistedQueenView(listColumn, chatState) {
    if (!chatState || chatState.__queenRestoredFromStorage) {
        return;
    }
    if (isQueenChatAuthLost(chatState)) {
        return;
    }

    const persisted = chatState.persistedViewState;
    chatState.__queenRestoredFromStorage = true;
    if (!persisted || typeof persisted !== 'object') {
        return;
    }

    chatState.__queenRestoringFromStorage = true;
    try {
        const persistedSession = String(persisted.selectedSessionId || '').trim();
        const persistedThread = String(persisted.selectedThreadKey || '').trim();
        const persistedRun = String(persisted.selectedRunFilename || '').trim();
        const wantsDraft = Boolean(persisted.newConversationDraft);

        if (wantsDraft && !persistedSession && !persistedThread && !persistedRun) {
            beginNewConversation(chatState);
            return;
        }

        const persistedMode = String(persisted.transcriptViewMode || '').trim();
        const preferThreadRestore = persistedMode === 'thread' && persistedThread !== '';

        if (preferThreadRestore) {
            const thread = chatState.availableThreads.find((item) => item.key === persistedThread);
            if (thread) {
                await openQueenThread(thread, chatState, listColumn);
                return;
            }
        }

        if (persistedSession !== '') {
            const session = chatState.availableSessions.find((item) => item.id === persistedSession);
            if (session) {
                await openManagedSession(session, chatState, listColumn);
                return;
            }
        }

        if (persistedThread !== '') {
            const thread = chatState.availableThreads.find((item) => item.key === persistedThread);
            if (thread) {
                await openQueenThread(thread, chatState, listColumn);
                return;
            }
        }

        if (persistedRun !== '') {
            const run = chatState.availableRuns.find((item) => item.filename === persistedRun);
            if (run) {
                const runList = listColumn?.querySelector('[data-testid="queen-chat-run-list"]');
                await openQueenTranscript(run, chatState, runList);
            }
        }
    } finally {
        chatState.__queenRestoringFromStorage = false;
        persistQueenChatViewState(chatState);
    }
}

function syncQueenProcessingIndicator(chatState) {
    const indicator = chatState?.processingIndicator;
    const spinner = chatState?.processingSpinner;
    const textNode = chatState?.processingText;
    const outcomeMetaNode = chatState?.progressOutcomeMeta;
    const outcomeChip = chatState?.progressOutcomeChip;
    const outcomeSourceChip = chatState?.progressOutcomeSourceChip;
    const metaNode = chatState?.progressDetailMeta;
    if (!indicator || !spinner || !textNode || !metaNode || !outcomeMetaNode || !outcomeChip || !outcomeSourceChip) {
        return;
    }

    const directRunOutcome = chatState?.selectedRun && !chatState?.selectedSession
        ? getDirectRunOutcome(chatState.currentTranscriptEntries, getDirectRunRuntimeState(chatState))
        : null;
    if (directRunOutcome) {
        outcomeMetaNode.hidden = false;
        outcomeChip.textContent = directRunOutcome.label;
        outcomeChip.dataset.tone = directRunOutcome.tone;
        outcomeSourceChip.textContent = formatQueenLabel(directRunOutcome.source);
        outcomeSourceChip.dataset.tone = 'unknown';
    } else {
        outcomeMetaNode.hidden = true;
    }

    const summary = buildQueenProcessingSummary(chatState);
    if (!summary) {
        indicator.hidden = true;
        spinner.hidden = false;
        indicator.dataset.tone = 'unknown';
        textNode.textContent = '';
        metaNode.textContent = buildQueenProgressMeta(chatState, null);
        return;
    }

    indicator.hidden = false;
    indicator.dataset.tone = summary.tone;
    spinner.hidden = summary.spinning === false;
    textNode.textContent = summary.label;
    metaNode.textContent = buildQueenProgressMeta(chatState, summary);
}

function buildQueenProcessingSummary(chatState) {
    if (isQueenChatAuthLost(chatState)) {
        return {
            label: chatState.authLoss?.status === 401 ? 'Queen chat session expired.' : 'Queen chat access was lost.',
            tone: 'failed',
            spinning: false,
        };
    }
    const pendingMode = String(chatState?.__queenComposerPendingMode || '').trim();
    if (chatState?.__queenComposerPending) {
        if (pendingMode === 'reply_ready') {
            return { label: 'Sending your reply to Queen...', tone: 'resuming', spinning: true };
        }
        if (pendingMode === 'continue_ready') {
            return { label: 'Queen is starting a continuation from this thread...', tone: 'starting', spinning: true };
        }
        return { label: 'Queen is starting this conversation...', tone: 'starting', spinning: true };
    }

    const selectedSession = chatState?.selectedSession || null;
    if (!selectedSession) {
        if (chatState?.selectedRun) {
            return buildDirectRunProgressSummary(
                chatState.currentTranscriptEntries,
                chatState.following,
                getDirectRunRuntimeState(chatState),
            );
        }
        return null;
    }

    const explicitProgressNote = String(selectedSession.progress_note || '').trim();
    if (explicitProgressNote !== '') {
        const progressTone = normalizeManagedProgressTone(selectedSession.progress_tone || selectedSession.status || 'running');
        return {
            label: explicitProgressNote,
            tone: progressTone,
            spinning: isLiveQueenProgressTone(progressTone),
        };
    }

    if (selectedSession.human_followup_queued && isManagedSessionActiveStatus(selectedSession.status)) {
        return { label: 'Queen is resuming with your latest reply...', tone: 'resuming', spinning: true };
    }

    switch (String(selectedSession.status || '').trim()) {
    case 'starting':
        return { label: 'Queen is starting the session...', tone: 'starting', spinning: true };
    case 'running':
        return { label: 'Queen is processing the conversation...', tone: 'running', spinning: true };
    case 'resuming':
        return { label: 'Queen is processing the latest reply...', tone: 'resuming', spinning: true };
    case 'awaiting_human':
        return { label: 'Queen is waiting for your next answer.', tone: 'awaiting_human', spinning: false };
    case 'stopping':
        return { label: 'Stopping the Queen session...', tone: 'stopping', spinning: true };
    case 'completed':
        return { label: 'Queen completed this managed session.', tone: 'completed', spinning: false };
    case 'failed':
        return { label: 'This managed Queen session failed.', tone: 'failed', spinning: false };
    case 'stopped':
        return { label: 'This managed Queen session was stopped.', tone: 'stopped', spinning: false };
    default:
        return null;
    }
}

function buildQueenProgressMeta(chatState, summary) {
    if (isQueenChatAuthLost(chatState)) {
        return chatState.authLoss?.detail || 'Queen chat lost access to its protected endpoints.';
    }
    const selectedSession = chatState?.selectedSession || null;
    if (!selectedSession) {
        if (chatState?.newConversationDraft) {
            return 'Write the opening prompt below to begin a new managed Queen conversation.';
        }
        if (chatState?.selectedRun && summary) {
            const runtimeState = getDirectRunRuntimeState(chatState);
            const parts = [];
            if (chatState.following) {
                parts.push(runtimeState
                    ? `Watching ${chatState.selectedRun.filename} live with runtime state`
                    : `Watching ${chatState.selectedRun.filename} live`);
            } else if (isAwaitingHumanDirectRunTranscript(chatState.currentTranscriptEntries)) {
                parts.push('Direct run paused on a human decision point');
            } else if (isTerminalDirectRunTranscript(chatState.currentTranscriptEntries)) {
                parts.push('Direct run reached its latest terminal transcript checkpoint');
            } else {
                parts.push(runtimeState
                    ? 'Direct run status comes from runtime-state checkpoints'
                    : 'Direct run status inferred from transcript state');
            }
            if (runtimeState?.progress_updated_at) {
                parts.push(`Runtime state ${formatManagedSessionTimestamp(runtimeState.progress_updated_at)}`);
            }
            const processStatus = buildDirectRunProcessStatusSummary(runtimeState);
            if (processStatus !== '') {
                parts.push(processStatus);
            }
            const pendingTurnMeta = runtimeState ? buildManagedSessionPendingTurnMeta(runtimeState) : '';
            if (pendingTurnMeta !== '') {
                parts.push(pendingTurnMeta);
            }
            const worktreeEvidenceSummary = String(runtimeState?.worktree_evidence?.summary || '').trim();
            if (worktreeEvidenceSummary !== '') {
                parts.push(worktreeEvidenceSummary);
            }
            if (chatState.directRunLive?.lastHeartbeatAt) {
                parts.push(`Heartbeat ${formatManagedSessionTimestamp(chatState.directRunLive.lastHeartbeatAt)}`);
            }
            if (chatState.directRunLive?.lastEntryAt) {
                parts.push(`Latest transcript entry ${formatManagedSessionTimestamp(chatState.directRunLive.lastEntryAt)}`);
            } else {
                parts.push('Waiting for the next transcript entry');
            }
            return parts.join(' · ');
        }
        if (chatState?.selectedThread || chatState?.selectedRun) {
            return 'This view is currently showing transcript context only. Start a continuation below if you want Queen to keep going.';
        }
        return 'Open an active managed session to see live orchestration checkpoints.';
    }

    const progressTimestamp = String(
        selectedSession.progress_updated_at
        || selectedSession.human_followup_queued_at
        || selectedSession.updated_at
        || selectedSession.created_at
        || '',
    ).trim();
    const parts = [];
    if (progressTimestamp !== '') {
        parts.push(`Updated ${formatManagedSessionTimestamp(progressTimestamp)}`);
    }
    const pendingTurnMeta = buildManagedSessionPendingTurnMeta(selectedSession);
    if (pendingTurnMeta !== '') {
        parts.push(pendingTurnMeta);
    }
    if (chatState.following && shouldAutoFollowManagedSession(selectedSession)) {
        parts.push('Following transcript live');
    } else if (chatState.transcriptViewMode === 'thread' && chatState.selectedThread) {
        parts.push('Viewing the thread snapshot');
    }

    if (parts.length > 0) {
        return parts.join(' · ');
    }

    if (summary?.tone === 'awaiting_human') {
        return 'Use the composer below to answer Queen and continue this session.';
    }

    return 'Live progress appears here when Queen or Heisenberg crosses a meaningful orchestration checkpoint.';
}

function isLiveQueenProgressTone(tone) {
    return ['starting', 'running', 'resuming', 'stopping'].includes(String(tone || '').trim());
}

function normalizeManagedProgressTone(value) {
    const normalized = normalizeQueenToken(value);
    switch (normalized) {
    case 'info':
        return 'running';
    case 'warning':
        return 'awaiting_human';
    case 'success':
        return 'completed';
    case 'danger':
        return 'failed';
    default:
        return normalized;
    }
}

function buildDirectRunQuestionSummary(chatState) {
    const runtimeState = getDirectRunRuntimeState(chatState);
    if (!chatState?.selectedRun) {
        return 'Open a managed session from the left to inspect its current decision state.';
    }
    const runtimeReason = String(runtimeState?.status_reason || '').trim();
    if (runtimeReason !== '') {
        return runtimeReason;
    }
    const runtimeStatus = normalizeQueenToken(runtimeState?.status || '');
    if (runtimeStatus === 'awaiting_human') {
        return 'Queen asked for a human reply in this direct terminal flow. Continue it from the terminal or start a browser continuation below.';
    }
    if (runtimeStatus === 'completed') {
        return 'This direct Queen run completed without creating a managed-session checkpoint.';
    }
    if (runtimeStatus === 'failed') {
        return 'This direct Queen run failed before reaching a safe managed-session boundary.';
    }
    if (isAwaitingHumanDirectRunTranscript(chatState.currentTranscriptEntries)) {
        return 'Queen asked for a human reply in this direct terminal flow. Continue it from the terminal or start a browser continuation below.';
    }
    if (isTerminalDirectRunTranscript(chatState.currentTranscriptEntries)) {
        return 'This direct Queen run completed without creating a managed-session checkpoint.';
    }
    if (chatState.following) {
        if (runtimeState) {
            return 'This direct run is streaming runtime-state checkpoints and transcript updates without needing a managed-session launch.';
        }
        return 'This direct run is being observed from transcript SSE only, so browser progress comes from heartbeat and appended transcript lines.';
    }
    return 'This is a direct transcript snapshot. Start a continuation below if you want browser-managed follow-up.';
}

function buildDirectRunUpdateSummary(chatState) {
    const runtimeState = getDirectRunRuntimeState(chatState);
    const parts = [];
    if (runtimeState?.progress_updated_at) {
        parts.push(`Runtime state ${formatManagedSessionTimestamp(runtimeState.progress_updated_at)}`);
    }
    const processStatus = buildDirectRunProcessStatusSummary(runtimeState);
    if (processStatus !== '') {
        parts.push(processStatus);
    }
    const pendingTurnMeta = runtimeState ? buildManagedSessionPendingTurnMeta(runtimeState) : '';
    if (pendingTurnMeta !== '') {
        parts.push(pendingTurnMeta);
    }
    const worktreeEvidenceSummary = String(runtimeState?.worktree_evidence?.summary || '').trim();
    if (worktreeEvidenceSummary !== '') {
        parts.push(worktreeEvidenceSummary);
    }
    if (chatState?.directRunLive?.lastHeartbeatAt) {
        parts.push(`Heartbeat ${formatManagedSessionTimestamp(chatState.directRunLive.lastHeartbeatAt)}`);
    }
    if (chatState?.directRunLive?.lastModifiedAt) {
        parts.push(`File updated ${formatManagedSessionTimestamp(chatState.directRunLive.lastModifiedAt)}`);
    }
    if (chatState?.directRunLive?.lastEntryAt) {
        parts.push(`Latest transcript entry ${formatManagedSessionTimestamp(chatState.directRunLive.lastEntryAt)}`);
    }
    if (chatState?.selectedRun?.timestamp) {
        parts.push(`Started ${formatManagedSessionTimestamp(chatState.selectedRun.timestamp)}`);
    }
    if (parts.length === 0) {
        return 'No direct-run live updates yet.';
    }
    return parts.join(' · ');
}

function buildSessionDetailCard(labelText, testId) {
    const card = document.createElement('div');
    card.className = 'queen-chat-detail-card';

    const label = document.createElement('strong');
    label.textContent = labelText;
    label.style.fontSize = '0.92rem';
    card.appendChild(label);

    const value = document.createElement('div');
    value.dataset.testid = testId;
    value.style.whiteSpace = 'pre-wrap';
    value.style.wordBreak = 'break-word';
    value.style.color = 'var(--fw-color-muted)';
    value.textContent = 'Not available yet.';
    card.appendChild(value);

    return { card, value };
}

function syncManagedSessionDetails(chatState) {
    const selectedSession = chatState?.selectedSession || null;
    const emptyNode = chatState?.sessionDetailsEmpty;
    const stateNode = chatState?.sessionStateDetailValue;
    const turnNode = chatState?.sessionTurnDetailValue;
    const questionNode = chatState?.sessionQuestionDetailValue;
    const replyNode = chatState?.sessionReplyDetailValue;
    const updateNode = chatState?.sessionUpdateDetailValue;
    if (!emptyNode || !stateNode || !turnNode || !questionNode || !replyNode || !updateNode) return;

    if (isQueenChatAuthLost(chatState)) {
        emptyNode.style.display = 'none';
        stateNode.textContent = chatState.authLoss?.status === 401
            ? 'Authentication lost · Queen chat paused'
            : 'Access lost · Queen chat paused';
        turnNode.textContent = 'Protected Queen polling and live follow were stopped after the auth failure was detected.';
        questionNode.textContent = chatState.authLoss?.detail || 'Queen chat access needs to be restored before this view can continue.';
        replyNode.textContent = 'Re-login or refresh after access is restored.';
        updateNode.textContent = buildQueenAuthLossMeta(chatState) || 'Queen chat access was lost.';
        syncManagedSessionHistory(chatState);
        return;
    }

    if (!selectedSession && chatState?.selectedRun) {
        emptyNode.style.display = 'none';
        stateNode.textContent = buildDirectRunStateSummary(chatState);
        turnNode.textContent = buildDirectRunTurnSummary(
            chatState.currentTranscriptEntries,
            chatState.following,
            getDirectRunRuntimeState(chatState),
        );
        questionNode.textContent = buildDirectRunQuestionSummary(chatState);
        replyNode.textContent = buildDirectRunLatestHumanReply(chatState.currentTranscriptEntries);
        updateNode.textContent = buildDirectRunUpdateSummary(chatState);
        syncManagedSessionHistory(chatState);
        return;
    }

    if (!selectedSession) {
        emptyNode.style.display = 'block';
        stateNode.textContent = 'No managed session selected.';
        turnNode.textContent = 'No in-flight Queen or Heisenberg turn is currently recorded.';
        questionNode.textContent = 'Open a managed session from the left to inspect its current decision state.';
        replyNode.textContent = 'No managed-session human reply has been recorded.';
        updateNode.textContent = 'No managed-session state updates yet.';
        syncManagedSessionHistory(chatState);
        return;
    }

    emptyNode.style.display = 'none';
    stateNode.textContent = buildManagedSessionStateSummary(selectedSession);
    turnNode.textContent = buildManagedSessionPendingTurnSummary(selectedSession);
    questionNode.textContent = buildManagedSessionQuestionSummary(selectedSession);
    replyNode.textContent = buildManagedSessionReplySummary(
        selectedSession,
        chatState.currentTranscriptEntries,
        chatState.pendingHumanReplyPreview,
        chatState.currentPublicTimelineEntries,
    );
    updateNode.textContent = buildManagedSessionUpdateSummary(selectedSession);
    syncManagedSessionHistory(chatState);
}

function getDirectRunRuntimeState(chatState) {
    return extractDirectRunRuntimeState(chatState?.directRunLive?.runtimeState || chatState?.selectedRun || null);
}

function buildDirectRunStateSummary(chatState) {
    const runtimeState = getDirectRunRuntimeState(chatState);
    if (runtimeState?.status) {
        const parts = [formatQueenLabel(runtimeState.status)];
        const processStatus = buildDirectRunProcessStatusSummary(runtimeState);
        if (processStatus !== '') {
            parts.push(processStatus);
        }
        if (runtimeState.progress_note) {
            parts.push('Direct runtime state');
        } else if (chatState.following) {
            parts.push('Live runtime follow');
        } else {
            parts.push('Runtime snapshot');
        }
        return parts.join(' · ');
    }
    return chatState.following
        ? 'Direct transcript follow · live SSE attached'
        : 'Direct transcript snapshot only';
}

function syncManagedSessionHistory(chatState) {
    const selectedSession = chatState?.selectedSession || null;
    const emptyNode = chatState?.eventHistoryEmpty;
    const listNode = chatState?.eventHistoryList;
    if (!emptyNode || !listNode) return;

    listNode.replaceChildren();

    if (isQueenChatAuthLost(chatState)) {
        emptyNode.style.display = 'block';
        emptyNode.textContent = 'Decision history is unavailable while Queen chat access is lost.';
        return;
    }

    if (!selectedSession) {
        emptyNode.style.display = 'block';
        emptyNode.textContent = 'Select a managed session to inspect its decision history.';
        return;
    }

    const items = buildManagedSessionHistoryItems(
        selectedSession,
        chatState.currentTranscriptEntries,
        chatState.pendingHumanReplyPreview,
    );

    if (items.length === 0) {
        emptyNode.style.display = 'block';
        emptyNode.textContent = 'No decision history has been recorded for this managed session yet.';
        return;
    }

    emptyNode.style.display = 'none';
    items.forEach((item) => {
        listNode.appendChild(buildManagedSessionHistoryItem(item));
    });
}

function buildManagedSessionStateSummary(session) {
    const parts = [formatQueenLabel(session.status)];
    if (session.human_followup_queued) {
        parts.push('Human reply queued');
    }
    if (session.process_id) {
        parts.push(`PID ${session.process_id}`);
    }
    return parts.join(' · ');
}

function buildManagedSessionQuestionSummary(session) {
    const reason = String(session?.status_reason || '').trim();
    if (reason) {
        return reason;
    }

    switch (session?.status) {
    case 'awaiting_human':
        return 'Queen is waiting for a human decision, but no question text was captured.';
    case 'resuming':
        return 'Queen has received a human reply and is continuing from that decision point.';
    case 'running':
        return 'Queen is currently working and has not asked for human input.';
    case 'completed':
        return 'This managed Queen session has completed.';
    case 'failed':
        return 'This managed Queen session failed before completion.';
    case 'stopped':
        return 'This managed Queen session was stopped.';
    default:
        return `Session state is ${formatQueenLabel(session?.status)}.`;
    }
}

function buildManagedSessionReplySummary(session, transcriptEntries, pendingHumanReplyPreview, publicTimelineEntries = []) {
    const latestThreadHumanReply = findLatestThreadHumanReply(publicTimelineEntries);
    if (latestThreadHumanReply) {
        return truncateQueenText(latestThreadHumanReply, 280);
    }
    const latestHumanReply = findLatestManagedSessionHumanReply(transcriptEntries);
    if (latestHumanReply) {
        return truncateQueenText(latestHumanReply, 280);
    }
    if (session?.human_followup_queued && String(pendingHumanReplyPreview || '').trim() !== '') {
        return `Queued reply: ${truncateQueenText(pendingHumanReplyPreview, 240)}`;
    }
    if (session?.status === 'awaiting_human') {
        return 'No human reply has been sent for this decision point yet.';
    }
    return 'No managed-session human reply has been recorded after the initial prompt.';
}

function buildManagedSessionUpdateSummary(session) {
    const parts = [];
    if (session?.human_followup_queued_at) {
        parts.push(`Queued ${formatManagedSessionTimestamp(session.human_followup_queued_at)}`);
    }
    if (session?.progress_updated_at && session.progress_updated_at !== session.updated_at) {
        parts.push(`Progress ${formatManagedSessionTimestamp(session.progress_updated_at)}`);
    }
    if (session?.updated_at) {
        parts.push(`Updated ${formatManagedSessionTimestamp(session.updated_at)}`);
    }
    if (session?.created_at) {
        parts.push(`Started ${formatManagedSessionTimestamp(session.created_at)}`);
    }
    if (parts.length === 0) {
        return 'No timestamp details available.';
    }
    return parts.join(' · ');
}

function buildManagedSessionHistoryItems(session, transcriptEntries, pendingHumanReplyPreview) {
    const items = [];
    const seenKeys = new Set();

    const pushItem = (item) => {
        if (!item) return;
        const timestamp = String(item.timestamp || '').trim();
        const label = String(item.label || '').trim();
        const details = String(item.details || '').trim();
        const dedupeKey = `${timestamp}|${label}|${details}`;
        if (seenKeys.has(dedupeKey)) {
            return;
        }
        seenKeys.add(dedupeKey);
        items.push({
            tone: 'unknown',
            details: '',
            ...item,
            sortKey: buildManagedSessionHistorySortKey(timestamp, items.length),
        });
    };

    if (session?.created_at) {
        pushItem({
            timestamp: session.created_at,
            tone: 'starting',
            label: 'Session started',
            details: session.transcript_filename
                ? `Managed session ${session.id} began and started writing to ${session.transcript_filename}.`
                : `Managed session ${session.id} began.`,
        });
    }

    if (Array.isArray(transcriptEntries)) {
        transcriptEntries.forEach((entry) => {
            if (!entry || typeof entry !== 'object') return;
            const role = String(entry.role || '').trim().toLowerCase();
            const text = String(entry.text || '').trim();
            if (text === '') return;

            if (role === 'human') {
                pushItem({
                    timestamp: entry.timestamp,
                    tone: 'human',
                    label: Number(entry.turn ?? 0) <= 0 ? 'Initial prompt' : 'Human reply recorded',
                    details: truncateQueenText(text, 320),
                });
                return;
            }

            if (role === 'queen' && isAwaitingHumanSignal(text)) {
                pushItem({
                    timestamp: entry.timestamp,
                    tone: 'awaiting_human',
                    label: 'Queen requested a decision',
                    details: extractAwaitingHumanReason(text),
                });
                return;
            }

            if (role === 'queen' && isDoneSignal(text)) {
                pushItem({
                    timestamp: entry.timestamp,
                    tone: 'completed',
                    label: 'Queen marked the session done',
                    details: summarizeDecisionHistoryText(text, 'Queen signaled that the managed session is complete.'),
                });
            }
        });
    }

    if (session?.human_followup_queued_at) {
        pushItem({
            timestamp: session.human_followup_queued_at,
            tone: 'resuming',
            label: 'Human reply queued',
            details: String(pendingHumanReplyPreview || '').trim() !== ''
                ? `Queued reply: ${truncateQueenText(pendingHumanReplyPreview, 240)}`
                : 'A browser-authored human reply has been queued for Queen to consume on resume.',
        });
    }

    if (session?.updated_at) {
        pushItem({
            timestamp: session.updated_at,
            tone: normalizeQueenToken(session.status),
            label: `Session is ${formatQueenLabel(session.status)}`,
            details: buildManagedSessionStatusHistoryDetails(session, pendingHumanReplyPreview),
        });
    }

    return items
        .sort((left, right) => right.sortKey - left.sortKey)
        .slice(0, 12);
}

function buildManagedSessionHistoryItem(item) {
    const article = document.createElement('article');
    article.className = 'queen-chat-history-item';

    const topRow = document.createElement('div');
    topRow.className = 'queen-chat-history-top';
    article.appendChild(topRow);

    const meta = document.createElement('div');
    meta.className = 'queen-chat-history-meta';
    meta.appendChild(buildQueenChip(item.label, item.tone));
    topRow.appendChild(meta);

    const timestamp = document.createElement('span');
    timestamp.className = 'queen-chat-card-meta';
    timestamp.textContent = formatManagedSessionTimestamp(item.timestamp);
    topRow.appendChild(timestamp);

    const details = document.createElement('div');
    details.className = 'queen-chat-history-body';
    details.textContent = item.details || 'No details available.';
    article.appendChild(details);

    return article;
}

function buildManagedSessionHistorySortKey(timestamp, fallbackOrder) {
    const parsed = Date.parse(String(timestamp || ''));
    if (!Number.isNaN(parsed)) {
        return parsed;
    }
    return fallbackOrder;
}

function buildManagedSessionStatusHistoryDetails(session, pendingHumanReplyPreview) {
    const status = String(session?.status || '').trim();
    const reason = String(session?.status_reason || '').trim();
    switch (status) {
    case 'awaiting_human':
        return reason || 'Queen is paused and waiting for a human decision.';
    case 'resuming':
        if (String(pendingHumanReplyPreview || '').trim() !== '') {
            return `Queen is resuming after: ${truncateQueenText(pendingHumanReplyPreview, 240)}`;
        }
        return reason || 'Queen has consumed a human reply and is resuming work.';
    case 'running':
        return reason || 'Queen is actively progressing and has not asked for a human decision right now.';
    case 'completed':
        return reason || 'The managed Queen session completed successfully.';
    case 'failed':
        return reason || 'The managed Queen session failed before completion.';
    case 'stopped':
        return reason || 'The managed Queen session was stopped before completion.';
    case 'starting':
        return 'Queen is starting the managed session.';
    case 'stopping':
        return 'A stop request was sent and Queen is winding the session down.';
    default:
        return reason || `Session status is ${formatQueenLabel(status)}.`;
    }
}

function isAwaitingHumanSignal(text) {
    const raw = String(text || '');
    const lower = raw.toLowerCase();
    if (lower.includes('[awaiting_human]') || lower.includes('[human_decision_required]')) {
        return true;
    }
    const directive = extractQueenDirective(raw);
    if (!directive) {
        return false;
    }
    return (
        ['await_human', 'awaiting_human', 'wait_for_human'].includes(String(directive.next_action || '').trim().toLowerCase())
        || String(directive.status || '').trim().toLowerCase() === 'awaiting_human'
        || directive.voidaanko_jatkaa === false
    );
}

function isDoneSignal(text) {
    const raw = String(text || '');
    const lower = raw.toLowerCase();
    if (lower.includes('[done]') || lower.includes('[task complete]')) {
        return true;
    }
    const directive = extractQueenDirective(raw);
    if (!directive) {
        return false;
    }
    return (
        String(directive.next_action || '').trim().toLowerCase() === 'report_to_user'
        || String(directive.status || '').trim().toLowerCase() === 'done'
        || directive.koodin_tila_vastaa_tavoitetta === true
    );
}

function extractAwaitingHumanReason(text) {
    const directive = extractQueenDirective(text);
    if (directive) {
        const candidate = String(
            directive.miksi_ei_voida_jatkaa
            || directive.question
            || directive.reason
            || directive.human_question
            || directive.summary
            || directive.ehdotus_jatkoon
            || ''
        ).trim();
        if (candidate !== '') {
            return truncateQueenText(candidate, 320);
        }
    }
    const normalized = String(text || '')
        .replace(/\[awaiting_human\]/ig, '')
        .replace(/\[human_decision_required\]/ig, '')
        .replace(/\s+/g, ' ')
        .trim();
    if (normalized !== '') {
        return truncateQueenText(normalized, 320);
    }
    return 'Queen is awaiting a human decision.';
}

function summarizeDecisionHistoryText(text, fallbackText) {
    const directive = extractQueenDirective(text);
    if (directive) {
        const candidate = String(
            directive.mita_tehtiin
            || directive.summary
            || directive.tavoite
            || directive.ehdotus_jatkoon
            || ''
        ).trim();
        if (candidate !== '') {
            return truncateQueenText(candidate, 320);
        }
    }
    const normalized = String(text || '')
        .replace(/\[done\]/ig, '')
        .replace(/\[task complete\]/ig, '')
        .replace(/\s+/g, ' ')
        .trim();
    if (normalized !== '') {
        return truncateQueenText(normalized, 320);
    }
    return fallbackText;
}

function extractQueenDirective(text) {
    const raw = String(text || '');
    const fencedMatches = [...raw.matchAll(/```json\s*([\s\S]*?)```/ig)];
    for (let index = fencedMatches.length - 1; index >= 0; index -= 1) {
        try {
            const parsed = JSON.parse(fencedMatches[index][1].trim());
            if (parsed && typeof parsed === 'object') {
                return parsed;
            }
        } catch {
            // Ignore malformed fenced JSON and keep scanning backwards.
        }
    }

    const braceStart = raw.indexOf('{');
    if (braceStart < 0) {
        return null;
    }
    for (let end = raw.length - 1; end > braceStart; end -= 1) {
        if (raw[end] !== '}') {
            continue;
        }
        try {
            const parsed = JSON.parse(raw.slice(braceStart, end + 1));
            if (parsed && typeof parsed === 'object') {
                return parsed;
            }
        } catch {
            // Ignore malformed raw JSON fragments and keep scanning backwards.
        }
    }
    return null;
}

function findLatestManagedSessionHumanReply(entries) {
    if (!Array.isArray(entries)) return '';
    for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index];
        if (!entry || entry.role !== 'human') continue;
        if (Number(entry.turn ?? 0) <= 0) continue;
        const text = String(entry.text || '').trim();
        if (text !== '') {
            return text;
        }
    }
    return '';
}

function findLatestThreadHumanReply(entries) {
    if (!Array.isArray(entries)) return '';
    const humanMessages = entries
        .filter((entry) => String(entry?.role || '').trim().toLowerCase() === 'human')
        .map((entry) => String(entry?.text || '').trim())
        .filter((text) => text !== '');

    if (humanMessages.length <= 1) {
        return '';
    }
    return humanMessages.at(-1) || '';
}

function formatManagedSessionTimestamp(timestamp, fallback = 'unknown time') {
    return formatQueenDisplayTimestamp(timestamp, fallback);
}

function buildQueenSessionSubtitle(session) {
    if (!session) {
        return 'Select a run from the left to inspect its transcript.';
    }
    const transcriptLabel = session.transcript_filename || session.transcript_name || '';
    const parts = [formatQueenLabel(session.status), session.id];
    if (transcriptLabel) {
        parts.push(transcriptLabel);
    }
    if (session.status_reason) {
        parts.push(truncateQueenText(session.status_reason, 140));
    }
    return parts.join(' · ');
}

function syncManagedSessionComposer(chatState) {
    const input = chatState.humanMessageInput;
    const button = chatState.sendHumanMessageButton;
    const description = chatState?.composerDescription;
    const options = chatState?.composerOptions;
    const cancelButton = chatState?.cancelComposerButton;
    if (!input || !button || !description || !options || !cancelButton) return;

    const composerMode = getQueenComposerMode(chatState);
    const isPending = Boolean(chatState.__queenComposerPending);
    const pendingMode = chatState.__queenComposerPendingMode || composerMode;
    const selectedSession = chatState.selectedSession;
    const hasMessage = String(input.value || '').trim() !== '';

    if (isQueenChatAuthLost(chatState)) {
        options.hidden = true;
        cancelButton.hidden = true;
        description.textContent = chatState.authLoss?.detail || 'Queen chat access must be restored before you can write here again.';
        input.disabled = true;
        input.placeholder = 'Re-login or refresh after access is restored.';
        button.disabled = true;
        button.textContent = 'Send Reply';
        cancelButton.disabled = true;
        return;
    }

    options.hidden = !['new_session', 'continue_ready'].includes(composerMode);
    cancelButton.hidden = composerMode !== 'new_session';

    if (composerMode === 'new_session' || (isPending && pendingMode === 'new_session')) {
        description.textContent = 'Write the opening message here. Queen will start a fresh managed conversation from this first prompt.';
        input.disabled = isPending;
        input.placeholder = 'Describe what Queen should work on...';
        button.disabled = isPending || !hasMessage;
        button.textContent = isPending ? 'Starting Conversation...' : 'Start Conversation';
        cancelButton.disabled = isPending;
        return;
    }

    if (composerMode === 'continue_ready' || (isPending && pendingMode === 'continue_ready')) {
        description.textContent = 'This conversation is read-only. Your message starts a new Queen continuation from this transcript.';
        input.disabled = isPending;
        input.placeholder = 'Write how Queen should continue from this conversation...';
        button.disabled = isPending || !hasMessage;
        button.textContent = isPending ? 'Starting Continuation...' : 'Continue Conversation';
        cancelButton.disabled = false;
        return;
    }

    cancelButton.disabled = false;

    if (isPending) {
        description.textContent = 'Queen is processing the latest human reply.';
        input.disabled = true;
        button.disabled = true;
        button.textContent = 'Sending Reply...';
        return;
    }

    if (!selectedSession) {
        description.textContent = 'Choose a conversation from the left, or click New Conversation to start a fresh one.';
        input.disabled = true;
        input.placeholder = 'Select a conversation or click New Conversation.';
        button.disabled = true;
        button.textContent = 'Send Reply';
        return;
    }

    if (composerMode === 'reply_ready') {
        description.textContent = 'Queen is explicitly waiting for a human answer in this conversation.';
        input.disabled = false;
        button.disabled = !hasMessage;
        button.textContent = 'Send Reply';
        if (selectedSession.status_reason) {
            input.placeholder = `Reply to Queen: ${truncateQueenText(selectedSession.status_reason, 180)}`;
        } else {
            input.placeholder = `Reply to Queen for session ${selectedSession.id}...`;
        }
        return;
    }

    input.disabled = true;
    button.disabled = true;
    button.textContent = 'Send Reply';
    if (composerMode === 'reply_queued') {
        description.textContent = 'The latest human reply is already queued and Queen is resuming.';
        input.placeholder = 'A human reply is already queued for this session while Queen resumes.';
        return;
    }
    if (selectedSession.status === 'running') {
        description.textContent = 'Queen is still working in this conversation.';
        input.placeholder = `Session ${selectedSession.id} is still running; Queen has not asked for human input yet.`;
        return;
    }
    if (selectedSession.status === 'resuming') {
        description.textContent = 'Queen is resuming after the latest human reply.';
        input.placeholder = `Session ${selectedSession.id} is resuming after the latest human reply.`;
        return;
    }
    description.textContent = 'Human replies are disabled for the currently selected conversation right now.';
    input.placeholder = `Session ${selectedSession.id} is ${selectedSession.status}; human replies are disabled right now.`;
}

function setManagedSessionComposerPending(chatState, isPending, pendingMode = null) {
    chatState.__queenComposerPending = isPending;
    chatState.__queenComposerPendingMode = isPending ? pendingMode : null;
    syncManagedSessionComposer(chatState);
}

function isManagedSessionActiveStatus(status) {
    return ['running', 'awaiting_human', 'resuming', 'starting', 'stopping'].includes(String(status || ''));
}

export const __queenChatViewTestHooks = {
    renderQueenTranscript,
    renderQueenPublicTimeline,
};
