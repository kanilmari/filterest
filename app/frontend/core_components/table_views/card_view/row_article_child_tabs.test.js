// @vitest-environment jsdom
// row_article_child_tabs.test.js
// Verifies related-record article navigation does not pollute browser history.
// Bridges related-tab row clicks with the shared navigation handler contract.
// Exists so Back returns to the previous article instead of an intermediate card list.

import { beforeEach, describe, expect, test, vi } from "vitest";
import { DATE_TIME_DISPLAY_SEPARATOR } from "../timestamp_display_formatter.js";

function displayDateTime(dateText, timeText) {
    return `${dateText}${DATE_TIME_DISPLAY_SEPARATOR}${timeText}`;
}

const mocks = vi.hoisted(() => ({
    closeRowArticle: vi.fn((wrapper, _cardContainer, bigCard) => {
        bigCard.remove();
        wrapper.classList.remove("big-card-open");
    }),
    endpointRouter: vi.fn(() => Promise.resolve([])),
    handleAllNavigation: vi.fn(() => Promise.resolve()),
    hasDatasetPermission: vi.fn(() => Promise.resolve(false)),
    primeDatasetPermissions: vi.fn(() => Promise.resolve(new Map())),
    primeMultipleDatasetPermissions: vi.fn(() => Promise.resolve(new Map())),
    getUnifiedTableState: vi.fn(() => ({ articleView: { expandedId: 42 } })),
    setUnifiedTableState: vi.fn(),
}));

vi.mock("../../endpoints/endpoint_router.js", () => ({
    endpoint_router: mocks.endpointRouter,
}));

vi.mock("../../dev_tools/function_counter.js", () => ({
    count_this_function: vi.fn(),
}));

vi.mock("../../lang/translation_handler.js", () => ({
    getTranslationForKey: (key) => key,
}));

vi.mock("../../navigation/admin_and_user_tools/custom_view_reader.js", () => ({
    custom_views: [],
}));

vi.mock("../../navigation/nav_engine/navigation_handler.js", () => ({
    handle_all_navigation: mocks.handleAllNavigation,
}));

vi.mock("../../navigation/nav_engine/query_params.js", () => ({
    DATASET_PREFIX: "/",
    setParams: vi.fn(),
}));

vi.mock("./row_article_ui_handler.js", () => ({
    closeRowArticle: mocks.closeRowArticle,
}));

vi.mock("../../route_permission_checker.js", () => ({
    hasDatasetPermission: mocks.hasDatasetPermission,
    primeDatasetPermissions: mocks.primeDatasetPermissions,
    primeMultipleDatasetPermissions: mocks.primeMultipleDatasetPermissions,
}));

vi.mock("../../state_stores/table_state_store.js", async (importOriginal) => {
    // The article's restore state compares rows, and names its reading-position
    // fields, the store's own way.
    const store = await importOriginal();
    return {
        ARTICLE_READING_POSITION_FIELDS: store.ARTICLE_READING_POSITION_FIELDS,
        isSameOpenRow: store.isSameOpenRow,
        getUnifiedTableState: mocks.getUnifiedTableState,
        setUnifiedTableState: mocks.setUnifiedTableState,
    };
});

vi.mock("../../../reusable_components/modal/confirm_modal_builder.js", () => ({
    showConfirmModal: vi.fn(),
}));

vi.mock("../../../reusable_components/notifications/toast_notification_printer.js", () => ({
    showErrorToast: vi.fn(),
    showSuccessToast: vi.fn(),
}));

vi.mock("../../general_tables/gt_1_row_crud/gt_1_4_row_delete/row_remover_helpers.js", () => ({
    buildConfirmationMessage: vi.fn(() => ({
        messageLangKey: "delete_confirm",
        messagePlainText: "Delete?",
    })),
}));

