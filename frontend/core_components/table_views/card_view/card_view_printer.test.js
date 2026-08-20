// card_view_printer.test.js
// Verifies card rendering for language refresh and site-wide timestamp presentation.
// Bridges row metadata, multilingual aliases, and typed settings through real card builds.
// Covers both ordinary card details and article-side compact card summaries.
// Exists to prevent raw values from surviving rebuilds or compact-mode transitions.

import { beforeEach, describe, expect, test, vi } from 'vitest';

const { resolveSiteTimestampDisplayOptionsMock } = vi.hoisted(() => ({
    resolveSiteTimestampDisplayOptionsMock: vi.fn(),
}));

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
    renderKeyValuePairs: vi.fn((container, entries) => {
        entries.forEach((entry) => {
            const value = document.createElement('span');
            value.classList.add('test-card-detail-value');
            value.dataset.column = entry.column;
            value.textContent = entry.value;
            if (entry.titleValue) value.title = entry.titleValue;
            container.appendChild(value);
        });
    }),
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

vi.mock('./row_article_presentation_settings.js', () => ({
    resolveSiteTimestampDisplayOptions: resolveSiteTimestampDisplayOptionsMock,
}));

import { create_card_view, refreshCardLanguages } from './card_view_printer.js';
import { addKeywordsSection } from './card_keyword_builder.js';

describe('card language refresh', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        document.body.innerHTML = '';
        localStorage.clear();
        resolveSiteTimestampDisplayOptionsMock.mockResolvedValue({
            displayMode: 'date_time',
            locale: 'en',
        });
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

    test('routes a keywords card role to the keyword-tag renderer', async () => {
        const tableName = 'travel_deals';
        localStorage.setItem(`${tableName}_dataTypes`, JSON.stringify({
            keywords: {
                card_element: 'keywords',
                show_key_on_card: false,
                show_value_on_card: true,
            },
        }));

        await create_card_view(
            ['keywords'],
            [{ id: 6, keywords: 'Risteilyt, matkat, Tallinna' }],
            tableName,
        );

        expect(addKeywordsSection).toHaveBeenCalledTimes(1);
        expect(addKeywordsSection.mock.calls[0][0]).toEqual([
            expect.objectContaining({
                column: 'keywords',
                rawValue: 'Risteilyt, matkat, Tallinna',
            }),
        ]);
    });

    test('applies date_only to ordinary card details and the article sidebar summary', async () => {
        const tableName = 'travel_deals';
        resolveSiteTimestampDisplayOptionsMock.mockResolvedValue({
            displayMode: 'date_only',
            locale: 'fi',
        });
        localStorage.setItem(`${tableName}_dataTypes`, JSON.stringify({
            created: {
                card_element: 'details',
                data_type: 'timestamp without time zone',
                show_key_on_card: true,
                show_value_on_card: true,
            },
            updated: {
                card_element: 'details2',
                data_type: 'timestamp without time zone',
                show_key_on_card: true,
                show_value_on_card: true,
            },
        }));

        const view = await create_card_view(
            ['created', 'updated'],
            [{
                id: 14,
                created: '2026-08-20T00:24:42.000000',
                updated: '2026-08-20T08:55:25.000000',
            }],
            tableName,
        );
        document.body.appendChild(view);

        const detailValues = Array.from(
            view.querySelectorAll('.test-card-detail-value')
        ).map((element) => element.textContent);
        expect(detailValues).toEqual(['20.8.2026', '20.8.2026']);
        expect(detailValues.join(' ')).not.toContain('T');
        expect(detailValues.join(' ')).not.toMatch(/\d{2}:\d{2}/u);

        const sidebarDate = view.querySelector('.small_card_date');
        expect(sidebarDate?.textContent).toBe('20.8.2026');
        expect(sidebarDate?.title).toBe('2026-08-20 00:24:42');
    });
});
