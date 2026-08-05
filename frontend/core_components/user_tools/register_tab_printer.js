// register_tab_printer.js
// Renders the "Register" account-creation form inside a given container element.
// Bridges the user tools tab container with a registration form and submit handler.
// Exists to render a standalone registration form as a navigable tab in the user tools panel.
// PIPELINE_EXCEPTION: Register fragments are pre-auth HTML form loads/submits, not JSON API calls.

import { handleLoginShellEntry, navigateToLoginEntry } from "../auth/login_shell_entry.js";
import { translatePage } from "../lang/translation_handler.js";
import { getLanguageWithBrowserFallback } from "../state_stores/lang_preference_reader.js";

const REGISTER_FRAGMENT_PATH = "/register_ndYOyXV0INOK3F?fragment=1";

function parseRegisterForm(htmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, "text/html");
    const form = doc.querySelector('[data-testid="register-form"]');
    if (!(form instanceof HTMLFormElement)) {
        throw new Error("Register form not found in fragment response");
    }
    return form;
}

function isSuccessfulRegisterRedirect(response) {
    if (!response?.redirected || !response.url) {
        return false;
    }

    try {
        const parsedUrl = new URL(response.url, window.location.origin);
        return parsedUrl.origin === window.location.origin
            && (parsedUrl.pathname === "/" || parsedUrl.pathname === "/login");
    } catch (error) {
        console.warn("isSuccessfulRegisterRedirect failed:", error);
        return false;
    }
}

async function mountRegisterForm(container, form) {
    form.addEventListener("submit", async (evt) => {
        evt.preventDefault();

        const submitButton = form.querySelector('[data-testid="register-submit"]');
        if (submitButton instanceof HTMLInputElement || submitButton instanceof HTMLButtonElement) {
            submitButton.disabled = true;
        }

        try {
            // PIPELINE_EXCEPTION: submit posts the server-rendered register form with its hidden CSRF field.
            const response = await fetch(form.action, {
                method: form.method || "POST",
                body: new URLSearchParams(new FormData(form)),
                credentials: "include",
                headers: {
                    Accept: "text/html",
                },
            });

            if (isSuccessfulRegisterRedirect(response)) {
                navigateToLoginEntry();
                await handleLoginShellEntry();
                return;
            }

            const nextHtml = await response.text();
            const nextForm = parseRegisterForm(nextHtml);
            await mountRegisterForm(container, nextForm);
        } catch (error) {
            console.warn("Register submit failed:", error);
            if (submitButton instanceof HTMLInputElement || submitButton instanceof HTMLButtonElement) {
                submitButton.disabled = false;
            }
        }
    });

    container.replaceChildren(form);
    await translatePage(getLanguageWithBrowserFallback());
}

/**
 * Rakentaa "Register" -lomakkeen annetun containerin sisään.
 */
export async function generate_register_view(container) {
    try {
        container.replaceChildren();

        // PIPELINE_EXCEPTION: the register tab fetches a server-rendered HTML form fragment before login.
        const response = await fetch(REGISTER_FRAGMENT_PATH, {
            credentials: "include",
            headers: {
                Accept: "text/html",
            },
        });

        if (!response.ok) {
            throw new Error(`Register fragment fetch failed: ${response.status}`);
        }

        const htmlText = await response.text();
        const form = parseRegisterForm(htmlText);
        await mountRegisterForm(container, form);
    } catch (error) {
        console.warn("Error in generate_register_view:", error);
    }
}
