// product_card_row_commit.test.js
// Proves visible product-card row updates through the shared renderer interface.
// Connects real product cards, row IDs/pictures, language refresh and stale guards in jsdom.
// Prevents refresh and pagination from leaving the first-render rows on screen.
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../endpoints/endpoint_router.js', () => ({ endpoint_router: vi.fn(async () => ({})) }));
vi.mock('../../config_fetcher.js', () => ({ getDefaultViewSync: () => 'card' }));
vi.mock('../../route_permission_checker.js', () => ({
    hasRoutePermission: () => true, hasDatasetPermission: async () => false, applyPermission: vi.fn(),
}));
vi.mock('../card_view/row_article_opener.js', () => ({ openRowArticleView: vi.fn() }));

import { commitDatasetViewRows, createDatasetViewElement } from '../dataset_view_renderer.js';
import { getDatasetViewDefinition, getDatasetViewContainerId } from '../dataset_view_registry.js';
import { setChosenDatasetView } from '../../state_stores/dataset_view_choice_saver.js';
import { refreshProductCardLanguages } from './product_card_view_printer.js';

const dataset = 'product_commit_proof';
const columns = ['id', 'name', 'cached_image', 'category'];
const types = { name: { is_multilingual: true }, category: { is_multilingual: true } };
const row = id => ({ id, name: { en: `Product ${id}`, fi: `Tuote ${id}` },
    category: { en: 'Equipment', fi: 'Varusteet' }, cached_image: `104_${id}_7.png` });
const rowIds = root => [...root.querySelectorAll('[data-testid="product-card"]')].map(card => card.dataset.rowId);
const imageSources = root => [...root.querySelectorAll('.product-card-view-image')].map(img => img.getAttribute('src'));
const imageSource = id => `/storage/104/${id}/300/104_${id}_7.png`;

function mount(rows = [row(1)]) {
    setChosenDatasetView(dataset, 'product_card');
    const container = document.createElement('div');
    container.id = getDatasetViewContainerId('product_card', dataset);
    const controls = document.createElement('div');
    controls.className = 'card_top_controls';
    const root = createDatasetViewElement(getDatasetViewDefinition('product_card'), dataset, columns, rows, types);
    container.append(controls, root);
    document.body.append(container);
    return { container, root, controls };
}
const commit = (rows, mode = 'replace', options = {}) => commitDatasetViewRows(dataset, rows, { mode, ...options });

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('chosen_language', 'en');
    document.body.replaceChildren();
});