import { buildRowArticleRelatedTabs } from "./row_article_child_tabs.js";
import { datasetAppearanceState } from "../dataset_appearance_state.js";
import { createRowArticleLoadSession } from './row_article_load_session.js';
import { setAllSpecs } from '../../state_stores/table_specs_reader.js';
import { DEFAULT_DATASET_APPEARANCE } from '../../../shared/dataset_appearance/validator.js';
import { appearanceValuesForPlace } from '../../../shared/dataset_appearance/snapshot.js';
import { applyLabelValueLayout } from '../../../reusable_components/key_value_container/label_value_layout.js';
import { prepareCardImagePresentation } from './card_image_presentation.js';

function relatedAppearance(uid, width, version = '1') {
    const config = structuredClone(DEFAULT_DATASET_APPEARANCE);
    return { dataset_uid: uid, schema_version: 2, version, shared_version: 'site-1',
        tab_values: appearanceValuesForPlace(config, 'tab_only'),
        site_values: appearanceValuesForPlace(config, 'site_only'),
        defaults: appearanceValuesForPlace(config, 'site_default'),
        overrides: { 'shared.card_image_width': width, 'shared.label_value_layout': 'inline',
            'shared.card_image_presentation': 'contain_blur' } };
}

function relatedResult(width, version = '1', rows = [{ id: 1, title: 'Related record' }]) {
    return { dataset: 'child', dataset_uid: 22, column: 'parent_id', row_count: 1, rows,
        types: { title: { card_element: 'header' } }, dataset_appearance: relatedAppearance(22, width, version) };
}

function appearanceProbes(surface) {
    const pair = document.createElement('div');
    pair.innerHTML = '<span>Nimi</span><span>Arvo</span>';
    surface.append(pair); applyLabelValueLayout(pair, pair.firstChild, pair.lastChild);
    const photo = document.createElement('div'), image = document.createElement('img');
    photo.dataset.cardImageRenderSlot = 'card_media'; photo.dataset.imagePresentationKind = 'raster';
    image.src = '/storage/related.jpg'; photo.append(image); surface.append(photo);
    prepareCardImagePresentation(photo, image); image.dispatchEvent(new Event('load'));
    return { pair, photo, image };
}

function expectPublicRelatedSurface(surface, probes = appearanceProbes(surface)) {
    expect.soft(surface.dataset.datasetAppearanceResolved).toBe('false');
    expect.soft(surface.style.getPropertyValue('--card_image_large_width')).toBe('300px');
    expect.soft(probes.pair.dataset.labelValueLayout).toBe('stacked');
    expect.soft(probes.photo.dataset.cardImagePresentation).toBe('contain');
    expect.soft(probes.photo.style.getPropertyValue('--card-photo-source')).toBe('');
    probes.image.dispatchEvent(new Event('load'));
    expect.soft(probes.photo.dataset.cardImagePresentation).toBe('contain');
    expect.soft(probes.photo.style.getPropertyValue('--card-photo-source')).toBe('');
}

