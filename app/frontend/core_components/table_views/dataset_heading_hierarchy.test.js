// dataset_heading_hierarchy.test.js
// Verifies the rendered outline below a dataset title in each audited view.
// Connects real DOM renderers to heading levels, including empty and nested states.
// Prevents skipped levels without inventing headings for toolbar labels or dates.
// @vitest-environment jsdom

import { beforeEach, expect, test, vi } from 'vitest';

vi.mock('./card_view/row_article_opener.js', () => ({ openRowArticleView: vi.fn() }));
vi.mock('../state_stores/table_state_store.js', () => ({ setUnifiedTableState: vi.fn() }));
vi.mock('../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js', () => ({
    refreshTableUnified: vi.fn(),
}));
vi.mock('../endpoints/endpoint_router.js', () => ({ endpoint_router: vi.fn() }));
vi.mock('../route_permission_checker.js', () => ({
    hasDatasetPermission: vi.fn().mockResolvedValue(false),
    primeDatasetPermissions: vi.fn().mockResolvedValue({}),
    hasRoutePermission: vi.fn().mockReturnValue(true),
    applyPermission: vi.fn(),
}));

import { create_favefox_style_filter_bar } from '../filterbar/filter_list/favefox_style_filters_container/accordion_filter_builder.js';
import { create_map_view } from './map_view/map_view_printer.js';
import { create_price_chart_view } from './price_chart_view/price_chart_view_printer.js';
import { createChartUnavailableNotice } from './price_chart_view/chart_unavailable_notice.js';
import { create_product_card_view } from './product_card_view/product_card_view_printer.js';
import { buildRowArticleAttachmentList } from './card_view/row_article_attachment_list.js';
import { create_calendar_view } from './calendar_view/calendar_view_printer.js';

beforeEach(() => {
    document.body.innerHTML = '<h1>Dataset</h1>';
    document.documentElement.lang = 'en';
    localStorage.clear();
    sessionStorage.clear();
    window.matchMedia = vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});

function expectOutline(view, expectedLevels) {
    document.body.appendChild(view);
    const levels = [...document.body.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')]
        .map(heading => Number(heading.getAttribute('aria-level') || heading.tagName.slice(1)));
    expect(levels).toEqual([1, ...expectedLevels]);
    levels.forEach((level, index) => {
        if (index) expect(level).toBeLessThanOrEqual(levels[index - 1] + 1);
    });
}

test.each(['accordion', 'inline-open'])('filter sections are peers under the dataset in %s mode', layoutMode => {
    const view = create_favefox_style_filter_bar('outline', ['name', 'date'].map(key => ({
        key, title: key, content: document.createElement('div'),
    })), { layoutMode });
    expectOutline(view, [2, 2]);
    expect([...view.querySelectorAll('.filter-section-title')].map(node => node.dataset.langKey))
        .toEqual(['name', 'date']);
});

test.each([false, true])('map headings follow the dataset (has points: %s)', hasPoints => {
    const view = create_map_view('outline', ['id', 'latitude', 'longitude'],
        hasPoints ? [{ id: 1, latitude: 60, longitude: 25 }] : [], {});
    expectOutline(view, [2]);
});

test('chart title is level two and its empty notice remains nested at level three', () => {
    const view = create_price_chart_view('outline', ['date', 'price'], [], { date: 'date', price: 'numeric' });
    expectOutline(view, [2, 3]);
});

test('populated chart title follows the dataset', () => {
    const view = create_price_chart_view('outline', ['date', 'price'],
        [{ date: '2026-04-01', price: 10 }], { date: 'date', price: 'numeric' });
    expectOutline(view, [2]);
});

test('unavailable chart notice replaces the chart title at level two', () => {
    expectOutline(create_price_chart_view('outline', ['title'], [], { title: 'text' }), [2]);
});

test('unavailable chart address fallback notice follows the dataset', () => {
    expectOutline(createChartUnavailableNotice('outline', 'card_view', ['title'], { title: 'text' }), [2]);
});

test('each product card title follows the dataset', () => {
    expectOutline(create_product_card_view('outline', ['id', 'name'],
        [{ id: 1, name: 'First' }, { id: 2, name: 'Second' }], {}), [2, 2]);
});

test('attachment section follows the dataset and an open preview is nested one level below it', async () => {
    const view = await buildRowArticleAttachmentList('outline', 1, {
        dataset: 'outline_assets', column: 'outline_id',
        rows: [{ id: 1, asset_kind: 'pdf', filename: '1_1_1.pdf', original_name: 'Reference.pdf' }],
    }, vi.fn(), { linkingStatus: { enabled: true } });
    view.querySelector('[data-testid="big-card-attachment-preview-0"]').click();
    expectOutline(view, [2, 3]);
    expect(view.querySelector('.big_card_attachment_preview_title').textContent).toBe('Reference.pdf');
});

test.each(['week', 'day', 'agenda', 'month'])('calendar %s mode has no skipped levels', mode => {
    const view = create_calendar_view('outline', ['id', 'title', 'event_date'],
        [{ id: 1, title: 'Event', event_date: '2026-04-15' }], { event_date: { data_type: 'date' } });
    view.querySelector(`[data-lang-key="calendar_${mode}"]`).click();
    const count = view.querySelectorAll('h2').length;
    if (mode === 'month') expect(count).toBe(0);
    else expect(count).toBeGreaterThan(0);
    expectOutline(view, Array(count).fill(2));
    expect(view.querySelector('.calendar-view__title').tagName).toBe('DIV');
});