describe('product-card row commits through the interface', () => {
    test('refresh, search and clear replacements swap old IDs and pictures once', async () => {
        const { root, controls } = mount();
        const swaps = vi.spyOn(root, 'replaceChildren');
        for (const rows of [[row(2), row(3)], [row(3)], [row(1), row(2)]]) {
            const outcome = await commit(rows);
            expect(rowIds(root)).toEqual(rows.map(item => String(item.id)));
            expect(outcome).toBe('committed');
            expect(imageSources(root)).toEqual(rows.map(item => imageSource(item.id)));
            expect(controls.isConnected).toBe(true);
        }
        expect(swaps).toHaveBeenCalledTimes(3);
        await refreshProductCardLanguages('fi');
        expect(rowIds(root)).toEqual(['1', '2']);
        expect(root.textContent).toContain('Tuote 2');
        expect(root.textContent).not.toContain('Tuote 3');
    });

    test('append adds only distinct string-normalized IDs with their pictures and keeps the prefix nodes', async () => {
        const { root } = mount([row(1), row(2)]);
        const firstCard = root.querySelector('[data-row-id="1"]');
        const firstPicture = firstCard.querySelector('img');
        const outcome = await commit([row('2'), row(3), row('3'), row(4)], 'append');
        expect(rowIds(root)).toEqual(['1', '2', '3', '4']);
        expect(outcome).toBe('committed');
        expect(imageSources(root)).toEqual([1, 2, 3, 4].map(imageSource));
        expect(root.querySelector('[data-row-id="1"]')).toBe(firstCard);
        expect(firstCard.querySelector('img')).toBe(firstPicture);
        const beforeEmptyAppend = root.innerHTML;
        await commit([row('1'), row(4)], 'append');
        await commit([], 'append');
        expect(root.innerHTML).toBe(beforeEmptyAppend);
    });

    test('empty replacement removes every old card and picture and a later page can grow from empty', async () => {
        const { root, controls } = mount();
        const outcome = await commit([]);
        expect(rowIds(root)).toEqual([]);
        expect(outcome).toBe('committed');
        expect(imageSources(root)).toEqual([]);
        expect(root.querySelector('[data-testid="product-card-empty"]').dataset.langKey).toBe('no_rows');
        await refreshProductCardLanguages('fi');
        expect(rowIds(root)).toEqual([]);
        expect(await commit([row(5)], 'append')).toBe('committed');
        expect(rowIds(root)).toEqual(['5']);
        expect(imageSources(root)).toEqual([imageSource(5)]);
        expect(root.querySelector('[data-testid="product-card-empty"]')).toBeNull();
        expect(controls.isConnected).toBe(true);
    });

    test.each(['replace', 'append'])('stale %s response finishing after a newer replacement leaves cards untouched', async mode => {
        const { root } = mount();
        let releaseOlder;
        let currentRequest = 1;
        const olderResponse = new Promise(resolve => { releaseOlder = resolve; });
        const olderCommit = olderResponse.then(rows => commit(rows, mode, { isCurrent: () => currentRequest === 1 }));
        currentRequest = 2;
        await commit([row(2)]);
        expect(rowIds(root)).toEqual(['2']);
        const beforeStale = root.innerHTML;
        const currentCard = root.querySelector('[data-row-id="2"]');
        releaseOlder([row(9)]);
        expect(await olderCommit).toBeNull();
        expect(root.innerHTML).toBe(beforeStale);
        expect(root.querySelector('[data-row-id="2"]')).toBe(currentCard);
        await refreshProductCardLanguages('fi');
        expect(rowIds(root)).toEqual(['2']);
        expect(imageSources(root)).toEqual([imageSource(2)]);
    });

    test('language change retains appended raw rows, translated details and pictures', async () => {
        const initial = row(1), appended = row(2);
        const rawRows = JSON.stringify([initial, appended]);
        const { root } = mount([initial]);
        await commit([appended], 'append');
        await refreshProductCardLanguages('fi');
        expect(rowIds(root)).toEqual(['1', '2']);
        expect([...root.querySelectorAll('[data-testid="product-card-title"]')].map(title => title.textContent))
            .toEqual(['Tuote 1', 'Tuote 2']);
        expect([...root.querySelectorAll('.product-card-view-detail-value')].map(value => value.textContent))
            .toEqual(['Varusteet', 'Varusteet']);
        expect(imageSources(root)).toEqual([imageSource(1), imageSource(2)]);
        localStorage.setItem('chosen_language', 'fi');
        await commit([row(3)], 'append');
        expect(root.querySelector('[data-row-id="3"] .product-card-view-title').textContent).toBe('Tuote 3');
        await refreshProductCardLanguages('en');
        expect(rowIds(root)).toEqual(['1', '2', '3']);
        expect(root.textContent).toContain('Product 3');
        expect(JSON.stringify([initial, appended])).toBe(rawRows);
    });

    test.each(['detached', 'replaced', 'switched'])('a %s surface refuses product-card commits', async reason => {
        const { container, root } = mount();
        if (reason === 'detached') container.remove();
        if (reason === 'replaced') { container.remove(); mount([row(3)]); }
        if (reason === 'switched') setChosenDatasetView(dataset, 'table');
        expect(await commit([row(9)], 'replace', { container })).toBeNull();
        expect(rowIds(root)).toEqual(['1']);
    });
});
