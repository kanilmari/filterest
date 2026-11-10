// @vitest-environment jsdom
// row_presentation_dispatcher.test.js
// Verifies exact row dispatch, inherited settings and permission boundaries.
// Connects tab choices and authorized defaults to the row openers, including document bootstrap.
// Keeps reload persistence distinct from the displayed dataset view and open-row state.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { grants, fetchRows, openImage, denied, failed } = vi.hoisted(() => ({
    grants: new Set(), fetchRows: vi.fn(), openImage: vi.fn(), denied: vi.fn(), failed: vi.fn(),
}));
vi.mock("../../route_permission_checker.js", () => ({ hasRoutePermission: route => grants.has(route) }));
vi.mock("../../endpoints/endpoint_data_fetcher.js", () => ({ fetchDatasetData: fetchRows }));
vi.mock("../card_view/image_first_view_opener.js", () => ({ openImageFirstView: openImage }));
vi.mock("../../../reusable_components/notifications/toast_notification_printer.js", () => ({ showToast: failed }));
vi.mock("../card_view/article_view_access.js", async importActual => ({
    ...(await importActual()), showArticleViewAccessDenied: denied,
}));

import { datasetAppearanceState as appearance } from "../dataset_appearance_state.js";
import { DEFAULT_DATASET_APPEARANCE } from "../../../shared/dataset_appearance/validator.js";
import { appearanceValuesForPlace } from "../../../shared/dataset_appearance/snapshot.js";
import { acceptSessionIdentity, getSessionGeneration, invalidateSessionGeneration } from "../../auth/session_generation_store.js";
import { beginRowPresentationRequest, getStoredRowPresentation, readRowOpeningChoice, resetRowPresentationChoice, setRowPresentationChoice } from "./row_presentation_choice.js";
import { openDefaultRowPresentation, resolveRowOpening } from "./row_presentation_dispatcher.js";
import { ensureHistoryEntryId, writeHistoryEntry } from "../../navigation/nav_engine/history_entry_state.js";
import { getSelectedDataset, setSelectedDataset } from "../../state_stores/dataset_selection_saver.js";
import { VIEW_DEACTIVATE_EVENT } from "../../../reusable_components/view_lifecycle_events.js";

const ARTICLE = "article_view", IFAV = "image_first_view", PAGE = "image_first_page_view";
const PATH = "shared.row_article_default_presentation";
const classicGrant = "/ui/view/article_view", pageGrant = "/ui/view/image_first_page_view";

function snapshot(site, dataset, uid = 7) {
    const config = structuredClone(DEFAULT_DATASET_APPEARANCE);
    config.shared.row_article_default_presentation = site;
    return { dataset_uid: uid, schema_version: 2, version: "1", shared_version: "s1",
        defaults: appearanceValuesForPlace(config, "site_default"),
        site_values: appearanceValuesForPlace(config, "site_only"), tab_values: appearanceValuesForPlace(config, "tab_only"),
        overrides: dataset ? { [PATH]: dataset } : {} };
}

beforeEach(() => {
    sessionStorage.clear(); appearance.clear(); grants.clear(); grants.add(classicGrant); grants.add(pageGrant);
    invalidateSessionGeneration({ revalidate: false });
    acceptSessionIdentity(42, getSessionGeneration());
    fetchRows.mockReset(); openImage.mockReset().mockResolvedValue({}); denied.mockReset(); failed.mockReset();
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock('../../pipeline/api_pipeline.js');
});

