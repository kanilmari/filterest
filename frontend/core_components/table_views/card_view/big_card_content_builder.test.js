// big_card_content_builder.test.js
// Verifies big-card media rendering keeps service-catalog logo contrast protection wired narrowly.
// Bridges buildBigCardContent and its mocked card-media dependencies with jsdom DOM assertions.
// Exists to keep the CRITICAL big-card surface limited to the logo wrapper path only.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
    createImageElementMock,
    createSeededAvatarMock,
    createRowArticleKeyValueElementMock,
    createTicketStatusBadgeMock,
    isTicketStatusFieldMock,
    resolveRowArticleRelationDetailEntriesMock,
} = vi.hoisted(() => ({
    createImageElementMock: vi.fn(),
    createSeededAvatarMock: vi.fn(),
    createRowArticleKeyValueElementMock: vi.fn(),
    createTicketStatusBadgeMock: vi.fn(),
    isTicketStatusFieldMock: vi.fn(),
    resolveRowArticleRelationDetailEntriesMock: vi.fn((entries) => entries),
}));

vi.mock('./card_field_formatter.js', () => ({
    parseRoleString: vi.fn((roleString = '') => {
        const baseRoles = [];
        let hasLangKey = false;
        String(roleString || '').split(',').forEach((role) => {
            const parts = role.split('+').map((part) => part.trim()).filter(Boolean);
            const [mainRole, ...extras] = parts;
            if (mainRole) baseRoles.push(mainRole);
            if (extras.some((extra) => extra === 'lang-key' || extra === 'lang_key')) {
                hasLangKey = true;
            }
        });
        return { baseRoles, hasLangKey };
    }),
    format_column_name: vi.fn((column) => column),
    createTicketStatusBadge: createTicketStatusBadgeMock,
}));

vi.mock('./card_field_formatter_helpers.js', () => ({
    isGeneratedForeignDisplayColumn: vi.fn(() => false),
    isTicketStatusField: isTicketStatusFieldMock,
    resolveCardFieldDisplayValue: vi.fn((rowItem, column) => ({
        rawValue: rowItem[column] ?? '',
        displayValue: String(rowItem[column] ?? ''),
        isMultilingual: false,
    })),
}));

vi.mock('../../filterbar/filter_list/column_visibility_handler.js', () => ({
    makeColumnClass: vi.fn(() => 'mock-column'),
}));

vi.mock('./card_element_builder.js', () => ({
    addUsernameElement: vi.fn(() => document.createElement('div')),
}));

vi.mock('./card_avatar_builder.js', () => ({
    createImageElement: createImageElementMock,
    create_seeded_avatar: createSeededAvatarMock,
}));

vi.mock('../../../ui_config.js', () => ({
    always_show_empty_fields_on_cards: true,
    row_article_relation_details_mode: 'hide',
}));

vi.mock('../../state_stores/lang_preference_reader.js', () => ({
    getLanguageWithBrowserFallback: vi.fn(() => 'en'),
}));

vi.mock('./row_article_ui_handler.js', () => ({
    createTwoLineKeyValueElement: vi.fn(() => document.createElement('div')),
    createRowArticleKeyValueElement: createRowArticleKeyValueElementMock,
    createNavigableTwoLineElement: vi.fn(() => document.createElement('div')),
    createRowArticleNavigableElement: vi.fn(() => document.createElement('div')),
    resolveLocalizedValue: vi.fn((value) => String(value ?? '')),
    resolveRowArticleLocalizedValue: vi.fn((value) => String(value ?? '')),
}));

vi.mock('./row_article_content_builder_helpers.js', () => ({
    extractSuffixNumber: vi.fn(() => 0),
    splitKeywords: vi.fn(() => []),
    resolveImagePath: vi.fn((value) => value),
    classifyRole: vi.fn((role) => role),
}));

vi.mock('./relation_detail_helpers.js', () => ({
    expandForeignKeyDetailEntries: vi.fn((entries) => entries),
    resolveRowArticleRelationDetailEntries: resolveRowArticleRelationDetailEntriesMock,
}));

import { buildBigCardContent } from './big_card_content_builder.js';
import { buildRowArticleContent } from './row_article_content_builder.js';
import { CARD_IMAGE_RENDER_SLOTS } from './card_image_render_options.js';

