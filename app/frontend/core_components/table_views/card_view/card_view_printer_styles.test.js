// card_view_printer_styles.test.js
// Verifies live style changes and repeated field settings on real list cards.
// Both detail renderers build their production DOM so replacing an equal-looking value is observable.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { DEFAULT_DATASET_APPEARANCE } from '../../../shared/dataset_appearance/validator.js';
import { renderKeyValuePairs } from '../../../reusable_components/key_value_container/kv_container_printer.js';
import { datasetAppearanceState } from '../dataset_appearance_state.js';
import { renderModernCardDetails } from './card_detail_tile_builder.js';
import { applyCardFieldPresentationSetting } from './card_field_presentation.js';
import { disposeCardResources } from './card_resource_lifecycle.js';
import { create_card_view } from './card_view_printer.js';
import { openRowArticleView } from './row_article_opener.js';

vi.mock('../../../reusable_components/key_value_container/kv_container_printer.js', { spy: true });
vi.mock('./card_detail_tile_builder.js', { spy: true });
vi.mock('../../route_permission_checker.js', () => ({
    hasRoutePermission: () => true,
    hasDatasetPermission: async route => route === '/api/delete-rows',
}));
vi.mock('./row_article_presentation_settings.js', () => ({
    resolveSiteTimestampDisplayOptions: async () => ({ displayMode: 'date_time', locale: 'en' }),
}));
vi.mock('./row_article_opener.js', () => ({ openRowArticleView: vi.fn() }));
vi.mock('./card_avatar_builder.js', async importOriginal => ({
    ...await importOriginal(),
    create_seeded_avatar: async () => document.createElement('span'),
}));
vi.mock('../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js', () => ({
    getUnifiedTableState: () => ({}),
}));

const table = 'style_fixture';
const columns = ['title', 'detail'];
const row = { id: 7, title: 'Title', detail: 'Value' };
const articleOptions = { viewKey: 'article_view', stateKey: 'articleView' };

async function setSiteCardStyle(style, detailColumns = 2) {
    const config = structuredClone(DEFAULT_DATASET_APPEARANCE);
    config.shared.card_show_all_fields = true;
    config.shared.card_style_variant = style;
    config.shared.card_detail_columns = detailColumns;
    await datasetAppearanceState.updateSite(config);
}

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem(table + '_dataTypes', JSON.stringify({
        title: { card_element: 'header', show_value_on_card: true },
        detail: { card_element: 'details', show_value_on_card: true },
    }));
});

afterEach(() => {
    document.querySelectorAll('.card_view_wrapper').forEach(disposeCardResources);
    datasetAppearanceState.clear();
    document.body.replaceChildren();
    localStorage.clear();
});

test.each([
    ['standard', '.card_details_kv .kv-value'],
    ['modern', '.card_details_kv .card_detail_tile_value'],
])('keeps the rendered %s article field when the same settings are applied again', async (style, selector) => {
    await setSiteCardStyle(style, 4);
    const article = await create_card_view(columns, [row], table, articleOptions);
    document.body.append(article);
    const card = article.querySelector('.card');
    applyCardFieldPresentationSetting(true, style, 4, card);
    const field = card.querySelector(selector);
    expect(field?.textContent).toBe(row.detail);

    applyCardFieldPresentationSetting(true, style, 4, card);
    expect(article.querySelector(selector)).toBe(field);
});

test('uses modern by default and changes only inherited card presentation through the existing field redraw', async () => {
    await setSiteCardStyle('modern');
    const cards = await create_card_view(columns, [row], table);
    const article = await create_card_view(columns, [row], table, articleOptions);
    document.body.append(cards, article);
    cards.style.display = 'none';
    cards.scrollTop = 73;
    const card = cards.querySelector('.card');
    const checkbox = card.querySelector('.card_checkbox');
    const media = card.querySelector('.card_image_content');
    const header = card.querySelector('.card_header');
    const articleCard = article.querySelector('.card');
    const articleMedia = articleCard.querySelector('.card_image_content');
    expect(header?.textContent).toContain(row.title);
    expect(media).toBeInstanceOf(HTMLElement);
    expect(articleMedia).toBeInstanceOf(HTMLElement);
    expect(articleCard.dataset.cardPresentationView).toBe('article_view');
    expect(articleCard.classList.contains('card--modern')).toBe(true);
    checkbox.checked = true;
    card.classList.add('selected');
    expect(card.classList.contains('card--modern')).toBe(true);
    expect(card.dataset.cardStyleOverride).toBeUndefined();
    const initialModernCalls = renderModernCardDetails.mock.calls.length;
    expect(initialModernCalls).toBeGreaterThan(0);

    await setSiteCardStyle('standard');
    expect(card.classList.contains('card--modern')).toBe(false);
    expect(card.querySelector('.card_modern_info_panel')).toBeNull();
    expect(renderKeyValuePairs).toHaveBeenCalled();
    expect(cards.querySelector('.card')).toBe(card);
    expect(card.querySelector('.card_header')).toBe(header);
    expect(card.querySelector('.card_checkbox')).toBe(checkbox);
    expect(checkbox.checked).toBe(true);
    expect(card.querySelector('.card_image_content')).toBe(media);
    expect(cards.scrollTop).toBe(73);
    expect(articleCard.classList.contains('card--modern')).toBe(false);
    expect(articleCard.querySelector('.card_modern_info_panel')).toBeNull();

    await setSiteCardStyle('modern');
    expect(card.querySelector('.card_modern_info_panel')).not.toBeNull();
    expect(articleCard.querySelector('.card_modern_info_panel')).not.toBeNull();
    expect(renderModernCardDetails).toHaveBeenCalledTimes(initialModernCalls + 2);
    await setSiteCardStyle('modern', 4);
    expect(renderModernCardDetails.mock.calls.at(-1)[3]).toEqual({ columns: 4 });
    expect(cards.querySelector('.card')).toBe(card);
    expect(card.querySelector('.card_checkbox')).toBe(checkbox);
    expect(card.querySelector('.card_image_content')).toBe(media);
    expect(articleCard.dataset.cardDetailColumns).toBe('4');
    expect(article.querySelector('.card')).toBe(articleCard);
    expect(articleCard.querySelector('.card_image_content')).toBe(articleMedia);
    expect(openRowArticleView).not.toHaveBeenCalled();

    localStorage.setItem(table + '_tableMeta', JSON.stringify({ card_style_variant: 'standard' }));
    const explicit = await create_card_view(columns, [row], table);
    document.body.append(explicit);
    expect(explicit.querySelector('.card').classList.contains('card--modern')).toBe(false);
    expect(explicit.querySelector('.card').dataset.cardStyleOverride).toBe('standard');
});
