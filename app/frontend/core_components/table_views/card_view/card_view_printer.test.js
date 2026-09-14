// card_view_printer.test.js
// Verifies card rendering for language refresh and site-wide timestamp presentation.
// Bridges row metadata, multilingual aliases, and typed settings through real card builds.
// Covers both ordinary card details and article-side compact card summaries.
// Exists to prevent raw values from surviving rebuilds or compact-mode transitions.

import { beforeEach, describe, expect, test, vi } from 'vitest';

const { resolveSiteTimestampDisplayOptionsMock, hasDatasetPermissionMock, getUnifiedTableStateMock } = vi.hoisted(() => ({
    resolveSiteTimestampDisplayOptionsMock: vi.fn(),
    hasDatasetPermissionMock: vi.fn(),
    getUnifiedTableStateMock: vi.fn(() => ({})),
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
    getUnifiedTableState: getUnifiedTableStateMock,
}));

vi.mock('../../route_permission_checker.js', () => ({
    hasDatasetPermission: hasDatasetPermissionMock,
}));

vi.mock('../../../ui_config.js', () => ({
    always_show_empty_fields_on_cards: true,
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

vi.mock('./card_detail_layout_options.js', async importOriginal => ({
    ...await importOriginal(),
    CARD_DETAILS_LAYOUT_VALUES: { SINGLE_LINE: 'single-line' },
    normalizeClientCardDetailsLayout: vi.fn(() => 'default'),
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

import { appendDataToCardView, create_card_view, refreshCardLanguages } from './card_view_printer.js';
import { addKeywordsSection } from './card_keyword_builder.js';
import { applyCardFieldPresentationSetting } from './card_field_presentation.js';
import { renderKeyValuePairs } from '../../../reusable_components/key_value_container/kv_container_printer.js';
import { renderSingleLineCardDetails } from './card_detail_single_line_helpers.js';
import { renderModernCardDetails } from './card_detail_tile_builder.js';
import { normalizeClientCardDetailsLayout } from './card_detail_layout_options.js';
import { openRowArticleView } from './row_article_opener.js';
import { create_seeded_avatar } from './card_avatar_builder.js';

describe('card language refresh', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        document.body.innerHTML = '';
        delete document.documentElement.dataset.cardShowAllFields;
        document.documentElement.dataset.cardStyleVariant = 'standard';
        delete document.documentElement.dataset.cardDetailColumns;
        vi.mocked(normalizeClientCardDetailsLayout).mockReturnValue('default');
        localStorage.clear();
        getUnifiedTableStateMock.mockReturnValue({});
        hasDatasetPermissionMock.mockReset();
        hasDatasetPermissionMock.mockResolvedValue(false);
        resolveSiteTimestampDisplayOptionsMock.mockResolvedValue({
            displayMode: 'date_time',
            locale: 'en',
        });
    });

    test.each(['ordinary_dataset', 'app_service_catalog'])('uses generic nullable metadata and effective list columns for %s', async table => {
        localStorage.setItem(table + '_dataTypes', JSON.stringify({
            detail: { card_element:'details', show_value_on_card:true },
        }));
        localStorage.setItem(table + '_tableMeta', JSON.stringify({
            card_style_variant:null, card_detail_columns:1,
        }));
        applyCardFieldPresentationSetting(true, 'modern', 4);
        const view = await create_card_view(['detail'], [{id:7,detail:'Value'}], table);
        document.body.append(view);
        const card = view.querySelector('.card');
        expect(card.dataset.datasetName).toBe(table);
        expect(card.dataset.cardStyleVariant).toBe('modern');
        expect(card.dataset.cardColumnsOverride).toBe('1');
        expect(card.dataset.cardDetailColumns).toBe('1');
        expect(view.querySelector('.card_container').dataset.cardDetailColumns).toBe('1');
        applyCardFieldPresentationSetting(true, 'standard', 2);
        expect(card.dataset.cardStyleVariant).toBe('standard');
        expect(card.dataset.cardDetailColumns).toBe('1');
    });

    test.each([
        ['standard', renderKeyValuePairs], ['single-line', renderSingleLineCardDetails], ['modern', renderModernCardDetails],
    ])('filters whole empty entries before the %s detail renderer and preserves the card node', async (layout, renderer) => {
        const table='field_fixture';
        const row={id:7, empty:null, whitespace:'   ', zero:0, boolean:false, dash:'—', na:'N/A', language:'{}'};
        const columns=Object.keys(row).filter(key=>key!=='id');
        const types=Object.fromEntries(columns.map(column=>[column,{
            card_element:'details',show_value_on_card:true,show_key_on_card:true,is_multilingual:column==='language',
        }]));
        localStorage.setItem(table+'_dataTypes',JSON.stringify(types));
        if(layout==='modern') localStorage.setItem(table+'_tableMeta',JSON.stringify({card_style_variant:'modern'}));
        if(layout==='single-line') vi.mocked(normalizeClientCardDetailsLayout).mockReturnValue('single-line');
        const view=await create_card_view(columns,[row],table); document.body.append(view);
        const card=view.querySelector('.card'); const originalRow=structuredClone(row);
        const previous=vi.mocked(renderer).mock.calls.at(-1)[1];
        expect(previous.map(entry=>entry.column)).toEqual(columns);
        applyCardFieldPresentationSetting(false);
        const filtered=vi.mocked(renderer).mock.calls.at(-1)[1];
        expect(filtered.map(entry=>entry.column)).toEqual(['zero','boolean','dash','na']);
        expect(view.querySelector('.card')).toBe(card); expect(card._row).toEqual(originalRow);
        applyCardFieldPresentationSetting(true);
        expect(vi.mocked(renderer).mock.calls.at(-1)[1].map(entry=>entry.column)).toEqual(columns);
        expect(view.querySelector('.card')).toBe(card);
    });

    test.each(['default', 'single-line'])('passes palette columns to Plain %s details without rebuilding outer cards', async (layout) => {
        vi.mocked(normalizeClientCardDetailsLayout).mockReturnValue(layout);
        const table = 'plain_columns_fixture', columns = ['detail'];
        localStorage.setItem(table + '_dataTypes', JSON.stringify({
            detail: {card_element: 'details', show_value_on_card: true},
        }));
        const cards = await create_card_view(columns, [{id: 7, detail: 'Value'}], table);
        document.body.append(cards);
        const card = cards.querySelector('.card'), media = card.querySelector('.card_image_content');
        for (const count of [1, 2, 4]) {
            applyCardFieldPresentationSetting(true, 'standard', count);
            if (layout === 'single-line') {
                expect(vi.mocked(renderSingleLineCardDetails).mock.calls.at(-1)[3]).toEqual({columns: count});
            } else {
                expect(vi.mocked(renderKeyValuePairs).mock.calls.at(-1)[2]).toMatchObject({
                    maxColumns: count, minPairWidth: 240, singleColumnBreakpoint: 0,
                });
            }
            expect(cards.querySelector('.card')).toBe(card);
            expect(card.querySelector('.card_image_content')).toBe(media);
        }
    });

    test('uses modern by default and changes only inherited card presentation through the existing field redraw', async () => {
        delete document.documentElement.dataset.cardStyleVariant;
        hasDatasetPermissionMock.mockResolvedValue(true);
        const table = 'style_fixture', columns = ['title', 'detail'];
        const row = {id: 7, title: 'Title', detail: 'Value'};
        localStorage.setItem(table + '_dataTypes', JSON.stringify({
            title: {card_element: 'header', show_value_on_card: true},
            detail: {card_element: 'details', show_value_on_card: true},
        }));
        const cards = await create_card_view(columns, [row], table);
        const article = await create_card_view(columns, [row], table, {viewKey: 'article_view', stateKey: 'articleView'});
        document.body.append(cards, article); cards.style.display = 'none'; cards.scrollTop = 73;
        const card = cards.querySelector('.card'), checkbox = card.querySelector('.card_checkbox');
        const media = card.querySelector('.card_image_content'), header = card.querySelector('h2');
        const articleDetail = article.querySelector('.card_details_kv');
        checkbox.checked = true; card.classList.add('selected');
        expect(card.classList.contains('card--modern')).toBe(true);
        expect(card.dataset.cardStyleOverride).toBeUndefined();
        const initialModernCalls = vi.mocked(renderModernCardDetails).mock.calls.length;
        expect(initialModernCalls).toBeGreaterThan(0);
        applyCardFieldPresentationSetting(true, 'standard');
        expect(card.classList.contains('card--modern')).toBe(false);
        expect(card.querySelector('.card_modern_info_panel')).toBeNull();
        expect(renderKeyValuePairs).toHaveBeenCalled();
        expect(cards.querySelector('.card')).toBe(card); expect(card.querySelector('h2')).toBe(header);
        expect(card.querySelector('.card_checkbox')).toBe(checkbox); expect(checkbox.checked).toBe(true);
        expect(card.querySelector('.card_image_content')).toBe(media); expect(cards.scrollTop).toBe(73);
        expect(article.querySelector('.card_details_kv')).toBe(articleDetail);
        applyCardFieldPresentationSetting(true, 'modern');
        expect(card.querySelector('.card_modern_info_panel')).not.toBeNull();
        expect(renderModernCardDetails).toHaveBeenCalledTimes(initialModernCalls + 1);
        applyCardFieldPresentationSetting(true, 'modern', 4);
        expect(vi.mocked(renderModernCardDetails).mock.calls.at(-1)[3]).toEqual({ columns: 4 });
        expect(cards.querySelector('.card')).toBe(card);
        expect(card.querySelector('.card_checkbox')).toBe(checkbox);
        expect(card.querySelector('.card_image_content')).toBe(media);
        expect(article.querySelector('.card_details_kv')).toBe(articleDetail);
        expect(openRowArticleView).not.toHaveBeenCalled();
        localStorage.setItem(table + '_tableMeta', JSON.stringify({card_style_variant: 'standard'}));
        const explicit = await create_card_view(columns, [row], table); document.body.append(explicit);
        expect(explicit.querySelector('.card').classList.contains('card--modern')).toBe(false);
        expect(explicit.querySelector('.card').dataset.cardStyleOverride).toBe('standard');
    });

    test('omits the whole detail container when empty while preserving article summaries and explicit hide-false', async () => {
        const table='empty_fixture';
        const columns=['empty','hiddenFalse'];
        localStorage.setItem(table+'_dataTypes',JSON.stringify({
            empty:{card_element:'details',show_value_on_card:true,show_key_on_card:true},
            hiddenFalse:{card_element:'details',show_value_on_card:true,hide_false_null_on_sml_crd:true},
        }));
        const row={id:7,empty:null,hiddenFalse:false};
        const cards=await create_card_view(columns,[row],table);
        const article=await create_card_view(columns,[row],table,{viewKey:'article_view',stateKey:'articleView'});
        document.body.append(cards,article);
        const summary=article.querySelector('.card_small_text');
        const articleDetails=article.querySelector('.card_details_kv');
        expect(articleDetails.querySelectorAll('.test-card-detail-value')).toHaveLength(1);
        applyCardFieldPresentationSetting(false);
        expect(cards.querySelector('.card_details_kv')).toBeNull();
        expect(article.querySelector('.card_details_kv')).toBe(articleDetails);
        expect(article.querySelector('.card_small_text')).toBe(summary);
    });

    test('keeps card/article checkbox ids distinct and scopes language refresh to the active article list', async () => {
        hasDatasetPermissionMock.mockResolvedValue(true);
        const table='language_fixture', columns=['title'];
        const row={id:7,title:JSON.stringify({en:'Title',fi:'Otsikko'})};
        localStorage.setItem(table+'_dataTypes',JSON.stringify({title:{card_element:'header',show_value_on_card:true,is_multilingual:true}}));
        const cards=await create_card_view(columns,[row],table);
        const article=await create_card_view(columns,[row],table,{viewKey:'article_view',stateKey:'articleView'});
        article.classList.add('article_view_wrapper');
        document.body.append(cards,article); cards.style.display='none';
        expect(cards.querySelector('input.card_checkbox').id).toBe(table+'_card_checkbox_7');
        expect(article.querySelector('input.card_checkbox').id).toBe(table+'_article_view_checkbox_7');
        const active=document.createElement('div'); active.className='active_row_article';
        active._row=row; active._table_name=table;
        article.querySelector('.big_card_placeholder').append(active);
        await refreshCardLanguages('fi');
        const selected=article.querySelector('.card');
        expect(selected.dataset.cardPresentationView).toBe('article_view');
        expect(selected.querySelector('input.card_checkbox').id).toBe(table+'_article_view_checkbox_7');
        expect(openRowArticleView).toHaveBeenLastCalledWith(row,table,selected);
        expect(selected).not.toBe(cards.querySelector('.card'));
    });

    test.each(['initial batch', 'language replacement'])('resolves a palette change during detached %s construction before mounting', async (path) => {
        const table = 'pending_fields';
        const columns = ['title', 'empty'];
        const row = { id: 7, title: JSON.stringify({ en: 'Title', fi: 'Otsikko' }), empty: '' };
        localStorage.setItem(table + '_dataTypes', JSON.stringify({
            title: { card_element: 'header', show_value_on_card: true, is_multilingual: true },
            empty: { show_value_on_card: true, show_key_on_card: true },
        }));
        let view;
        if (path === 'language replacement') {
            view = await create_card_view(columns, [row], table);
            document.body.append(view);
            expect(view.querySelector('.pending_fields-empty')).not.toBeNull();
        }
        vi.mocked(create_seeded_avatar).mockImplementationOnce(async () => {
            // Generic field groups already exist on this still-detached card.
            applyCardFieldPresentationSetting(false);
            return document.createElement('span');
        });
        if (view) await refreshCardLanguages('fi');
        else {
            view = await create_card_view(columns, [row], table);
            document.body.append(view);
        }
        expect(document.documentElement.dataset.cardShowAllFields).toBe('false');
        expect(view.querySelector('.pending_fields-empty')).toBeNull();
        expect(view.querySelector('.card').textContent).toContain(path === 'language replacement' ? 'Otsikko' : 'Title');
    });

    test('gives administrator card-selection checkboxes a translatable accessible name', async () => {
        hasDatasetPermissionMock.mockResolvedValue(true);

        const view = await create_card_view(
            ['title'],
            [{ id: 42, title: 'Accessible selection' }],
            'documents',
        );

        const checkbox = view.querySelector('[data-testid="card-select-checkbox"]');
        expect(checkbox?.getAttribute('aria-label')).toBe('Select row: 42');
        expect(checkbox?.dataset.ariaLabelLangKey).toBe('select');
        expect(checkbox?.dataset.ariaLabelLangContext).toBe('42');
    });

    test.each([
        ['article_view', 'card', true],
        ['card', 'article_view', false],
    ])('appends to %s using its own collapsed state despite a different saved view', async (viewKey, savedView, compact) => {
        const tableName = 'append_fixture';
        localStorage.setItem(tableName + '_view', savedView);
        getUnifiedTableStateMock.mockReturnValue({
            cardView: { collapsed: false },
            articleView: { collapsed: true },
        });
        const wrapper = document.createElement('div');
        wrapper.className = 'card_view_wrapper';
        wrapper.dataset.viewKey = viewKey;
        const host = document.createElement('div');
        wrapper.appendChild(host);
        document.body.appendChild(wrapper);

        await appendDataToCardView(host, [], [{ id: 7 }], tableName);

        expect(host.querySelector('.card').classList.contains('small-card')).toBe(compact);
    });

    test('uses streamed multilingual metadata in a detached article batch without rewriting cached metadata', async () => {
        const tableName = 'append_fixture';
        const metadata = {
            type_of_operation: { card_element: 'header', show_value_on_card: true, is_multilingual: true },
        };
        const oldMetadata = { type_of_operation: { ...metadata.type_of_operation, is_multilingual: false } };
        localStorage.setItem(tableName + '_dataTypes', JSON.stringify(oldMetadata));
        localStorage.setItem(tableName + '_view', 'card');
        getUnifiedTableStateMock.mockReturnValue({
            cardView: { collapsed: false },
            articleView: { collapsed: true },
        });
        const host = document.createElement('div');
        await appendDataToCardView(host, ['type_of_operation'], [{
            id: 7, type_of_operation: JSON.stringify({ en: 'Software development', fi: 'Ohjelmistokehitys' }),
        }], tableName, { viewKey: 'article_view', dataTypes: metadata });

        const card = host.querySelector('.card');
        expect(card._data_types.type_of_operation.is_multilingual).toBe(true);
        expect(card.textContent).toContain('Software development');
        expect(card.textContent).not.toContain('{"en"');
        expect(card.classList.contains('small-card')).toBe(true);
        expect(JSON.parse(localStorage.getItem(tableName + '_dataTypes'))).toEqual(oldMetadata);
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
            title: {
                card_element: 'header',
                show_key_on_card: false,
                show_value_on_card: true,
            },
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
            ['title', 'created', 'updated'],
            [{
                id: 14,
                title: 'Revontulet Lapissa',
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
        expect(sidebarDate?.dataset.titleLangKey).toBe('created');
        expect(sidebarDate?.dataset.titleLangContext).toBe('2026-08-20 00:24:42');
        expect(sidebarDate?.title).toBe('created: 2026-08-20 00:24:42');

        const sidebarTitle = view.querySelector('.small_card_name_text');
        expect(sidebarTitle?.dataset.titleLangKey).toBe('title');
        expect(sidebarTitle?.dataset.titleLangContext).toBe('Revontulet Lapissa');
        expect(sidebarTitle?.title).toBe('title: Revontulet Lapissa');
    });
    test('paged append deduplicates existing and overlapping IDs without replacing the selected card', async () => {
        const host = document.createElement('div');
        const selected = document.createElement('div');
        selected.className = 'card selected';
        selected.dataset.id = '1';
        host.append(selected);
        document.body.append(host);
        await appendDataToCardView(host, ['id'], [{ id: '1' }, { id: 2 }, { id: 2 }], 'events', { viewKey: 'article_view' });
        expect([...host.querySelectorAll('.card')].map(card => card.dataset.id)).toEqual(['1', '2']);
        expect(host.firstChild).toBe(selected);
    });

    test('a page invalidated during async rendering never commits cards to the live host', async () => {
        const host = document.createElement('div');
        document.body.append(host);
        let current = true;
        let release;
        hasDatasetPermissionMock.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
        const pending = appendDataToCardView(host, ['id'], [{ id: 2 }], 'events', { isCurrent: () => current });
        await vi.waitFor(() => expect(release).toBeTypeOf('function'));
        current = false;
        release(false);
        await pending;
        expect(host.querySelector('.card')).toBeNull();
    });

});