describe('big_card_content_builder', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        localStorage.clear();
        createImageElementMock.mockReset();
        createSeededAvatarMock.mockReset();
        createRowArticleKeyValueElementMock.mockReset();
        createTicketStatusBadgeMock.mockReset();
        createTicketStatusBadgeMock.mockImplementation(() => document.createElement('div'));
        isTicketStatusFieldMock.mockReset();
        isTicketStatusFieldMock.mockReturnValue(false);
        resolveRowArticleRelationDetailEntriesMock.mockReset();
        resolveRowArticleRelationDetailEntriesMock.mockImplementation((entries) => entries);

        createImageElementMock.mockImplementation((imageSrc) => {
            const wrapper = document.createElement('div');
            wrapper.classList.add('wrapper');
            const image = document.createElement('img');
            image.src = imageSrc;
            wrapper.appendChild(image);
            return wrapper;
        });

        createSeededAvatarMock.mockResolvedValue(document.createElement('div'));
        createRowArticleKeyValueElementMock.mockImplementation(() => document.createElement('div'));
    });

    test('keeps the legacy big-card export mapped to the row article builder', () => {
        expect(buildBigCardContent).toBe(buildRowArticleContent);
    });

    test('returns row_article aliases alongside the legacy content-builder keys', async () => {
        const built = await buildRowArticleContent(
            { cached_image: '/storage/3500/35001/original/3500_35001_1.svg' },
            'app_org_service_catalog',
            { cached_image: { card_element: 'image' } },
            ['cached_image'],
            'seed-1',
            'M',
            true
        );

        expect(built.rowArticleContentElement).toBe(built.card_modal_content_div);
        expect(built.rowArticleHeaderText).toBe(built.modal_header_text);
    });

    test('prepends the dataset icon to the row article header', async () => {
        localStorage.setItem(
            'app_service_catalog_tableMeta',
            JSON.stringify({ icon_key: 'building' })
        );
        createRowArticleKeyValueElementMock.mockImplementation(() => {
            const wrapper = document.createElement('span');
            wrapper.classList.add('big_card_header_value');
            wrapper.textContent = 'Firefox';
            return wrapper;
        });

        const built = await buildRowArticleContent(
            { title: 'Firefox' },
            'app_service_catalog',
            { title: { card_element: 'header' } },
            ['title'],
            'seed-1',
            'F',
            false
        );

        const header = built.rowArticleContentElement.querySelector('.big_card_header');

        expect(header?.classList.contains('big_card_header--with-dataset-icon')).toBe(true);
        expect(header?.firstElementChild?.classList.contains('big_card_header_dataset_icon')).toBe(true);
        expect(header?.querySelector('.big_card_header_dataset_icon path')?.getAttribute('d')).toBeTruthy();
    });

    test('keeps the row article title before the first image', async () => {
        const built = await buildRowArticleContent(
            {
                title: 'Password reset',
                cached_image: '/storage/104/6005/original/password.png',
            },
            'app_service_catalog',
            {
                title: { card_element: 'header' },
                cached_image: { card_element: 'image' },
            },
            ['cached_image', 'title'],
            'seed-1',
            'P',
            true
        );

        const children = Array.from(built.rowArticleContentElement.children);
        const headerIndex = children.findIndex((child) => child.classList.contains('big_card_header'));
        const imageIndex = children.findIndex((child) => child.classList.contains('big_card_image'));

        expect(headerIndex).toBeGreaterThanOrEqual(0);
        expect(imageIndex).toBeGreaterThanOrEqual(0);
        expect(headerIndex).toBeLessThan(imageIndex);
    });

    test('does not render seeded avatar media in row article when no real image exists', async () => {
        const noImageRole = await buildRowArticleContent(
            {
                title: 'Liialliset oikeudet jäävät voimaan',
                description: 'Risk summary',
            },
            'riskienhallinta',
            {
                title: { card_element: 'header' },
                description: { card_element: 'description' },
            },
            ['title', 'description'],
            'seed-1',
            'L',
            false
        );

        const emptyImageRole = await buildRowArticleContent(
            {
                title: 'Password reset',
                cached_image: '',
            },
            'app_service_catalog',
            {
                title: { card_element: 'header' },
                cached_image: { card_element: 'image' },
            },
            ['title', 'cached_image'],
            'seed-2',
            'P',
            true
        );

        expect(noImageRole.rowArticleContentElement.querySelector('.big_card_image')).toBeNull();
        expect(emptyImageRole.rowArticleContentElement.querySelector('.big_card_image')).toBeNull();
        expect(createSeededAvatarMock).not.toHaveBeenCalled();
    });

    test('does not repeat the row article title as lower description content', async () => {
        await buildRowArticleContent(
            {
                title: 'Jaetun postilaatikon perustamisen ohjeistus',
                summary: 'Jaetun postilaatikon perustamisen ohjeistus',
                cached_image: '/storage/104/6005/original/shared-mailbox.png',
            },
            'dokumentaatio',
            {
                title: { card_element: 'header,description' },
                summary: { card_element: 'description' },
                cached_image: { card_element: 'image' },
            },
            ['title', 'cached_image', 'summary'],
            'seed-1',
            'J',
            true
        );

        const titleCalls = createRowArticleKeyValueElementMock.mock.calls
            .filter((call) => call[2] === 'title');
        const summaryCalls = createRowArticleKeyValueElementMock.mock.calls
            .filter((call) => call[2] === 'summary');

        expect(titleCalls).toHaveLength(1);
        expect(titleCalls[0][4]).toBe('big_card_header_value');
        expect(summaryCalls).toHaveLength(0);
    });

    test('marks row-article cached image with the inline media slot', async () => {
        const imagePath = '/storage/104/6005/original/firefox.svg';
        const built = await buildRowArticleContent(
            {
                title: 'Firefox',
                cached_image: imagePath,
                cached_image_type_id: 1,
                cached_image_metadata_json: JSON.stringify({ logo_variant: 'firefox' }),
            },
            'app_service_catalog',
            {
                title: { card_element: 'header' },
                cached_image: { card_element: 'image' },
            },
            ['title', 'cached_image'],
            'seed-1',
            'F',
            true
        );

        const inlineImage = built.rowArticleContentElement.querySelector('.big_card_image');

        expect(inlineImage?.dataset.rowArticleImageColumn).toBe('cached_image');
        expect(inlineImage?.dataset.rowArticleImageSlot).toBe(CARD_IMAGE_RENDER_SLOTS.ROW_ARTICLE_INLINE);
        expect(createImageElementMock).toHaveBeenCalledWith(
            imagePath,
            true,
            expect.objectContaining({
                tableName: 'app_service_catalog',
                rowLabel: 'Firefox',
                renderSlot: CARD_IMAGE_RENDER_SLOTS.ROW_ARTICLE_INLINE,
                imageTypeId: 1,
                imageMetadata: JSON.stringify({ logo_variant: 'firefox' }),
            })
        );
    });

    test('skips cached image companion fields in row article body', async () => {
        await buildRowArticleContent(
            {
                title: 'Binance',
                cached_image: '/storage/104/161/original/104_161_55.png',
                cached_image_original_name: '104_161_55.png',
                cached_image_type_id: 0,
                cached_username: 'binance_fan',
            },
            'app_service_catalog',
            {
                title: { card_element: 'header' },
                cached_image: { card_element: 'image' },
                cached_username: { card_element: 'username' },
            },
            [
                'title',
                'cached_image',
                'cached_image_original_name',
                'cached_image_type_id',
                'cached_username',
            ],
            'seed-1',
            'B',
            true
        );

        const renderedColumns = createRowArticleKeyValueElementMock.mock.calls
            .map((call) => call[2]);

        expect(renderedColumns).not.toContain('cached_image_original_name');
        expect(renderedColumns).not.toContain('cached_image_type_id');
        expect(createImageElementMock).toHaveBeenCalledWith(
            '/storage/104/161/original/104_161_55.png',
            true,
            expect.objectContaining({
                tableName: 'app_service_catalog',
                rowLabel: 'Binance',
                renderSlot: CARD_IMAGE_RENDER_SLOTS.ROW_ARTICLE_INLINE,
            })
        );
    });

    test('renders dev task status as one editable badge', async () => {
        isTicketStatusFieldMock.mockImplementation((tableName, columnName) => (
            tableName === 'dev_agent_tasks' && columnName === 'status'
        ));
        const badge = document.createElement('div');
        badge.classList.add('ticket_status_badge');
        createTicketStatusBadgeMock.mockReturnValue(badge);
        createRowArticleKeyValueElementMock.mockImplementation((label, value, column) => {
            const wrapper = document.createElement('div');
            const valueEl = document.createElement('div');
            valueEl.dataset.column = column;
            valueEl.dataset.rawValue = value;
            valueEl.textContent = value;
            wrapper.appendChild(valueEl);
            return wrapper;
        });

        const built = await buildRowArticleContent(
            {
                id: 844,
                title: 'Aborted status acceptance test',
                status: 'in_progress',
            },
            'dev_agent_tasks',
            {
                title: {},
                status: { data_type: 'text' },
            },
            ['title', 'status'],
            'seed-1',
            'A',
            false
        );

        expect(createTicketStatusBadgeMock).toHaveBeenCalledWith('in_progress');
        expect(createRowArticleKeyValueElementMock).not.toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            'status',
            expect.anything(),
            expect.anything(),
            expect.anything(),
            expect.anything(),
            expect.anything(),
            expect.anything()
        );

        const statusElements = built.rowArticleContentElement.querySelectorAll('[data-column="status"]');
        expect(statusElements).toHaveLength(1);
        expect(statusElements[0]).toBe(badge);
        expect(statusElements[0].dataset.rawValue).toBe('in_progress');
    });

    test('routes an unconfigured FK field through the article relation policy', async () => {
        resolveRowArticleRelationDetailEntriesMock.mockReturnValue([]);

        await buildRowArticleContent(
            { id: 5, service_id: 12 },
            'risks',
            { service_id: { foreign_table: 'services' } },
            ['service_id'],
            'seed-1',
            '',
            false
        );

        expect(resolveRowArticleRelationDetailEntriesMock).toHaveBeenCalledWith(
            [expect.objectContaining({ column: 'service_id', rawValue: '12' })],
            expect.objectContaining({ service_id: 12 }),
            expect.objectContaining({ service_id: expect.any(Object) }),
            'hide'
        );
        expect(createRowArticleKeyValueElementMock).not.toHaveBeenCalled();
    });
});
