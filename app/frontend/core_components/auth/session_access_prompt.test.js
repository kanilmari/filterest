// @vitest-environment jsdom
// Verifies the guest-session recovery dialog and its conditional registration action.
// Bridges session access denial UI with the existing login modal and navigation choices.
// Exists to keep technical 403 details out of the user-facing recovery path.

import { beforeEach, describe, expect, test, vi } from 'vitest';

const showLoginModalMock = vi.fn().mockResolvedValue(undefined);
const clearDatasetSelectionStateMock = vi.fn();

vi.mock('./login_modal_printer.js', () => ({
    showLoginModal: showLoginModalMock,
}));
vi.mock('../state_stores/dataset_selection_saver.js', () => ({
    clearDatasetSelectionState: clearDatasetSelectionStateMock,
}));

describe('session access prompt', () => {
    beforeEach(async () => {
        localStorage.clear();
        document.body.replaceChildren();
        history.replaceState({}, '', '/app_service_catalog?view=card');
        showLoginModalMock.mockReset().mockResolvedValue(undefined);
        clearDatasetSelectionStateMock.mockReset();
        const mod = await import('./session_access_prompt.js');
        mod.resetSessionAccessPromptForTests();
    });

    test('deduplicates concurrent prompts and hides registration when disabled', async () => {
        const mod = await import('./session_access_prompt.js');
        mod.requestSessionAccessPrompt();
        mod.requestSessionAccessPrompt();

        expect(document.querySelectorAll('[data-testid="session-access-message"]')).toHaveLength(1);
        expect(document.querySelector('[data-testid="session-access-register"]')).toBeNull();
    });

    test('offers registration when enabled and opens login with the current return path', async () => {
        localStorage.setItem('registration_enabled', 'true');
        const mod = await import('./session_access_prompt.js');
        mod.requestSessionAccessPrompt();

        expect(document.querySelector('[data-testid="session-access-register"]')).not.toBeNull();
        document.querySelector('[data-testid="session-access-login"]').click();
        await vi.waitFor(() => {
            expect(showLoginModalMock).toHaveBeenCalledWith('/app_service_catalog?view=card');
        });
    });

    test.each([['fi', 'Sisältö ei ole käytettävissä'], ['en', 'Content unavailable']])('does not offer login on a public site in %s', async (language, title) => {
        localStorage.setItem('chosen_language', language);
        localStorage.setItem('show_login_button', 'false');
        localStorage.setItem('only_admin_can_login', 'true');
        localStorage.setItem('registration_enabled', 'true');
        const mod = await import('./session_access_prompt.js');
        mod.requestSessionAccessPrompt();
        expect(document.querySelector('[data-testid="session-access-home"]')).not.toBeNull();
        expect(document.querySelector('[data-testid="session-access-login"]')).toBeNull();
        expect(document.querySelector('[data-testid="session-access-register"]')).toBeNull();
        expect(document.body.textContent).toContain(title);
    });

    test('can be shown again after the shared close button dismisses it', async () => {
        const mod = await import('./session_access_prompt.js');
        mod.requestSessionAccessPrompt();
        document.querySelector('[data-testid="modal-close-button"]').click();

        mod.requestSessionAccessPrompt();

        const overlay = document.querySelector('[data-testid="modal-overlay-container"]');
        expect(overlay.style.display).toBe('flex');
        expect(overlay.querySelector('[data-testid="session-access-message"]')).not.toBeNull();
    });

    test('explains a logout that arrived from another tab', async () => {
        const mod = await import('./session_access_prompt.js');

        mod.requestSessionAccessPrompt({ reason: 'logged-out-another-tab' });

        expect(document.querySelector('[data-testid="session-access-message"]').textContent)
            .toContain('another tab');
    });
});
