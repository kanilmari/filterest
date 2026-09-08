// Presents one friendly recovery dialog when a protected view outlives its login session.
// Bridges guest access denials with home, login, and optional registration choices.
// Exists so concurrent API failures never expose endpoint names or permission internals to users.

import { createModal, hideModal, showModal } from '../../reusable_components/modal/modal_builder.js';
import { getLanguageWithBrowserFallback } from '../state_stores/lang_preference_reader.js';
import { clearDatasetSelectionState } from '../state_stores/dataset_selection_saver.js';
import { OTHER_TAB_LOGOUT_NOTICE } from './auth_session_notice_handler.js';

let promptVisible = false;

function sessionAccessPromptIsOpen() {
    const overlay = document.getElementById('custom_modal_overlay');
    return Boolean(
        overlay
        && overlay.style.display !== 'none'
        && overlay.querySelector('[data-testid="session-access-message"]')
    );
}

function resolveCopy(languageCode = getLanguageWithBrowserFallback(), reason = 'session-ended') {
    const loggedOutInAnotherTab = reason === OTHER_TAB_LOGOUT_NOTICE;
    if (localStorage.getItem('show_login_button') === 'false') {
        return String(languageCode).toLowerCase().startsWith('fi')
            ? { title: 'Sisältö ei ole käytettävissä', message: 'Tätä sisältöä ei voi näyttää. Voit palata etusivulle.', home: 'Etusivulle', register: 'Rekisteröidy' }
            : { title: 'Content unavailable', message: 'This content cannot be displayed. You can return to the home page.', home: 'Home', register: 'Register' };
    }
    if (String(languageCode).toLowerCase().startsWith('fi')) {
        return {
            title: 'Kirjautuminen tarvitaan',
            message: loggedOutInAnotherTab
                ? 'Sinut kirjattiin ulos toisessa välilehdessä. Voit siirtyä etusivulle tai kirjautua uudelleen.'
                : 'Et ole enää kirjautuneena sisään. Voit siirtyä etusivulle tai kirjautua uudelleen.',
            home: 'Etusivulle',
            login: 'Kirjaudu sisään',
            register: 'Rekisteröidy',
        };
    }
    return {
        title: 'Sign-in required',
        message: loggedOutInAnotherTab
            ? 'You were signed out in another tab. You can go to the home page or sign in again.'
            : 'You are no longer signed in. You can go to the home page or sign in again.',
        home: 'Home',
        login: 'Sign in',
        register: 'Register',
    };
}

function currentReturnPath() {
    const path = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    return path && path !== '/' && !path.startsWith('/login') ? path : '';
}

function createActionButton(text, classNames, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.classList.add('fw-btn', ...classNames);
    button.textContent = text;
    button.addEventListener('click', onClick);
    return button;
}

/**
 * Shows a de-duplicated session recovery dialog for a guest access denial.
 * Between the shared API pipeline and the existing login/register entry flows.
 * Exists so many simultaneous startup requests still produce one clear decision.
 */
export function requestSessionAccessPrompt({ reason = 'session-ended' } = {}) {
    if (promptVisible && sessionAccessPromptIsOpen()) return;
    promptVisible = true;

    const copy = resolveCopy(getLanguageWithBrowserFallback(), reason);
    const message = document.createElement('p');
    message.dataset.testid = 'session-access-message';
    message.textContent = copy.message;

    const actions = document.createElement('div');
    actions.classList.add('form-actions');

    const homeButton = createActionButton(copy.home, ['fw-btn--ghost'], () => {
        clearDatasetSelectionState();
        hideModal();
        promptVisible = false;
        window.location.assign('/');
    });
    homeButton.dataset.testid = 'session-access-home';

    const loginButton = createActionButton(copy.login, ['fw-btn--primary'], async () => {
        const returnPath = currentReturnPath();
        hideModal();
        promptVisible = false;
        const { showLoginModal } = await import('./login_modal_printer.js');
        await showLoginModal(returnPath);
    });
    loginButton.dataset.testid = 'session-access-login';

    actions.append(homeButton);
    if (localStorage.getItem('show_login_button') !== 'false') {
        actions.append(loginButton);
    }

    if (localStorage.getItem('registration_enabled') === 'true' && localStorage.getItem('only_admin_can_login') !== 'true') {
        const registerButton = createActionButton(copy.register, ['fw-btn--ghost'], () => {
            clearDatasetSelectionState();
            hideModal();
            promptVisible = false;
            window.location.assign('/register');
        });
        registerButton.dataset.testid = 'session-access-register';
        actions.insertBefore(registerButton, loginButton.parentNode === actions ? loginButton : null);
    }

    createModal({
        titlePlainText: copy.title,
        contentElements: [message],
        footerElements: [actions],
        width: 'min(520px, calc(100vw - 32px))',
        maxWidth: 'calc(100vw - 32px)',
    });
    showModal();
}

export function resetSessionAccessPromptForTests() {
    promptVisible = false;
}