describe("row presentation resolution", () => {
    test("an explicit address wins for this row, then user, table, site and compatible classic", async () => {
        expect(readRowOpeningChoice("trips").status).toBe("pending");
        expect(appearance.accept("trips", snapshot(PAGE, IFAV))).toBe(true);
        setRowPresentationChoice("trips", ARTICLE);
        expect(await resolveRowOpening("trips", { viewKey: PAGE })).toMatchObject({ viewKey: PAGE, source: "explicit" });
        expect(getStoredRowPresentation("trips")).toBe(ARTICLE);
        expect(await resolveRowOpening("trips")).toMatchObject({ viewKey: ARTICLE, source: "user" });
        expect(await resolveRowOpening("trips", { useTabChoice: false })).toMatchObject({ viewKey: IFAV, source: "dataset" });
        resetRowPresentationChoice("trips");
        expect(await resolveRowOpening("trips")).toMatchObject({ viewKey: IFAV, source: "dataset" });
        expect(appearance.accept("trips", snapshot(PAGE, null))).toBe(true);
        expect(await resolveRowOpening("trips")).toMatchObject({ viewKey: PAGE, source: "site" });
        expect(readRowOpeningChoice("trips", { defaults: {} })).toMatchObject({ viewKey: ARTICLE, source: "classic" });
        expect(fetchRows).not.toHaveBeenCalled();
    });

    test("forbidden explicit choice is denied, an implicit forbidden or stale override may inherit", async () => {
        grants.delete(classicGrant);
        appearance.accept("trips", snapshot(PAGE, IFAV));
        setRowPresentationChoice("trips", ARTICLE);
        expect(await resolveRowOpening("trips", { viewKey: ARTICLE })).toMatchObject({ status: "denied" });
        expect(await resolveRowOpening("trips")).toMatchObject({ viewKey: PAGE, source: "site" });
        expect(readRowOpeningChoice("trips", { defaults: { site: ARTICLE, dataset: "unknown" } }).status).toBe("denied");
        expect(fetchRows).not.toHaveBeenCalled();
    });

    test("only saved site values affect opening, and tab state follows identity", () => {
        appearance.accept("trips", snapshot(ARTICLE, null));
        const config = structuredClone(DEFAULT_DATASET_APPEARANCE);
        config.shared.row_article_default_presentation = PAGE;
        appearance.updateSite(config, { version: "s2", preview: true });
        expect(readRowOpeningChoice("trips").viewKey).toBe(ARTICLE);
        appearance.updateSite(config, { version: "s2" });
        expect(readRowOpeningChoice("trips").viewKey).toBe(PAGE);
        setRowPresentationChoice("trips", IFAV);
        invalidateSessionGeneration({ reason: "blur" });
        expect(getStoredRowPresentation("trips")).toBe(IFAV);
        invalidateSessionGeneration({ reason: "login" });
        expect(getStoredRowPresentation("trips")).toBeNull();
    });
});

