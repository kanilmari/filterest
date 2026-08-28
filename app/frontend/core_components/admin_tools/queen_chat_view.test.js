// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest';

const endpointRouterMock = vi.fn();
const getEndpointUrlMock = vi.fn();
const showErrorToastMock = vi.fn();
const showInfoToastMock = vi.fn();

async function loadModule() {
    vi.resetModules();
    vi.doMock('../endpoints/endpoint_router.js', () => ({
        endpoint_router: endpointRouterMock,
        get_endpoint_url: getEndpointUrlMock,
    }));
    vi.doMock('../../reusable_components/notifications/toast_notification_printer.js', () => ({
        showErrorToast: showErrorToastMock,
        showInfoToast: showInfoToastMock,
    }));
    return import('./queen_chat_view.js');
}

function makeRect(top, height = 0, left = 0, width = 0) {
    return {
        top,
        bottom: top + height,
        left,
        right: left + width,
        width,
        height,
        x: left,
        y: top,
        toJSON() {
            return {
                top: this.top,
                bottom: this.bottom,
                left: this.left,
                right: this.right,
                width: this.width,
                height: this.height,
                x: this.x,
                y: this.y,
            };
        },
    };
}

function installTranscriptLayoutMock(container) {
    Object.defineProperty(container, 'scrollHeight', {
        configurable: true,
        get() {
            return 2400;
        },
    });
    container.getBoundingClientRect = () => makeRect(100, 420, 0, 480);

    return vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function mockRect() {
        if (!this.classList?.contains('queen-chat-message')) {
            return makeRect(0, 0, 0, 0);
        }
        const messages = Array.from(container.querySelectorAll('.queen-chat-message'));
        const index = messages.indexOf(this);
        if (index === -1) {
            return makeRect(0, 0, 0, 0);
        }

        let top = 100 - container.scrollTop;
        for (let cursor = 0; cursor < index; cursor += 1) {
            top += getMockMessageHeight(messages[cursor]);
        }
        return makeRect(top, getMockMessageHeight(this), 0, 480);
    });
}

function getMockMessageHeight(message) {
    const body = message.querySelector('.queen-chat-message-body');
    if (!body) {
        return 72;
    }
    const hasExpandButton = Boolean(message.querySelector('.queen-chat-message-expand'));
    if (!hasExpandButton) {
        return 148;
    }
    return body.classList.contains('queen-chat-message-body--collapsed') ? 124 : 336;
}

function buildTranscriptEntries() {
    return [
        {
            role: 'human',
            agent: 'human',
            text: 'Opening message',
            timestamp: '2026-04-05T18:00:00Z',
            turn: 1,
        },
        {
            role: 'controller',
            agent: 'QAP controller',
            text: 'Continue from Phase 2: Plan & Delegate.\nEnd this reply no later than Phase 3: Work Verbosely.',
            timestamp: '2026-04-05T18:00:01Z',
            turn: 2,
        },
        {
            role: 'queen',
            agent: 'queen',
            text: 'Investigating the deployment manifest and validation path.',
            timestamp: '2026-04-05T18:00:02Z',
            turn: 3,
        },
        {
            role: 'controller',
            agent: 'QAP controller',
            text: 'Continue from Phase 3: Work Verbosely.\nEnd this reply no later than Phase 5: Collect Knowledge.',
            timestamp: '2026-04-05T18:00:03Z',
            turn: 4,
        },
        {
            role: 'queen',
            agent: 'queen',
            text: 'Final answer',
            timestamp: '2026-04-05T18:00:04Z',
            turn: 5,
        },
    ];
}

function buildTranscriptEntriesWithTerminalMiddleMessage() {
    return [
        {
            role: 'human',
            agent: 'human',
            text: 'Opening message',
            timestamp: '2026-04-05T18:10:00Z',
            turn: 1,
        },
        {
            role: 'queen',
            agent: 'queen',
            text: [
                '[DONE]',
                '',
                '**Summary**',
                '- **Ticket**: `#286`',
                '- **Phase**: 6. Close the Loop, Commit and Push',
                '',
                '01. Commit+push changes made in this chat',
                '02. Check worker/Queen status',
                '03. Proceed with AI\'s suggested next step(s)',
            ].join('\n'),
            timestamp: '2026-04-05T18:10:01Z',
            turn: 2,
        },
        {
            role: 'queen',
            agent: 'queen',
            text: 'Final answer',
            timestamp: '2026-04-05T18:10:02Z',
            turn: 3,
        },
    ];
}

