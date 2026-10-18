// root_redirect_handler.test.js
// Verifies dataset redirect notices and SPA-safe root redirects without a hard reload.
// Bridges mocked redirect storage, toast notifications, translations and post-auth bootstrap calls.
// Exists to keep root-return flows reusable across delete/missing-dataset SPA slices.
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const consumeRedirectNoticeMock = vi.fn();
const runPostAuthBootstrapMock = vi.fn();
const showToastMock = vi.fn();
// Simulates a lookup without readable copy; integration cases use the real translator.
const getTranslationForKeyMock = vi.fn();

function mockCollaborators() {
    vi.doMock("../state_stores/dataset_selection_saver.js", () => ({
        consumeRedirectNotice: consumeRedirectNoticeMock,
    }));
    vi.doMock("../auth/post_auth_bootstrap.js", () => ({
        runPostAuthBootstrap: runPostAuthBootstrapMock,
    }));
    vi.doMock("../../reusable_components/notifications/toast_notification_printer.js", () => ({
        showToast: showToastMock,
    }));
}

async function loadModule() {
    vi.resetModules();
    mockCollaborators();
    vi.doMock("../lang/translation_handler.js", () => ({ getTranslationForKey: getTranslationForKeyMock }));
    return import("./root_redirect_handler.js");
}

// The real page translator, with only its network and view refreshes stubbed.
async function loadWithPageTranslator() {
    vi.resetModules();
    mockCollaborators();
    // Explicit page translations are under test; observers must not outlive a case.
    vi.stubGlobal('MutationObserver', class { observe() {} });
    vi.doUnmock("../lang/translation_handler.js");
    vi.doMock("../endpoints/endpoint_router.js", () => ({ endpoint_router: vi.fn() }));
    vi.doMock("../table_views/card_view/card_view_printer.js", () => ({ refreshCardLanguages: vi.fn() }));
    vi.doMock("../table_views/dataset_value_localizer.js", () => ({ refreshLocalizedDatasetValues: vi.fn() }));
    vi.doMock("../lang/dev_lang_key_editor.js", () => ({ initDevLangKeyEditor: vi.fn() }));
    const handler = await import("./root_redirect_handler.js");
    const { translatePage } = await import("../lang/translation_handler.js");
    return { ...handler, translatePage };
}

// The one toast shown, which must be a text-only translation node.
function shownToastContent() {
    expect(showToastMock).toHaveBeenCalledTimes(1);
    const { content, level } = showToastMock.mock.calls[0][0];
    expect(level).toBe("info");
    expect(content).toBeInstanceOf(HTMLElement);
    expect(content.children).toHaveLength(0);
    return content;
}