describe("buildRowArticleRelatedTabs related-record navigation", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setAllSpecs({});
        datasetAppearanceState.clear();
        datasetAppearanceState.updateSite(DEFAULT_DATASET_APPEARANCE, { version: 'site-1' });
        document.body.innerHTML = `
            <div class="card_view_wrapper big-card-open">
                <div class="card_container">
                    <div class="card" data-id="42"></div>
                </div>
                <article class="active_row_article"></article>
            </div>
        `;
    });

    test.each(['denied', 'hidden'].flatMap(reason => ['initial', 'lazy', 'reload'].map(stage => [reason, stage])))(
        '%s omission during %s clears cached related appearance and keeps rows readable', async (_reason, stage) => {
            datasetAppearanceState.accept('child', relatedAppearance(22, 480));
            const retained = document.createElement('section');
            datasetAppearanceState.bind(retained, 'child', 22);
            const retainedProbes = appearanceProbes(retained);
            const sibling = document.createElement('section');
            datasetAppearanceState.accept('sibling', relatedAppearance(33, 420));
            datasetAppearanceState.bind(sibling, 'sibling', 33); retained.append(sibling);
            const siblingBefore = sibling.outerHTML;
            let omit = stage === 'initial';
            const session = createRowArticleLoadSession({ tableName: 'parent', rowId: 42,
                requestFn: async (_route, options) => {
                    const child = relatedResult(480, '1', stage === 'lazy' && !options.body_data.child_table
                        ? [] : [{ id: 1, title: 'Still readable' }]);
                    if (omit) { delete child.dataset_uid; delete child.dataset_appearance; }
                    return { child_tables: stage === 'lazy' && !options.body_data.child_table
                        ? [{ dataset: 'first', row_count: 1, rows: [{ id: 2 }] }, child] : [child] };
                } });
            const response = await session.fetchDynamicChildren();
            const tabs = await buildRowArticleRelatedTabs(response.child_tables, 'parent', 42, null, null,
                { fetchDynamicChildren: session.fetchDynamicChildren });
            const panel = tabs.querySelector('[data-tab-key="child__parent_id__"].related_tab_panel');
            const probes = appearanceProbes(panel);
            if (stage !== 'initial') {
                expect(panel.style.getPropertyValue('--card_image_large_width')).toBe('480px');
                omit = true;
                if (stage === 'lazy') {
                    tabs.querySelectorAll('.related_tab_button')[1].click();
                    await vi.waitFor(() => expect(panel.querySelector('.child_record_list_item')).not.toBeNull());
                } else {
                    const fresh = await session.fetchDynamicChildren({ forceRefresh: true });
                    const freshTabs = await buildRowArticleRelatedTabs(fresh.child_tables, 'parent', 42, null);
                    expectPublicRelatedSurface(freshTabs.querySelector('.related_tab_panel'));
                }
            }
            expectPublicRelatedSurface(panel, probes);
            expectPublicRelatedSurface(retained, retainedProbes);
            expect.soft(datasetAppearanceState.savedSnapshot('child')).toBeNull();
            expect.soft(sibling.outerHTML).toBe(siblingBefore);
            const rows = panel.querySelectorAll('.child_record_list_item');
            expect.soft(rows.length).toBe(1);
            for (const row of rows) expectPublicRelatedSurface(row);
            if (stage !== 'initial') {
                omit = false;
                const recovered = await session.fetchDynamicChildren({ forceRefresh: true });
                const recoveredTabs = await buildRowArticleRelatedTabs(recovered.child_tables, 'parent', 42, null);
                expect(recoveredTabs.querySelector('[data-tab-key="child__parent_id__"].related_tab_panel')
                    .dataset.datasetAppearanceResolved).toBe('true');
                expect(datasetAppearanceState.savedSnapshot('child')).not.toBeNull();
            }
        },
    );

    test.each(['older revision', 'name reuse', 'rejected acceptance'])(
        '%s cannot bind a related panel or row to a cached snapshot', async reason => {
            datasetAppearanceState.accept('child', relatedAppearance(22, 480, '2'));
            if (reason === 'name reuse') setAllSpecs({ child: { table_uid: 33 }, renamed: { table_uid: 22 } });
            const rejection = reason === 'rejected acceptance' ? vi.spyOn(datasetAppearanceState, 'accept').mockReturnValue(false) : null;
            try {
                const session = createRowArticleLoadSession({ tableName: 'parent', rowId: 42,
                    requestFn: async () => ({ child_tables: [relatedResult(320, '1')] }) });
                const response = await session.fetchDynamicChildren();
                const tabs = await buildRowArticleRelatedTabs(response.child_tables, 'parent', 42, null);
                const panel = tabs.querySelector('.related_tab_panel');
                expectPublicRelatedSurface(panel);
                expect.soft(panel.dataset.datasetAppearanceUid).toBeUndefined();
                expectPublicRelatedSurface(panel.querySelector('.child_record_list_item'));
            } finally { rejection?.mockRestore(); }
        },
    );

    test.each(['lazy', 'reload'])('a rejected snapshot during %s clears existing related panels only', async stage => {
        datasetAppearanceState.accept('child', relatedAppearance(22, 480, '2'));
        const direct = document.createElement('section'); datasetAppearanceState.bind(direct, 'child', 22);
        const directBefore = direct.outerHTML;
        let revision = '2';
        const session = createRowArticleLoadSession({ tableName: 'parent', rowId: 42,
            requestFn: async (_route, options) => ({ child_tables: [relatedResult(480, revision,
                stage === 'lazy' && !options.body_data.child_table ? [] : [{ id: 1, title: 'Readable row' }])] }) });
        const response = await session.fetchDynamicChildren();
        const tabs = await buildRowArticleRelatedTabs(response.child_tables, 'parent', 42, null, null,
            { fetchDynamicChildren: session.fetchDynamicChildren });
        const panel = tabs.querySelector('.related_tab_panel'), probes = appearanceProbes(panel);
        expect(panel.dataset.datasetAppearanceResolved).toBe('true');
        revision = '1';
        if (stage === 'lazy') {
            // This sole tab auto-loaded once. Rebuild with an inactive lazy child.
            const first = { dataset: 'first', row_count: 1, rows: [{ id: 2 }] };
            const lazy = relatedResult(480, '2', []);
            const delayedTabs = await buildRowArticleRelatedTabs([first, lazy], 'parent', 42, null, null,
                { fetchDynamicChildren: session.fetchDynamicChildren });
            const lazyPanel = delayedTabs.querySelectorAll('.related_tab_panel')[1];
            const lazyProbes = appearanceProbes(lazyPanel);
            session.invalidateDynamicChildren({ childTable: 'child' });
            delayedTabs.querySelectorAll('.related_tab_button')[1].click();
            await vi.waitFor(() => expect(lazyPanel.querySelector('.child_record_list_item')).not.toBeNull());
            expectPublicRelatedSurface(lazyPanel, lazyProbes);
            expectPublicRelatedSurface(lazyPanel.querySelector('.child_record_list_item'));
        } else await session.fetchDynamicChildren({ forceRefresh: true });
        expectPublicRelatedSurface(panel, probes);
        expect(direct.outerHTML).toBe(directBefore);
        expect(datasetAppearanceState.savedSnapshot('child').version).toBe('2');
    });

    test('a name-reuse rejection clears the related panel while the renamed UID stays authorized', async () => {
        setAllSpecs({ child: { table_uid: 22 } });
        const session = createRowArticleLoadSession({ tableName: 'parent', rowId: 42,
            requestFn: async () => ({ child_tables: [relatedResult(480)] }) });
        const response = await session.fetchDynamicChildren();
        const tabs = await buildRowArticleRelatedTabs(response.child_tables, 'parent', 42, null);
        const panel = tabs.querySelector('.related_tab_panel'), probes = appearanceProbes(panel);
        const direct = document.createElement('section'); datasetAppearanceState.bind(direct, 'child', 22);
        const directBefore = direct.outerHTML;
        setAllSpecs({ child: { table_uid: 33 }, renamed: { table_uid: 22 } });
        await session.fetchDynamicChildren({ forceRefresh: true });
        expectPublicRelatedSurface(panel, probes);
        expect(direct.outerHTML).toBe(directBefore);
        expect(datasetAppearanceState.savedSnapshot('renamed').dataset_uid).toBe(22);
        expect(datasetAppearanceState.savedSnapshot('child')).toBeNull();
    });

    test.each([false, true])('related results revalidate appearance before assembly (cached: %s)', async cached => {
        if (cached) datasetAppearanceState.accept('child', relatedAppearance(22, 320));
        const session = createRowArticleLoadSession({ tableName: 'parent', rowId: 42,
            requestFn: async () => ({ child_tables: [relatedResult(440, '2')] }) });
        const result = await session.fetchDynamicChildren();
        const tabs = await buildRowArticleRelatedTabs(result.child_tables, 'parent', 42, null);
        const panel = tabs.querySelector('.related_tab_panel');
        expect(panel.dataset.datasetAppearanceResolved).toBe('true');
        expect(panel.dataset.datasetAppearanceUid).toBe('22');
        expect(panel.dataset.labelValueLayout).toBe('inline');
        expect(panel.style.getPropertyValue('--card_image_large_width')).toBe('440px');
        expect(datasetAppearanceState.savedSnapshot('child').version).toBe('2');
    });

    test('lazy related loading accepts the current snapshot before painting its panel and rows', async () => {
        const requests = [];
        const session = createRowArticleLoadSession({ tableName: 'parent', rowId: 42,
            requestFn: async (_route, options) => {
                requests.push(options.body_data);
                return options.body_data.child_table
                    ? { child_tables: [relatedResult(460, '2')] }
                    : { child_tables: [{ dataset: 'first', row_count: 1, rows: [{ id: 2 }] }, relatedResult(320, '1', [])] };
            } });
        const result = await session.fetchDynamicChildren();
        const tabs = await buildRowArticleRelatedTabs(result.child_tables, 'parent', 42, null, null,
            { fetchDynamicChildren: session.fetchDynamicChildren });
        const panel = tabs.querySelector('[data-dataset-appearance-scope="child"]');
        expect(panel.style.getPropertyValue('--card_image_large_width')).toBe('320px');
        tabs.querySelectorAll('.related_tab_button')[1].click();
        await vi.waitFor(() => expect(panel.querySelector('.child_record_list_item')).not.toBeNull());
        expect(requests[1].child_table).toBe('child');
        expect(panel.style.getPropertyValue('--card_image_large_width')).toBe('460px');
        expect(datasetAppearanceState.savedSnapshot('child').version).toBe('2');
    });

    test('a reload after an appearance save repaints already mounted related panels', async () => {
        let width = 320, version = '1';
        const session = createRowArticleLoadSession({ tableName: 'parent', rowId: 42,
            requestFn: async () => ({ child_tables: [relatedResult(width, version)] }) });
        const result = await session.fetchDynamicChildren();
        const tabs = await buildRowArticleRelatedTabs(result.child_tables, 'parent', 42, null);
        const panel = tabs.querySelector('.related_tab_panel');
        width = 480; version = '2';
        await session.fetchDynamicChildren({ forceRefresh: true });
        expect(panel.style.getPropertyValue('--card_image_large_width')).toBe('480px');
        expect(datasetAppearanceState.savedSnapshot('child').version).toBe('2');
    });

    test.each(['sign-out', 'parent deletion', 'child deletion', 'ownership'])(
        'a related response keeps its original guard during delayed assembly after %s', async reason => {
            setAllSpecs({ parent: { table_uid: 11 }, child: { table_uid: 22 } });
            const session = createRowArticleLoadSession({ tableName: 'parent', rowId: 42,
                requestFn: async () => ({ child_tables: [{ dataset: 'child', dataset_uid: 22,
                    row_count: 1, rows: [{ id: 1, title: 'Private child' }], types: { title: { card_element: 'header' } } }] }) });
            const response = await session.fetchDynamicChildren();
            if (reason === 'sign-out') datasetAppearanceState.clear();
            else if (reason === 'parent deletion') datasetAppearanceState.forget('parent');
            else if (reason === 'child deletion') datasetAppearanceState.forget('child');
            else setAllSpecs({ parent: { table_uid: 11 }, child: { table_uid: 33 }, renamed: { table_uid: 22 } });
            const tabs = await buildRowArticleRelatedTabs(response.child_tables, 'parent', 42, null);
            expect(tabs?.querySelectorAll('[data-dataset-appearance-scope]').length || 0).toBe(0);
        },
    );

    test.each(['sign-out', 'parent deletion', 'child deletion'])('late related-tab assembly cannot reinstall scopes after %s', async reason => {
        let finish;
        mocks.endpointRouter.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        const pending = buildRowArticleRelatedTabs([{
            dataset: 'child', dataset_uid: 12, row_count: 1, rows: [{ id: 1, title: 'Private child' }],
            types: { title: { card_element: 'header' } },
        }], 'parent', 42, null);
        if (reason === 'sign-out') datasetAppearanceState.clear();
        else datasetAppearanceState.forget(reason === 'parent deletion' ? 'parent' : 'child');
        finish([]);
        const tabs = await pending;
        expect(tabs?.querySelectorAll('[data-dataset-appearance-scope]').length || 0).toBe(0);
        if (reason !== 'child deletion') expect(tabs).toBeNull();
    });

    test("opens a related row without pushing an intermediate dataset base URL", async () => {
        const tabs = await buildRowArticleRelatedTabs(
            [{
                dataset: "dev_agent_tasks",
                column: "parent_id",
                row_count: 1,
                rows: [{ id: 853, title: "Related task" }],
                types: { title: { card_element: "header" } },
            }],
            "dev_agent_task_todos",
            42,
            1,
        );

        document.querySelector(".active_row_article").appendChild(tabs);

        tabs.querySelector(".related_record_title_button").click();

        await vi.waitFor(() => {
            expect(mocks.handleAllNavigation).toHaveBeenCalledWith(
                "dev_agent_tasks",
                [],
                {
                    forceReload: true,
                    skipUrlUpdate: true,
                },
            );
        });

        expect(mocks.setUnifiedTableState).toHaveBeenCalledWith(
            "dev_agent_tasks",
            {
                articleView: { collapsed: true, expandedId: 853, returnView: "card" },
            },
        );
        expect(mocks.closeRowArticle).toHaveBeenCalled();
    });

    test("renders related rows with compact columns and hides generated bridge relation tabs", async () => {
        const tabs = await buildRowArticleRelatedTabs(
            [
                {
                    dataset: "dokumentaatio",
                    column: "palvelu_id",
                    row_count: 1,
                    rows: [{
                        id: 3,
                        otsikko: "Ohje salasanan vaihtoon",
                        created: "2026-06-15T21:36:00",
                        updated: "2026-06-15T21:50:00",
                    }],
                    types: { otsikko: { card_element: "header" } },
                },
                {
                    dataset: "palvelukatalogi_riskienhallinta_relation",
                    column: "palvelu_id",
                    row_count: 1,
                    rows: [{ palvelu_id: 1, riski_id: 2 }],
                },
            ],
            "palvelukatalogi",
            42,
            1,
        );

        const tabLabels = [...tabs.querySelectorAll(".related_tab_button")]
            .map((button) => button.textContent);
        expect(tabLabels).toEqual(["Dokumentaatio (1)", "comments"]);
        expect(tabs.querySelector('.related_tab_dataset_label')?.dataset.langKey)
            .toBe('dokumentaatio');

        const headerCells = [...tabs.querySelectorAll(".child_record_list_header_cell")]
            .map((cell) => cell.textContent);
        expect(headerCells).toEqual(["ID", "Nimi", "Luotu", "Muokattu"]);

        const summaryValues = [...tabs.querySelectorAll(".child_record_summary_value")]
            .map((cell) => cell.textContent);
        expect(summaryValues).toEqual([
            "3",
            "Ohje salasanan vaihtoon",
            displayDateTime("2026-06-15", "21:36"),
            displayDateTime("2026-06-15", "21:50"),
        ]);
        expect(tabs.textContent).not.toContain("palvelukatalogi_riskienhallinta_relation");
    });

    test("renders ticket todos as a checkbox list with verbatim text", async () => {
        const tabs = await buildRowArticleRelatedTabs(
            [{
                dataset: "dev_agent_task_todos",
                column: "task_id",
                row_count: 2,
                rows: [
                    { id: 101, todo_text: "  Identifier text stays  ", status: "todo", sort_order: 10 },
                    { id: 102, todo_text: "needs_review stays secondary", status: "needs_review", sort_order: 20 },
                ],
                types: { todo_text: { card_element: "header" } },
            }],
            "dev_agent_tasks",
            889,
            1,
        );

        document.querySelector(".active_row_article").appendChild(tabs);

        const checkboxes = tabs.querySelectorAll('input[type="checkbox"][data-testid="task-todo-checkbox"]');
        expect(checkboxes).toHaveLength(2);
        expect(tabs.querySelector(".row_article_task_todo_list")).not.toBeNull();
        expect(tabs.querySelector(".child_record_list_header")).toBeNull();
        expect(tabs.textContent).toContain("  Identifier text stays  ");
        expect(tabs.querySelector('[data-todo-id="102"] .row_article_task_todo_status')?.textContent)
            .toBe("needs_review");
        expect(checkboxes[0].checked).toBe(false);
        expect(checkboxes[1].checked).toBe(false);
    });

    test("toggles a ticket todo checkbox through the existing row update API", async () => {
        mocks.endpointRouter.mockImplementation((routeName) => {
            if (routeName === "updateRow") {
                return Promise.resolve({ status: "ok" });
            }
            return Promise.resolve([]);
        });

        const tabs = await buildRowArticleRelatedTabs(
            [{
                dataset: "dev_agent_task_todos",
                column: "task_id",
                row_count: 1,
                rows: [{ id: 101, todo_text: "Toggle me", status: "todo", sort_order: 10 }],
                types: { todo_text: { card_element: "header" } },
            }],
            "dev_agent_tasks",
            889,
            1,
        );
        document.querySelector(".active_row_article").appendChild(tabs);

        const checkbox = tabs.querySelector('input[type="checkbox"][data-testid="task-todo-checkbox"]');
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event("change", { bubbles: true }));

        await vi.waitFor(() => {
            expect(mocks.endpointRouter).toHaveBeenCalledWith("updateRow", {
                method: "POST",
                url_params: "?dataset=dev_agent_task_todos",
                body_data: {
                    id: 101,
                    column: "status",
                    value: "done",
                },
                suppressAuthRedirect: true,
            });
        });
        expect(tabs.querySelector('[data-todo-id="101"]')?.classList.contains("is-done")).toBe(true);
        expect(tabs.querySelector(".row_article_task_todo_status")?.textContent).toBe("done");
    });

    test("restores the Agent task todos child tab instead of the default first tab", async () => {
        mocks.getUnifiedTableState.mockReturnValue({ articleView: { expandedId: 889 } });
        const tabs = await buildRowArticleRelatedTabs(
            [
                {
                    dataset: "dev_agent_tasks",
                    column: "parent_id",
                    row_count: 1,
                    rows: [{ id: 1, title: "Linked task" }],
                    types: { title: { card_element: "header" } },
                },
                {
                    dataset: "dev_agent_task_todos",
                    column: "task_id",
                    row_count: 1,
                    rows: [{ id: 101, todo_text: "Stay open after F5", status: "todo" }],
                    types: { todo_text: { card_element: "header" } },
                },
            ],
            "dev_agent_tasks",
            889,
            1,
            "dev_agent_task_todos__task_id__",
        );

        expect(tabs.querySelector(".related_tab_button.active")?.dataset.tabKey)
            .toBe("dev_agent_task_todos__task_id__");
        expect(tabs.querySelector(".related_tab_panel.active .row_article_task_todo_list")).not.toBeNull();
        expect(tabs.querySelector('[data-tab-key="dev_agent_tasks__parent_id__"]')
            ?.classList.contains("active")).toBe(false);
    });

    test("persists the opened related child tab for the same article row", async () => {
        mocks.getUnifiedTableState.mockReturnValue({ articleView: { expandedId: 889 } });
        const tabs = await buildRowArticleRelatedTabs(
            [
                {
                    dataset: "dev_agent_tasks",
                    column: "parent_id",
                    row_count: 1,
                    rows: [{ id: 1, title: "Linked task" }],
                    types: { title: { card_element: "header" } },
                },
                {
                    dataset: "dev_agent_task_todos",
                    column: "task_id",
                    row_count: 1,
                    rows: [{ id: 101, todo_text: "Stay open after F5", status: "todo" }],
                    types: { todo_text: { card_element: "header" } },
                },
            ],
            "dev_agent_tasks",
            889,
            1,
        );

        tabs.querySelector('[data-tab-key="dev_agent_task_todos__task_id__"]').click();

        expect(mocks.setUnifiedTableState).toHaveBeenCalledWith("dev_agent_tasks", {
            articleView: { relatedTabKey: "dev_agent_task_todos__task_id__" },
        });
        expect(tabs.querySelector(".related_tab_button.active")?.dataset.tabKey)
            .toBe("dev_agent_task_todos__task_id__");
    });
});