describe('queen_chat_view auth-loss handling', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        document.body.innerHTML = '';
        localStorage.clear();
        endpointRouterMock.mockReset();
        getEndpointUrlMock.mockReset();
        showErrorToastMock.mockReset();
        showInfoToastMock.mockReset();
        getEndpointUrlMock.mockImplementation((routeName) => `/api/mock/${routeName}`);
    });

    test('shows a Queen-chat-specific auth-loss notice and stops auto-refresh polling after a 403', async () => {
        const authError = new Error('Virhe pyynnössä (queenSessions): 403 - Forbidden');
        authError.status = 403;
        endpointRouterMock.mockRejectedValue(authError);

        const { generate_queen_chat_view } = await loadModule();
        const container = document.createElement('div');

        await generate_queen_chat_view(container);

        const authNotice = /** @type {HTMLElement | null} */ (
            container.querySelector('[data-testid="queen-chat-auth-notice"]')
        );
        const transcript = /** @type {HTMLElement | null} */ (
            container.querySelector('[data-testid="queen-chat-transcript"]')
        );
        const composerInput = /** @type {HTMLTextAreaElement | null} */ (
            container.querySelector('[data-testid="queen-chat-human-message"]')
        );
        const authLoginButton = container.querySelector('[data-testid="queen-chat-auth-login"]');
        const authRefreshButton = container.querySelector('[data-testid="queen-chat-auth-refresh"]');

        expect(endpointRouterMock).toHaveBeenCalledTimes(1);
        expect(endpointRouterMock).toHaveBeenCalledWith('queenSessions', expect.objectContaining({
            suppressAuthRedirect: true,
        }));
        expect(authNotice).not.toBeNull();
        expect(authNotice.hidden).toBe(false);
        expect(authNotice.textContent).toContain('Queen chat access lost');
        expect(authNotice.textContent).toContain('Re-login or refresh');
        expect(transcript.hidden).toBe(true);
        expect(composerInput.disabled).toBe(true);
        expect(authLoginButton).toBeNull();
        expect(authRefreshButton).toBeNull();
        expect(showErrorToastMock).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(30000);

        expect(endpointRouterMock).toHaveBeenCalledTimes(1);
    });
});

describe('queen_chat_view transcript expansion', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        endpointRouterMock.mockReset();
        getEndpointUrlMock.mockReset();
        showErrorToastMock.mockReset();
        showInfoToastMock.mockReset();
    });

    test('preserves run transcript scroll position when expanding a middle message', async () => {
        const { __queenChatViewTestHooks } = await loadModule();
        const container = document.createElement('div');
        const layoutSpy = installTranscriptLayoutMock(container);
        const chatState = {
            transcriptBox: container,
            transcriptViewMode: 'run',
            selectedRun: { filename: 'demo-run.jsonl' },
            expandedTranscriptMessageKeys: new Set(),
        };

        __queenChatViewTestHooks.renderQueenTranscript(container, buildTranscriptEntries(), chatState);
        container.scrollTop = 350;

        const toggleButton = /** @type {HTMLButtonElement | null} */ (
            container.querySelector('.queen-chat-message-expand')
        );
        expect(toggleButton).not.toBeNull();

        toggleButton.click();

        expect(container.scrollTop).toBe(350);
        expect(container.querySelector('.queen-chat-message-expand')?.textContent).toBe('Show less');

        layoutSpy.mockRestore();
    });

    test('preserves thread timeline scroll position when expanding a middle message', async () => {
        const { __queenChatViewTestHooks } = await loadModule();
        const container = document.createElement('div');
        const layoutSpy = installTranscriptLayoutMock(container);
        const chatState = {
            transcriptBox: container,
            transcriptViewMode: 'thread',
            selectedThread: { key: 'thread-286' },
            currentPublicTimelineEntries: buildTranscriptEntries(),
            expandedTranscriptMessageKeys: new Set(),
        };
        container.__queenChatState = chatState;

        __queenChatViewTestHooks.renderQueenPublicTimeline(container, chatState.currentPublicTimelineEntries);
        container.scrollTop = 420;

        const toggleButton = /** @type {HTMLButtonElement | null} */ (
            container.querySelector('.queen-chat-message-expand')
        );
        expect(toggleButton).not.toBeNull();

        toggleButton.click();

        expect(container.scrollTop).toBe(420);
        expect(container.querySelector('.queen-chat-message-expand')?.textContent).toBe('Show less');

        layoutSpy.mockRestore();
    });

    test('shows the full terminal Queen message after expanding a collapsed middle message', async () => {
        const { __queenChatViewTestHooks } = await loadModule();
        const container = document.createElement('div');
        const layoutSpy = installTranscriptLayoutMock(container);
        const chatState = {
            transcriptBox: container,
            transcriptViewMode: 'run',
            selectedRun: { filename: 'demo-run.jsonl' },
            expandedTranscriptMessageKeys: new Set(),
        };

        __queenChatViewTestHooks.renderQueenTranscript(container, buildTranscriptEntriesWithTerminalMiddleMessage(), chatState);

        const bodyBeforeExpand = /** @type {HTMLElement | null} */ (
            container.querySelector('.queen-chat-message-body')
        );
        expect(bodyBeforeExpand?.textContent || '').not.toContain('01. Commit+push changes made in this chat');

        const toggleButton = /** @type {HTMLButtonElement | null} */ (
            container.querySelector('.queen-chat-message-expand')
        );
        expect(toggleButton).not.toBeNull();

        toggleButton.click();

        const bodies = Array.from(container.querySelectorAll('.queen-chat-message-body'));
        expect(bodies[1]?.textContent || '').toContain('01. Commit+push changes made in this chat');
        expect(bodies[1]?.textContent || '').toContain('03. Proceed with AI\'s suggested next step(s)');

        layoutSpy.mockRestore();
    });
});
