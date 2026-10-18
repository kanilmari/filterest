// row_group_heading_order.test.js
// Proves sum ordering, visit references and live appearance updates on real cards.
// Connects the pure ordering policy with visibility and keyboard expansion.
// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { compareManualHeadings, createRowGroupHeadingOrder, groupFacetsByHeading, orderRowGroupHeadings } from './row_group_heading_order.js';
import { createRowGroupFacetCard } from './row_group_facet_card_builder.js';
import { renderDatasetAppearance } from '../../table_views/dataset_appearance_renderer.js';
import { DEFAULT_DATASET_APPEARANCE } from '../../../shared/dataset_appearance/validator.js';

vi.mock('../../table_views/dataset_value_localizer.js', () => ({
    bindDatasetLanguageRenderer: (_element, render) => render('en'),
}));
vi.mock('../../lang/translation_handler.js', () => ({ getTranslationForKey: key => key }));
const group = (id, counts, sort_order = id) => ({
    heading: id === 0 ? null : { id, sort_order, title: `Heading ${id}` },
    values: counts.map((row_count, index) => ({ row_count, slug: `value_${id}_${index}`, selected: false })),
});
const ids = groups => groups.map(item => item.heading?.id ?? 0);
const sample = () => [group(1, [3]), group(2, [6, 7]), group(3, [8]), group(4, [5])];
const disposers = [];
afterEach(() => { disposers.splice(0).forEach(dispose => dispose()); document.body.replaceChildren(); });

test('sums all values; ties use sort_order then id, including untitled 0/0', () => {
    const groups = [group(5, [4, 6], 2), group(3, [10], 1), group(2, [10], 1), group(0, [5, 5]), group(9, [11], 0)];
    expect(ids(orderRowGroupHeadings(groups, 'result_count'))).toEqual([9, 0, 2, 3, 5]);
    const facets = [{ heading: { id: 1 }, row_count: 2 }, { heading: null, row_count: 3 }, { heading: { id: 1 }, row_count: 5 }];
    expect(groupFacetsByHeading(facets).map(item => item.values)).toEqual([[facets[0], facets[2]], [facets[1]]]);
});

test('manual and absent setting exactly match the old comparator, irrespective of reference counts', () => {
    const groups = [group(4, [99], 2), group(0, [0]), group(2, [20], 1), group(1, [4], 1)];
    const previous = [...groups].sort((a, b) => (a.heading?.sort_order ?? 0) - (b.heading?.sort_order ?? 0)
        || (a.heading?.id ?? 0) - (b.heading?.id ?? 0));
    expect([...groups].sort(compareManualHeadings)).toEqual(previous);
    expect(orderRowGroupHeadings(groups, 'manual', new Map([[4, 1000]]))).toEqual(previous);
    expect(orderRowGroupHeadings(groups)).toEqual(previous);
});

test('only first authoritative render freezes counts; later selection/search/mode/filter/clear refreshes reuse them', () => {
    const state = createRowGroupHeadingOrder();
    state.accept([group(1, [900])], false); // A cached render cannot become the reference.
    state.accept(sample(), true);
    expect(ids(state.sort(sample(), 'result_count'))).toEqual([2, 3, 4, 1]);
    const changed = [group(1, [100]), group(2, [0]), group(3, [0]), group(4, [90])];
    changed[0].values[0].selected = true;
    for (const action of ['selection', 'search', 'filters', 'mode', 'clear']) {
        state.accept(changed, true);
        expect(ids(state.sort(changed, 'result_count')), action).toEqual([2, 3, 4, 1]);
    }
    const nextVisit = createRowGroupHeadingOrder(); nextVisit.accept(changed, true);
    expect(ids(nextVisit.sort(changed, 'result_count'))).toEqual([1, 4, 2, 3]);
    expect(ids(state.sort([...changed, group(8, [1000], 1), group(7, [1000], 1), group(6, [2])], 'result_count')))
        .toEqual([2, 3, 4, 1, 7, 8, 6]);
});

function mountCard() {
    const surface = document.createElement('section'); surface.dataset.datasetAppearanceScope = 'demo';
    const host = document.createElement('div'); host.id = 'demo_row_group_facets'; host.className = 'row-group-facets';
    surface.append(host); document.body.append(surface);
    let selected = [];
    host.rowGroupCard = createRowGroupFacetCard({ host, topControls: surface, tableName: 'demo',
        headingOrder: 'result_count', getSelectedSlugs: () => selected, getSelectedModes: () => ({}),
        getFacetTitle: item => item.title });
    disposers.push(host.disposeRowGroupPanel);
    const callbacks = { onToggle: vi.fn(), onClear: vi.fn(), onModeChange: vi.fn() };
    return { surface, host, update(groups) { host.rowGroupCard.update(groups, callbacks, { authoritative: true }); },
        select(value) { selected = [value]; },
        buttons: () => [...host.querySelectorAll('.row-group-facet-heading')],
        order: () => [...host.querySelectorAll('.row-group-facet-heading')].map(button => Number(button.dataset.headingId)),
    };
}

test('real card shows the top three; live appearance uses stored sums and a new card recomputes', () => {
    const card = mountCard(); card.update(sample());
    expect(card.order()).toEqual([2, 3, 4, 1]);
    expect(card.buttons().filter(button => !button.hidden).map(button => button.dataset.headingId)).toEqual(['2', '3', '4']);
    const more = card.host.querySelector('[data-row-group-focus="more"]');
    more.focus(); more.click(); expect(document.activeElement).toBe(more);
    expect(card.buttons().every(button => !button.hidden)).toBe(true);
    more.click(); expect(card.buttons().at(-1).hidden).toBe(true);
    const changed = [group(1, [100]), group(2, [0]), group(3, [0]), group(4, [90])];
    card.select('value_2_0'); card.update(changed);
    expect(card.order()).toEqual([2, 3, 4, 1]);
    const config = structuredClone(DEFAULT_DATASET_APPEARANCE);
    renderDatasetAppearance(card.surface, config);
    expect(card.order()).toEqual([1, 2, 3, 4]);
    config.shared.row_group_heading_order = 'result_count';
    renderDatasetAppearance(card.surface, config);
    expect(card.order()).toEqual([2, 3, 4, 1]);
    expect(card.host.rowGroupCard).toBeTruthy();
    const newCard = mountCard(); newCard.update(changed);
    expect(newCard.order()).toEqual([1, 4, 2, 3]);
});