describe("root_redirect_handler", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getTranslationForKeyMock.mockImplementation(key => key);
        history.replaceState({}, "", "/app_service_catalog");
        document.documentElement.lang = "fi";
        consumeRedirectNoticeMock.mockReturnValue(null);
        runPostAuthBootstrapMock.mockResolvedValue({ dataLoaded: true });
    });

    afterEach(() => {
        document.body.replaceChildren();
        delete window.translationPromises;
        vi.unstubAllGlobals();
    });

    test("builds deleted-dataset notices in the page's language", async () => {
        const mod = await loadModule();

        expect(mod.buildDatasetRedirectNoticeMessage({ datasetName: "demo_table", reason: "deleted" }))
            .toBe("Taulu demo_table on poistettu. Siirryttiin oletusnäkymään.");
        expect(mod.buildDatasetRedirectNoticeMessage({ reason: "deleted" }))
            .toBe("Taulu on poistettu. Siirryttiin oletusnäkymään.");

        document.documentElement.lang = "en-GB";
        expect(mod.buildDatasetRedirectNoticeMessage({ datasetName: "demo_table", reason: "deleted" }))
            .toBe("Dataset demo_table has been deleted. Switched to the default view.");
        // A notice stored without a reason has always read as a deletion.
        expect(mod.buildDatasetRedirectNoticeMessage({}))
            .toBe("The dataset has been deleted. Switched to the default view.");
        expect(mod.buildDatasetRedirectNoticeMessage(null)).toBe("");
        expect(mod.buildDatasetRedirectNoticeMessage("deleted")).toBe("");
    });

    test("builds missing-dataset notices in the page's language", async () => {
        const mod = await loadModule();

        expect(mod.buildDatasetRedirectNoticeMessage({ datasetName: "ghost_table", reason: "missing" }))
            .toBe("Näkymää ghost_table ei löytynyt. Siirryttiin oletusnäkymään.");
        expect(mod.buildDatasetRedirectNoticeMessage({ reason: "missing" }))
            .toBe("Valittua näkymää ei löytynyt. Siirryttiin oletusnäkymään.");

        document.documentElement.lang = "en";
        expect(mod.buildDatasetRedirectNoticeMessage({ datasetName: "ghost_table", reason: "missing" }))
            .toBe("View ghost_table was not found. Switched to the default view.");
        expect(mod.buildDatasetRedirectNoticeMessage({ reason: "missing" }))
            .toBe("The selected view was not found. Switched to the default view.");
    });

    test("prefers the site's translation and fills its $table_name with the dataset name", async () => {
        getTranslationForKeyMock.mockImplementation((key, { fallback } = {}) => (
            key === "dataset_redirect_missing_named" ? "Sivuston teksti: $table_name puuttuu." : fallback
        ));
        const mod = await loadModule();

        expect(mod.buildDatasetRedirectNoticeMessage({ datasetName: "ghost_table", reason: "missing" }))
            .toBe("Sivuston teksti: ghost_table puuttuu.");
        expect(getTranslationForKeyMock).toHaveBeenCalledWith("dataset_redirect_missing_named", {
            fallback: "Näkymää $table_name ei löytynyt. Siirryttiin oletusnäkymään.",
            countUsage: false,
        });
    });

    test("shows the notice as a translation node that keeps the dataset name as the key's variable", async () => {
        document.documentElement.lang = "en";
        consumeRedirectNoticeMock.mockReturnValue({ datasetName: "ghost_table", reason: "missing" });
        const mod = await loadModule();

        mod.showDatasetRedirectNoticeIfAvailable();

        const content = shownToastContent();
        expect(content.dataset.langKey).toBe("dataset_redirect_missing_named");
        expect(content.dataset.langVariable).toBe("ghost_table");
        expect(content.textContent).toBe("View ghost_table was not found. Switched to the default view.");
    });

    test("keeps a name from the address as literal text outside the key", async () => {
        consumeRedirectNoticeMock.mockReturnValue({ datasetName: "a+b<img src=x onerror=alert(1)>", reason: "missing" });
        const mod = await loadModule();

        mod.showDatasetRedirectNoticeIfAvailable();

        const content = shownToastContent();
        expect(content.dataset.langKey).toBe("dataset_redirect_missing_named");
        expect(content.dataset.langVariable).toBe("a+b<img src=x onerror=alert(1)>");
        expect(content.textContent)
            .toBe("Näkymää a+b<img src=x onerror=alert(1)> ei löytynyt. Siirryttiin oletusnäkymään.");
    });

    test("shows a notice without a name without a variable", async () => {
        consumeRedirectNoticeMock.mockReturnValue({ reason: "missing" });
        const mod = await loadModule();

        mod.showDatasetRedirectNoticeIfAvailable();

        const content = shownToastContent();
        expect(content.dataset.langKey).toBe("dataset_redirect_missing");
        expect(content.hasAttribute("data-lang-variable")).toBe(false);
        expect(content.textContent).toBe("Valittua näkymää ei löytynyt. Siirryttiin oletusnäkymään.");
    });

    test("redirects to root in the SPA and shows any queued redirect notice", async () => {
        consumeRedirectNoticeMock.mockReturnValue({
            datasetName: "demo_table",
            reason: "deleted",
        });
        const mod = await loadModule();

        await mod.redirectToRootInSpa();

        expect(window.location.pathname).toBe("/");
        expect(runPostAuthBootstrapMock).toHaveBeenCalledWith({ refreshAuthModes: false });
        const content = shownToastContent();
        expect(content.dataset.langKey).toBe("dataset_redirect_deleted_named");
        expect(content.dataset.langVariable).toBe("demo_table");
        expect(content.textContent).toBe("Taulu demo_table on poistettu. Siirryttiin oletusnäkymään.");
    });

    test("showDatasetRedirectNoticeIfAvailable is a no-op when no notice is queued", async () => {
        const mod = await loadModule();

        mod.showDatasetRedirectNoticeIfAvailable();

        expect(showToastMock).not.toHaveBeenCalled();
    });

    test("replays only fixed management result keys as localized text nodes on startup", async () => {
        const mod = await loadModule();
        for (const [key, expected] of [
            ['manage_table_hidden_success', 'Aineisto poistettu käyttöliittymästä. Tiedot säilyvät.'],
            ['manage_table_deleted_success', 'Aineisto poistettu pysyvästi.'],
        ]) {
            document.documentElement.lang = 'fi';
            consumeRedirectNoticeMock.mockReturnValue({ datasetName: 'demo', messageLangKey: key });
            mod.showDatasetRedirectNoticeIfAvailable();
            const { content, level } = showToastMock.mock.calls.at(-1)[0];
            expect(level).toBe("info");
            expect(content).toBeInstanceOf(HTMLElement);
            expect(content.dataset.langKey).toBe(key);
            expect(content.hasAttribute("data-lang-variable")).toBe(false);
            expect(content.textContent).toBe(expected);
            expect(content.children).toHaveLength(0);
        }
        expect(mod.buildDatasetRedirectNoticeMessage({
            datasetName: 'demo', reason: 'deleted', messageLangKey: '<img src=x onerror=alert(1)>',
        })).toBe('Taulu demo on poistettu. Siirryttiin oletusnäkymään.');
    });

    const noticeCases = [
        ['missing', 'ghost+<b>name</b>', 'dataset_redirect_missing_named'],
        ['missing', '', 'dataset_redirect_missing'],
        ['deleted', 'old+<b>name</b>', 'dataset_redirect_deleted_named'],
        ['deleted', '', 'dataset_redirect_deleted'],
    ];

    describe.each(['fi', 'en'])('%s startup without reviewed translations', (language) => {
        test.each(noticeCases)('%s notice with name "%s" survives a language switch', async (reason, datasetName, key) => {
            document.documentElement.lang = language;
            consumeRedirectNoticeMock.mockReturnValue({ reason, datasetName });
            const { showDatasetRedirectNoticeIfAvailable, translatePage } = await loadWithPageTranslator();
            const { DATASET_REDIRECT_NOTICE_TRANSLATION_FALLBACKS: copy } = await import('./dataset_redirect_notice_copy.js');

            showDatasetRedirectNoticeIfAvailable();
            const content = shownToastContent();
            document.body.append(content);
            expect(content.textContent).toBe(copy[key][language].replace('$table_name', datasetName));

            // Both the selected store and the English default lack all notice keys.
            window.translationPromises = { fi: Promise.resolve({}), en: Promise.resolve({}) };
            for (const selected of [language, language === 'fi' ? 'en' : 'fi', language]) {
                await translatePage(selected);
                expect(document.documentElement.lang).toBe(selected);
                expect(content.dataset.langKey).toBe(key);
                expect(content.getAttribute('data-lang-variable')).toBe(datasetName || null);
                expect(content.textContent).toBe(copy[key][selected].replace('$table_name', datasetName));
                expect(content.children).toHaveLength(0);
            }
        });
    });

    test.each(noticeCases)('retranslates %s notices with name "%s" through the shared page translator', async (reason, datasetName, key) => {
        consumeRedirectNoticeMock.mockReturnValue({ reason, datasetName });
        const { showDatasetRedirectNoticeIfAvailable, translatePage } = await loadWithPageTranslator();
        const { DATASET_REDIRECT_NOTICE_TRANSLATION_FALLBACKS: copy } = await import('./dataset_redirect_notice_copy.js');
        showDatasetRedirectNoticeIfAvailable();
        const content = shownToastContent();
        document.body.append(content);
        for (const language of ['en', 'fi']) {
            window.translationPromises = { [language]: Promise.resolve({ [key]: copy[key][language] }) };
            await translatePage(language);
            expect(content.dataset.langKey).toBe(key);
            expect(content.dataset.langVariable || '').toBe(datasetName);
            expect(content.textContent).toBe(copy[key][language].replace('$table_name', datasetName));
            expect(content.children).toHaveLength(0);
        }
    });

    test("the page translator replaces the startup copy in the selected language and keeps the name", async () => {
        consumeRedirectNoticeMock.mockReturnValue({ datasetName: "ghost_table", reason: "missing" });
        const { showDatasetRedirectNoticeIfAvailable, translatePage } = await loadWithPageTranslator();

        // Startup shows the notice before any translation has been fetched.
        showDatasetRedirectNoticeIfAvailable();
        const content = shownToastContent();
        document.body.append(content);
        expect(content.textContent).toBe("Näkymää ghost_table ei löytynyt. Siirryttiin oletusnäkymään.");

        // Translations that predate the seed keep the readable copy, never a key name.
        window.translationPromises = { en: Promise.resolve({}) };
        await translatePage("en");
        expect(content.textContent).toBe("View ghost_table was not found. Switched to the default view.");

        // The site's reviewed copy replaces it and follows a language change.
        window.translationPromises = {
            en: Promise.resolve({ dataset_redirect_missing_named: "Site copy: $table_name is gone." }),
            fi: Promise.resolve({ dataset_redirect_missing_named: "Sivuston teksti: $table_name puuttuu." }),
        };
        await translatePage("fi");
        expect(content.textContent).toBe("Sivuston teksti: ghost_table puuttuu.");
        await translatePage("en");
        expect(content.textContent).toBe("Site copy: ghost_table is gone.");
        expect(content.children).toHaveLength(0);
    });
});
