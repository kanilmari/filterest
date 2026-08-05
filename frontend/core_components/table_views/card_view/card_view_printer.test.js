// card_view_printer.test.js
// Verifies language refresh for visible card values supplied by generated FK aliases.
// Bridges numeric foreign keys and multilingual display aliases through a real card rebuild.
// Exists to prevent cards from staying in the old language when only the alias contains JSON.

import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../table_view/row_selection_handler.js', () => ({
    update_card_selection: vi.fn(),
}));

vi.mock('./card_avatar_builder.js', () => ({
    createImageElement: vi.fn(() => document.createElement('img')),
    create_seeded_avatar: vi.fn(async () => document.createElement('span')),
}));

vi.mock('./row_article_opener.js', () => ({
    openRowArticleView: vi.fn(),
}));

vi.mock('./card_keyword_builder.js', () => ({
    addKeywordsSection: vi.fn(),
}));

vi.mock('./card_element_builder.js', () => ({
    generateGoogleMapsEmbedSrcFromRow: vi.fn(() => ''),
    addHeaderElement: vi.fn((value, _label, _column, _hasLangKey, _row, _table, container) => {
        const header = document.createElement('h2');
        header.textContent = value;
        container.appendChild(header);
        return header;
    }),
    addUsernameElement: vi.fn((value) => {
        const username = document.createElement('span');
        username.textContent = value;
        return username;
    }),
    addImageOrAvatar: vi.fn(),
    addDescriptionSection: vi.fn(),
    updateCardImageSources: vi.fn(),
}));

vi.mock('./card_field_formatter.js', () => ({
    parseRoleString: vi.fn((value) => ({
        baseRoles: String(value || '').split(/[\s,]+/u).filter(Boolean),
        hasLangKey: false,
    })),
    createKeyValueElement: vi.fn((_label, _raw, _column, _hasLangKey, _className, value) => {
        const element = document.createElement('span');
        element.textContent = value;
        return element;
    }),
    format_column_name: vi.fn((column) => column),
    createTicketStatusBadge: vi.fn((value) => {
        const badge = document.createElement('span');
        badge.textContent = value;
        return badge;
    }),
}));

vi.mock('./relation_detail_helpers.js', () => ({
    expandForeignKeyDetailEntries: vi.fn((entries) => entries),
}));

vi.mock('../../dev_tools/function_counter.js', () => ({
    count_this_function: vi.fn(),
}));

vi.mock('../../filterbar/filter_list/column_visibility_handler.js', () => ({
    makeColumnClass: vi.fn((table, column) => `${table}-${column}`),
}));

vi.mock('../../../reusable_components/key_value_container/kv_container_printer.js', () => ({
    renderKeyValuePairs: vi.fn(),
}));

vi.mock('../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js', () => ({
    getUnifiedTableState: vi.fn(() => ({})),
}));

vi.mock('../../route_permission_checker.js', () => ({
    hasDatasetPermission: vi.fn(async () => false),
}));

vi.mock('../../../ui_config.js', () => ({
    always_show_empty_fields_on_cards: false,
    resolveCardMediaFolder: vi.fn(() => 'card_images'),
    show_more_button_on_cards: false,
}));

vi.mock('../../state_stores/lang_preference_reader.js', () => ({
    getLanguageWithBrowserFallback: vi.fn(() => 'en'),
}));

vi.mock('../../endpoints/endpoint_router.js', () => ({
    endpoint_router: vi.fn(),
}));

vi.mock('../experimental_free_layout_card/experimental_free_layout_card_view.js', () => ({
    createExperimentalFreeLayoutCard: vi.fn(),
    createExperimentalFreeLayoutToolbar: vi.fn(() => document.createElement('div')),
    rebuildExperimentalFreeLayoutCard: vi.fn(),
}));

vi.mock('../experimental_free_layout_card/experimental_free_layout_card_store.js', () => ({
    EXPERIMENTAL_FREE_LAYOUT_CARD_STYLE_VARIANT: 'experimental-free-layout',
    getEffectiveCardStyleVariant: vi.fn(() => 'classic'),
}));

vi.mock('./card_element_builder_helpers.js', () => ({
    hasFallbackCardImageColumn: vi.fn(() => false),
    resolveFallbackCardImageValue: vi.fn(() => ''),
}));

vi.mock('./card_image_render_options.js', () => ({
    buildCardImageRenderOptions: vi.fn(() => ({})),
    CARD_IMAGE_RENDER_SLOTS: {
        CARD_MEDIA: 'card-media',
        SMALL_THUMBNAIL: 'small-thumbnail',
    },
}));

vi.mock('./card_detail_single_line_helpers.js', () => ({
    renderSingleLineCardDetails: vi.fn(),
}));

vi.mock('./card_detail_tile_builder.js', () => ({
    renderModernCardDetails: vi.fn(),
}));

vi.mock('./card_detail_layout_options.js', () => ({
    CARD_DETAILS_LAYOUT_VALUES: { SINGLE_LINE: 'single-line' },
    CARD_STYLE_VARIANT_VALUES: { MODERN: 'modern' },
    normalizeClientCardDetailsLayout: vi.fn(() => 'default'),
    normalizeClientCardStyleVariant: vi.fn((value) => value || 'classic'),
    resolveKvLayoutModeForCardDetails: vi.fn(() => 'default'),
}));

vi.mock('./dataset_icon_builder.js', () => ({
    createDatasetIconElement: vi.fn(() => document.createElement('span')),
}));

vi.mock('./card_detail_standard_key_decorator.js', () => ({
    decorateStandardCardDetailKey: vi.fn(),
}));

import { create_card_view, refreshCardLanguages } from './card_view_printer.js';

describe('card language refresh', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        localStorage.clear();
    });

    test('rebuilds a numeric FK card from its multilingual alias using the requested language', async () => {
        const tableName = 'tasks';
        const columns = ['queue_id'];
        const row = {
            id: 7,
            queue_id: 9,
            'queue_name (ln)': JSON.stringify({
                en: 'Feature development',
                fi: 'Ominaisuuksien kehitys',
            }),
        };
        localStorage.setItem(`${tableName}_dataTypes`, JSON.stringify({
            queue_id: {
                foreign_table: 'queues',
                show_value_on_card: true,
                show_key_on_card: false,
                card_element: 'header',
            },
        }));

        const view = await create_card_view(columns, [row], tableName);
        document.body.appendChild(view);

        const englishCard = document.querySelector('.card');
        expect(englishCard.textContent).toContain('Feature development');
        expect(englishCard.textContent).not.toContain('{"en"');
        expect(englishCard._hasLocalizedRowData).toBe(true);

        // The stored preference remains English. The explicit refresh argument
        // must still drive the rebuilt card to Finnish.
        await refreshCardLanguages('fi');

        const finnishCard = document.querySelector('.card');
        expect(finnishCard).not.toBe(englishCard);
        expect(finnishCard.textContent).toContain('Ominaisuuksien kehitys');
        expect(finnishCard.textContent).not.toContain('Feature development');
        expect(finnishCard.textContent).not.toContain('{"en"');
    });
});