describe("cold row opening", () => {
    test.each(['current', 'request', 'caller', 'history', 'selection'])(
        'classic completion guards only the article after its own transition (%s)', async change => {
            history.replaceState({}, '', '/origin?view=card');
            setSelectedDataset('origin');
            let finish, callerCurrent = true;
            const article = vi.fn();
            const openClassic = async (_row, _table, _card, { isCurrent, withOwnAddressWrite }) => {
                await withOwnAddressWrite(async () => {
                    await new Promise(resolve => { finish = resolve; });
                    writeHistoryEntry('/trips?view=article_view');
                    document.dispatchEvent(new CustomEvent(VIEW_DEACTIVATE_EVENT));
                    setSelectedDataset(change === 'selection' ? 'elsewhere' : 'trips');
                });
                if (isCurrent() && getSelectedDataset() === 'trips') article();
            };
            const pending = openDefaultRowPresentation({ id: 24 }, 'trips', null, {
                viewKey: ARTICLE, openClassic, isCurrent: () => callerCurrent,
            });
            await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
            if (change === 'request') beginRowPresentationRequest('other');
            else if (change === 'caller') callerCurrent = false;
            else if (change === 'history') window.dispatchEvent(new PopStateEvent('popstate'));
            finish();
            await pending;
            expect(article).toHaveBeenCalledTimes(change === 'current' ? 1 : 0);
        },
    );

    test('a pending own write cannot suppress view deactivation of a newer ticket', async () => {
        const older = beginRowPresentationRequest('origin');
        let finish;
        const pending = older.withOwnAddressWrite(() => new Promise(resolve => { finish = resolve; }));
        const newer = beginRowPresentationRequest('trips');
        document.dispatchEvent(new CustomEvent(VIEW_DEACTIVATE_EVENT));
        expect(newer()).toBe(false);
        finish();
        await pending;
        expect(older()).toBe(false);
        expect(newer()).toBe(false);
    });

    test.each(["address", "request", "caller"])("classic origin preparation survives its own write but still cancels after a later %s change", async change => {
        history.replaceState({}, "", "/trips?view=card");
        let callerCurrent = true;
        const openClassic = vi.fn(async (_row, _table, _card, { isCurrent, withOwnAddressWrite }) => {
            withOwnAddressWrite(() => ensureHistoryEntryId());
            expect(history.state.__filterestEntryId).toBeTypeOf("string");
            expect(isCurrent()).toBe(true);
            await Promise.resolve();
            if (change === "address") writeHistoryEntry(location.href, {}, { replace: true });
            else if (change === "request") beginRowPresentationRequest("other");
            else callerCurrent = false;
            expect(isCurrent()).toBe(false);
        });
        await openDefaultRowPresentation({ id: 24 }, "trips", null, {
            viewKey: ARTICLE, openClassic, isCurrent: () => callerCurrent,
        });
        expect(openClassic).toHaveBeenCalledOnce();
    });

    test("foreign row uses target's authorized settings and the exact ID, with Page-only projection", async () => {
        appearance.accept("other", snapshot(IFAV, null, 8));
        grants.delete(classicGrant);
        fetchRows.mockResolvedValue({ data: [{ id: 81 }], dataset_appearance: snapshot(PAGE, null) });
        const result = await openDefaultRowPresentation({ id: "81", secret: "untrusted" }, "trips", null, { search: "?sort_order=DESC" });
        expect(fetchRows).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
            dataset_name: "trips", view_key: PAGE, filters: { id: "81", limit: 1 },
        }));
        expect(result).toMatchObject({ status: "opened", source: "site", viewKey: PAGE });
        expect(openImage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
            rowItem: { id: "81" }, tableName: "trips", layout: "page", presentationChoice: true, search: "?sort_order=DESC",
        }));
    });

    test("an allowed explicit row mode bypasses a cold lookup and supports text-only IFAV", async () => {
        expect(await openDefaultRowPresentation({ id: 24 }, "trips", null, { viewKey: IFAV })).toMatchObject({ status: "opened" });
        expect(fetchRows).not.toHaveBeenCalled();
        expect(openImage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
            rowItem: { id: 24 }, layout: "image_first", presentationChoice: true,
        }));
        expect(getStoredRowPresentation("trips")).toBeNull();
    });

    test.each([{}, { data: [{ id: 999 }] }, { error: "denied" }])("failed metadata/row lookup never retries another view", async response => {
        fetchRows.mockResolvedValue(response);
        const openClassic = vi.fn();
        expect(await openDefaultRowPresentation({ id: 24 }, "trips", null, { openClassic })).toMatchObject({ status: "failed" });
        expect(fetchRows).toHaveBeenCalledTimes(1);
        expect(failed).toHaveBeenCalledTimes(1);
        expect(openImage).not.toHaveBeenCalled();
        expect(openClassic).not.toHaveBeenCalled();
    });

    test("a navigation during the authorized metadata request cannot open or store its old result", async () => {
        let current = true;
        fetchRows.mockImplementation(async () => {
            current = false;
            return { data: [{ id: 7 }], dataset_appearance: snapshot(PAGE, null) };
        });
        expect(await openDefaultRowPresentation({ id: 7 }, "other", null, { isCurrent: () => current })).toMatchObject({ status: "stale" });
        expect(appearance.savedSnapshot("other")).toBeNull();
        expect(openImage).not.toHaveBeenCalled();
        expect(failed).not.toHaveBeenCalled();
    });
});

