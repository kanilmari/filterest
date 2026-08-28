// login_redirect_handler.test.js
// Verifies auth redirects only show login UI after explicit user action.
// Bridges forced-login localStorage state, modal loading, and hard navigation in jsdom.
// Exists to prevent automatic auth failures from interrupting public browsing with a modal.
// @vitest-environment jsdom

import { describe, test, expect, beforeEach, vi } from 'vitest';

const showLoginModalMock = vi.fn().mockResolvedValue(undefined);
const clearDatasetSelectionStateMock = vi.fn();

async function loadModule() {
    vi.resetModules();
    vi.doMock('./login_modal_printer.js', () => ({
        showLoginModal: showLoginModalMock,
    }));
    vi.doMock('../state_stores/dataset_selection_saver.js', () => ({
        clearDatasetSelectionState: clearDatasetSelectionStateMock,
    }));
    return import('./login_redirect_handler.js');
}

describe('requestLoginRedirect', () => {
    let assignSpy;

    beforeEach(() => {
        showLoginModalMock.mockReset().mockResolvedValue(undefined);
        clearDatasetSelectionStateMock.mockReset();
        vi.restoreAllMocks();

        assignSpy = vi.fn();
        Object.defineProperty(window, 'location', {
            value: { ...window.location, assign: assignSpy, pathname: '/', search: '', hash: '' },
            writable: true,
            configurable: true,
        });
        localStorage.clear();
    });

    test('does not show login modal on automatic auth failure', async () => {
        const mod = await loadModule();
        await mod.requestLoginRedirect();
        expect(showLoginModalMock).not.toHaveBeenCalled();
    });

    test('does not clear dataset selection on ignored automatic auth failure', async () => {
        const mod = await loadModule();
        await mod.requestLoginRedirect();
        expect(clearDatasetSelectionStateMock).not.toHaveBeenCalled();
    });

    test('shows login modal on explicit login action', async () => {
        const mod = await loadModule();
        await mod.requestLoginRedirect({ userInitiated: true });
        expect(showLoginModalMock).toHaveBeenCalledTimes(1);
    });

    test('clears dataset selection state before explicit login modal', async () => {
        const mod = await loadModule();
        await mod.requestLoginRedirect({ userInitiated: true });
        expect(clearDatasetSelectionStateMock).toHaveBeenCalledTimes(1);
    });

    test('skips when already on /login', async () => {
        Object.defineProperty(window, 'location', {
            value: { ...window.location, assign: assignSpy, pathname: '/login', search: '', hash: '' },
            writable: true,
            configurable: true,
        });
        const mod = await loadModule();
        await mod.requestLoginRedirect({ userInitiated: true });
        expect(showLoginModalMock).not.toHaveBeenCalled();
    });

    test('hard-navigates to standalone /login when browse requires login', async () => {
        localStorage.setItem('login_required_for_browse', 'true');
        Object.defineProperty(window, 'location', {
            value: {
                ...window.location,
                assign: assignSpy,
                pathname: '/reports',
                search: '?view=compact',
                hash: '#filters',
            },
            writable: true,
            configurable: true,
        });
        const mod = await loadModule();

        await mod.requestLoginRedirect();

        expect(assignSpy).toHaveBeenCalledWith('/login?redirect=%2Freports%3Fview%3Dcompact%23filters');
        expect(showLoginModalMock).not.toHaveBeenCalled();
    });

    test('omits redirect query when forced-login redirect starts from root', async () => {
        localStorage.setItem('login_required_for_browse', 'true');
        const mod = await loadModule();

        await mod.requestLoginRedirect();

        expect(assignSpy).toHaveBeenCalledWith('/login');
        expect(showLoginModalMock).not.toHaveBeenCalled();
    });

    test('deduplicates concurrent calls', async () => {
        showLoginModalMock.mockReturnValue(new Promise(resolve => setTimeout(resolve, 50)));
        const mod = await loadModule();
        const p1 = mod.requestLoginRedirect();
        const p2 = mod.requestLoginRedirect();
        await Promise.all([p1, p2]);
        expect(showLoginModalMock).not.toHaveBeenCalled();
    });

    test('deduplicates concurrent explicit login actions', async () => {
        showLoginModalMock.mockReturnValue(new Promise(resolve => setTimeout(resolve, 50)));
        const mod = await loadModule();
        const p1 = mod.requestLoginRedirect({ userInitiated: true });
        const p2 = mod.requestLoginRedirect({ userInitiated: true });
        await Promise.all([p1, p2]);
        expect(showLoginModalMock).toHaveBeenCalledTimes(1);
    });

    test('resets guard after completion so subsequent explicit calls work', async () => {
        const mod = await loadModule();
        await mod.requestLoginRedirect({ userInitiated: true });
        await mod.requestLoginRedirect({ userInitiated: true });
        expect(showLoginModalMock).toHaveBeenCalledTimes(2);
    });

    test('never calls window.location.assign for the explicit modal path', async () => {
        const mod = await loadModule();
        await mod.requestLoginRedirect({ userInitiated: true });
        expect(assignSpy).not.toHaveBeenCalled();
    });
});