describe("row choices across document loads", () => {
    test.each([42, 73])('retained choices wait unchanged until an existing profile confirms viewer %s', async viewer => {
        setRowPresentationChoice('trips', ARTICLE);
        vi.resetModules();
        const choice = await import('./row_presentation_choice.js');
        const session = await import('../../auth/session_generation_store.js');
        const { runApiPipeline } = await import('../../pipeline/api_pipeline.js');
        session.invalidateSessionGeneration({ reason: 'bootstrap', revalidate: false });
        const reloadedAppearance = (await import('../dataset_appearance_state.js')).datasetAppearanceState;
        reloadedAppearance.accept('trips', snapshot(PAGE, null));
        const { createRowPresentationSplitButton } = await import('./row_presentation_split_button.js');
        const button = createRowPresentationSplitButton({ tableName: 'trips' });
        document.body.append(button);
        const primary = button.querySelector('.row-presentation-split__primary');
        expect(primary.dataset.presentation).toBe(PAGE);
        const expectPending = () => {
            expect(session.getVerifiedSessionIdentity()).toBeNull();
            expect(choice.getStoredRowPresentation('trips')).toBeNull();
            expect(sessionStorage.getItem('trips_row_presentation')).toBe(ARTICLE);
            expect(sessionStorage.getItem('trips_row_presentation_owner')).toBe('42');
        };
        expectPending();
        let finishProfile;
        const fetch = vi.fn(() => new Promise(resolve => { finishProfile = resolve; }));
        vi.stubGlobal('fetch', fetch);
        const pending = runApiPipeline({ routeName: 'fetchUserProfile' });
        await vi.waitFor(() => expect(finishProfile).toBeTypeOf('function'));
        expectPending();
        finishProfile(new Response(JSON.stringify({ user_id: viewer }), { headers: { 'Content-Type': 'application/json' } }));
        await pending;
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(session.getVerifiedSessionIdentity()).toBe(viewer);
        expect(choice.getStoredRowPresentation('trips')).toBe(viewer === 42 ? ARTICLE : null);
        expect(sessionStorage.getItem('trips_row_presentation')).toBe(viewer === 42 ? ARTICLE : null);
        expect(sessionStorage.getItem('trips_row_presentation_owner')).toBe(viewer === 42 ? '42' : null);
        expect(primary.dataset.presentation).toBe(viewer === 42 ? ARTICLE : PAGE);
        button.remove();
    });

    test.each([
        ["table override", IFAV, IFAV, "dataset"],
        ["app default", null, PAGE, "site"],
    ])("a same-tab reload keeps Article over IFAV; an empty new tab uses its %s", async (_label, override, fallback, source) => {
        appearance.accept("trips", snapshot(PAGE, IFAV));
        setRowPresentationChoice("trips", ARTICLE);
        expect(sessionStorage.getItem("trips_row_presentation")).toBe(ARTICLE);

        // A full document load recreates module state but keeps this tab's sessionStorage.
        vi.resetModules();
        const reloadedChoice = await import("./row_presentation_choice.js");
        const reloadedSession = await import("../../auth/session_generation_store.js");
        const reloadedAppearance = (await import("../dataset_appearance_state.js")).datasetAppearanceState;
        const reloadedDispatcher = await import("./row_presentation_dispatcher.js");
        const pendingOpening = reloadedChoice.beginRowPresentationRequest("trips");
        reloadedSession.invalidateSessionGeneration({ reason: "bootstrap", revalidate: false });
        expect(pendingOpening()).toBe(false);
        expect(reloadedChoice.getStoredRowPresentation("trips")).toBeNull();
        reloadedSession.acceptSessionIdentity(42, reloadedSession.getSessionGeneration());
        expect(reloadedChoice.getStoredRowPresentation("trips")).toBe(ARTICLE);
        reloadedAppearance.accept("trips", snapshot(PAGE, IFAV));
        const openClassic = vi.fn();
        expect(await reloadedDispatcher.openDefaultRowPresentation({ id: 24 }, "trips", null, { openClassic }))
            .toMatchObject({ status: "dispatched", viewKey: ARTICLE, source: "user" });
        expect(openClassic).toHaveBeenCalledExactlyOnceWith({ id: 24 }, "trips", null, expect.any(Object));
        expect(openImage).not.toHaveBeenCalled();

        // A new tab has neither that preference nor an authorized appearance snapshot.
        sessionStorage.clear();
        vi.resetModules();
        const newTabDispatcher = await import("./row_presentation_dispatcher.js");
        const newTabSession = await import("../../auth/session_generation_store.js");
        newTabSession.invalidateSessionGeneration({ reason: "bootstrap", revalidate: false });
        fetchRows.mockResolvedValue({ data: [{ id: 24 }], dataset_appearance: snapshot(PAGE, override) });
        expect(await newTabDispatcher.openDefaultRowPresentation({ id: 24 }, "trips", null, { openClassic }))
            .toMatchObject({ status: "opened", viewKey: fallback, source });
        expect(openClassic).toHaveBeenCalledOnce();
        expect(openImage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
            rowItem: { id: 24 }, layout: fallback === IFAV ? "image_first" : "page",
        }));
        expect(sessionStorage.getItem("trips_row_presentation")).toBeNull();
    });

    test.each([
        ['different user', 42, 73], ['guest', 42, 1], ['signed-in user after guest', 1, 42],
    ])('a standalone %s document cannot inherit the previous account choice', async (kind, owner, viewer) => {
        invalidateSessionGeneration({ revalidate: false });
        acceptSessionIdentity(owner, getSessionGeneration());
        setRowPresentationChoice('trips', ARTICLE);
        expect(sessionStorage.getItem('trips_row_presentation_owner')).toBe(String(owner));
        // The sign-in document loads no choice subscriber. Retained storage
        // therefore reaches the next app bootstrap even though login occurred.
        vi.resetModules();
        const standaloneSession = await import('../../auth/session_generation_store.js');
        if (kind === 'guest') standaloneSession.publishSessionChange('logout');
        else {
            vi.doMock('../../pipeline/api_pipeline.js', () => ({ ensureCsrfToken: async () => 'fresh-csrf' }));
            vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ authenticated: true }), {
                status: 200, headers: { 'Content-Type': 'application/json' },
            })));
            const { postPreAuthJson } = await import('../../auth/pre_auth_request_sender.js');
            await postPreAuthJson('/api/login', null, () => ({}));
        }
        expect(sessionStorage.getItem('trips_row_presentation')).toBe(ARTICLE);
        vi.resetModules();
        vi.doUnmock('../../pipeline/api_pipeline.js');
        const choice = await import('./row_presentation_choice.js');
        const session = await import('../../auth/session_generation_store.js');
        session.invalidateSessionGeneration({ reason: 'bootstrap', revalidate: false });
        // A page-set identity or button state cannot authorize the old choice.
        localStorage.setItem('user_id', '42');
        localStorage.setItem('button_state', 'logout');
        expect(choice.getStoredRowPresentation('trips')).toBeNull();
        if (viewer === 1) session.acceptSessionIdentity(1, session.getSessionGeneration());
        else {
            const { runApiPipeline } = await import('../../pipeline/api_pipeline.js');
            const fetch = vi.fn(async () => new Response(JSON.stringify({ user_id: viewer }), {
                headers: { 'Content-Type': 'application/json' },
            }));
            vi.stubGlobal('fetch', fetch);
            await runApiPipeline({ routeName: 'fetchUserProfile' });
            expect(fetch).toHaveBeenCalledTimes(1);
        }
        expect(sessionStorage.getItem('trips_row_presentation')).toBeNull();
        expect(choice.readRowOpeningChoice('trips', { defaults: { dataset: IFAV } }))
            .toMatchObject({ viewKey: IFAV, source: 'dataset' });
        expect(sessionStorage.getItem('trips_row_presentation')).toBeNull();
        expect(sessionStorage.getItem('trips_row_presentation_owner')).toBeNull();
    });
});
