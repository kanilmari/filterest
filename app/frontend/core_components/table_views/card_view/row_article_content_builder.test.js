// row_article_content_builder.test.js
// Verifies article content, detail disclosures and narrowly scoped card-media integration.
// Bridges buildRowArticleContent and its mocked card-media dependencies with jsdom DOM assertions.
// Exists to preserve article content contracts while shared renderers and wrappers evolve.
// @vitest-environment jsdom

import { ROW_ARTICLE_PERMISSION_ROUTES, hasRowArticlePermission } from './row_article_permission_checker.js';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import {
    createImageElementMock,
    createSeededAvatarMock,
    createRowArticleKeyValueElementMock,
    createRowArticleNavigableElementMock,
    createTicketStatusBadgeMock,
    bindImageFirstViewActivationMock,
    isTicketStatusFieldMock,
    resolveRowArticleTimestampDisplayOptionsMock,
    resolveRowArticleRelationDetailEntriesMock,
    fetchAuthModesMock,
    fetchUserPermissionsMock,
} from './row_article_content_builder_test_setup.js';

import { buildRowArticleContent } from './row_article_content_builder.js';
import { CARD_IMAGE_RENDER_SLOTS } from './card_image_render_options.js';
import { resolveCardFieldDisplayValue } from './card_field_formatter_helpers.js';
import { setAuthModes } from '../../admin_tools/auth_mode_handler.js';

describe('row_article_content_builder', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        sessionStorage.setItem('user_permissions', JSON.stringify(Object.values(ROW_ARTICLE_PERMISSION_ROUTES)));
        localStorage.clear();
        fetchAuthModesMock.mockReset();
        fetchUserPermissionsMock.mockReset();
        createImageElementMock.mockReset();
        createSeededAvatarMock.mockReset();
        createRowArticleKeyValueElementMock.mockReset();
        createRowArticleNavigableElementMock.mockReset();
        createTicketStatusBadgeMock.mockReset();
        bindImageFirstViewActivationMock.mockReset();
        createTicketStatusBadgeMock.mockImplementation(() => document.createElement('div'));
        isTicketStatusFieldMock.mockReset();
        isTicketStatusFieldMock.mockReturnValue(false);
        resolveRowArticleTimestampDisplayOptionsMock.mockReset();
        resolveRowArticleTimestampDisplayOptionsMock.mockResolvedValue({
            displayMode: 'date_time',
            locale: 'en',
        });
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
        createRowArticleNavigableElementMock.mockImplementation(() => document.createElement('div'));
    });

    test.each(['administrator', 'reader', 'revoked'])('%s grants keep article text and the large image', async (group) => {
        const grants = group === 'administrator' ? Object.values(ROW_ARTICLE_PERMISSION_ROUTES)
            : group === 'revoked' ? [] : [ROW_ARTICLE_PERMISSION_ROUTES.details];
        sessionStorage.setItem('user_permissions', JSON.stringify(grants));
        createRowArticleKeyValueElementMock.mockImplementation((_label, value, column, _key, className) => {
            const element = document.createElement('div');
            element.className = className;
            element.dataset.column = column;
            element.textContent = value;
            return element;
        });
        const row = { title: 'An article', description: 'Always visible text', image: '/photo.jpg', note: 'A detail' };
        const roles = { title: 'header', description: 'description', image: 'image', note: 'details' };
        const metadata = Object.fromEntries(Object.entries(roles).map(([column, card_element]) => [column, { card_element }]));
        const { rowArticleContentElement: content } = await buildRowArticleContent(
            row, 'events', metadata, Object.keys(row), 'seed', 'A', true,
        );
        expect(content.querySelector('.big_card_description_container').textContent).toBe('Always visible text');
        expect(content.querySelector('.big_card_image img').getAttribute('src')).toBe('/photo.jpg');
        expect(content.querySelectorAll('.row_article_details_section')).toHaveLength(group === 'revoked' ? 0 : 1);
        const detailBuilds = createRowArticleKeyValueElementMock.mock.calls.filter(args => args[2] === 'note');
        expect(detailBuilds).toHaveLength(group === 'revoked' ? 0 : 1);
    });

    test.each(['default', 'revoked', 'fetch failure', 'malformed', 'non-UI'])('real anonymous bootstrap: %s', async (state) => {
        sessionStorage.clear(); // No synthetic permissions: run the application's guest bootstrap.
        createRowArticleKeyValueElementMock.mockImplementation((_label, value) => {
            const element = document.createElement('div');
            element.textContent = value;
            return element;
        });
        const grants = state === 'default' ? [ROW_ARTICLE_PERMISSION_ROUTES.details]
            : state === 'malformed' ? 'invalid' : state === 'non-UI' ? ['/api/delete-rows'] : [];
        fetchAuthModesMock.mockResolvedValue({ needs_button: 'login', guest_ui_endpoints: grants });
        await setAuthModes();
        if (state === 'revoked' || state === 'fetch failure') {
            fetchAuthModesMock.mockResolvedValueOnce({ needs_button: 'login', guest_ui_endpoints: [ROW_ARTICLE_PERMISSION_ROUTES.details] });
            await setAuthModes();
            expect(hasRowArticlePermission('details')).toBe(true);
            if (state === 'fetch failure') fetchAuthModesMock.mockRejectedValueOnce(new Error('offline'));
            await setAuthModes();
        }
        const { rowArticleContentElement: content } = await buildRowArticleContent(
            { description: 'Visible body', note: 'Guest detail' }, 'events',
            { description: { card_element: 'description' }, note: { card_element: 'details' } },
            ['description', 'note'], 'seed', '', false, 1,
        );
        expect(content.querySelector('.big_card_description_container').textContent).toBe('Visible body');
        expect(content.querySelectorAll('.row_article_details_section')).toHaveLength(state === 'default' ? 1 : 0);
        for (const key of Object.keys(ROW_ARTICLE_PERMISSION_ROUTES)) {
            expect(hasRowArticlePermission(key)).toBe(state === 'default' && key === 'details');
        }
        expect(fetchUserPermissionsMock).not.toHaveBeenCalled();
    });

    test.each([false, true])('applies details opening default %s without losing field content', async (startOpen) => {
        const built = await buildRowArticleContent(
            { location: 'Helsinki' }, 'events',
            { location: { card_element: 'details', show_key_on_card: true } },
            ['location'], 'seed', '', false, null,
            { sectionDefaults: { details: startOpen } },
        );
        const section = built.rowArticleContentElement.querySelector('.row_article_details_section');
        expect(section?.querySelector('button')?.getAttribute('aria-expanded')).toBe(String(startOpen));
        expect(createRowArticleKeyValueElementMock).toHaveBeenCalled();
        expect(section?.querySelector('.big_card_details_container')).not.toBeNull();
    });

    test('marks multilingual keyword tags read-only for the article editor', async () => {
        vi.mocked(resolveCardFieldDisplayValue)
            .mockImplementationOnce(() => ({
                rawValue: JSON.stringify({ fi: 'risteilyt, matkat', en: 'cruises, travel' }),
                displayValue: 'risteilyt, matkat',
                isMultilingual: true,
            }))
            .mockImplementationOnce(() => ({
                rawValue: JSON.stringify({ fi: 'risteilyt, matkat', en: 'cruises, travel' }),
                displayValue: 'risteilyt, matkat',
                isMultilingual: true,
            }));

        const built = await buildRowArticleContent(
            { keywords: JSON.stringify({ fi: 'risteilyt, matkat', en: 'cruises, travel' }) },
            'travel_deals',
            { keywords: { card_element: 'keywords', is_multilingual: true } },
            ['keywords'],
            'seed-1',
            'R',
            false
        );

        const keywordFields = built.rowArticleContentElement.querySelectorAll(
            '[data-article-edit-readonly="true"]'
        );
        expect(keywordFields).toHaveLength(2);
    });

    test('article keywords recover a language map even when generic metadata says non-multilingual', async () => {
        const rawValue = JSON.stringify({
            en: 'binance, binance.com, cryptocurrencies',
            fi: 'binance, binance.com, kryptovaluutat',
        });
        vi.mocked(resolveCardFieldDisplayValue)
            .mockImplementationOnce(() => ({
                rawValue,
                displayValue: rawValue,
                isMultilingual: false,
            }))
            .mockImplementationOnce(() => ({
                rawValue,
                displayValue: rawValue,
                isMultilingual: false,
            }));

        await buildRowArticleContent(
            { keywords_static: rawValue },
            'app_service_catalog',
            { keywords_static: { card_element: 'keywords', is_multilingual: false } },
            ['keywords_static'],
            'seed-1',
            'B',
            false
        );

        expect(createRowArticleKeyValueElementMock.mock.calls.map((call) => call[1]))
            .toEqual(['binance', 'binance.com', 'cryptocurrencies']);
    });

    test('passes the DB-backed timestamp presentation mode to article detail fields', async () => {
        resolveRowArticleTimestampDisplayOptionsMock.mockResolvedValueOnce({
            displayMode: 'date_only',
            locale: 'fi',
        });

        await buildRowArticleContent(
            { created: '2026-08-20T08:55:25' },
            'travel_info',
            {
                created: {
                    card_element: 'details',
                    data_type: 'timestamp with time zone',
                    show_key_on_card: true,
                },
            },
            ['created'],
            'seed-1',
            'T',
            false
        );

        expect(resolveRowArticleTimestampDisplayOptionsMock).toHaveBeenCalledWith('en');
        expect(createRowArticleKeyValueElementMock).toHaveBeenCalledWith(
            'created',
            '2026-08-20T08:55:25',
            'created',
            false,
            'big_card_detail_value',
            true,
            false,
            '2026-08-20T08:55:25',
            expect.objectContaining({ data_type: 'timestamp with time zone' }),
            { displayMode: 'date_only', locale: 'fi' }
        );
    });

    test('starts Details open and toggles its content without removing field labels or values', async () => {
        createRowArticleKeyValueElementMock.mockImplementation((label, value, column, _lang, _class, showKey) => {
            const field = document.createElement('div');
            field.dataset.column = column;
            field.textContent = showKey ? label + ': ' + value : String(value);
            return field;
        });
        const built = await buildRowArticleContent(
            { id: 7, location: 'Helsinki' },
            'travel_info',
            {
                id: { card_element: 'details', show_key_on_card: true },
                location: { card_element: 'details', show_key_on_card: true },
            },
            ['id', 'location'], 'seed-1', 'T', false,
        );
        const content = built.rowArticleContentElement;
        document.body.appendChild(content);
        const section = content.querySelector(':scope > .row_article_details_section');
        const button = section.querySelector('button.row_article_disclosure_header');
        expect(button).not.toBeNull();
        const shell = section.querySelector('.animated-disclosure-content-shell');
        const details = section.querySelector('.big_card_details_container');
        const fields = [...details.querySelectorAll('[data-column]')];
        expect(button.querySelector('[data-lang-key="row_article_section_details"]').textContent).toBe('Details');
        expect(button.getAttribute('aria-controls')).toBe(shell.id);
        expect(button.getAttribute('aria-expanded')).toBe('true');
        expect(shell.hidden).toBe(false);
        expect(details.textContent).toBe('id: 7location: Helsinki');
        expect(fields).toHaveLength(2);

        button.click();
        expect(button.getAttribute('aria-expanded')).toBe('false');
        await vi.waitFor(() => expect(shell.hidden).toBe(true));
        expect(button.hidden).toBe(false);
        expect([...details.querySelectorAll('[data-column]')]).toEqual(fields);

        button.click();
        expect(button.getAttribute('aria-expanded')).toBe('true');
        await vi.waitFor(() => expect(shell.hidden).toBe(false));
        expect(details.textContent).toBe('id: 7location: Helsinki');
        expect([...details.querySelectorAll('[data-column]')]).toEqual(fields);
        section.destroy();
    });

    test('does not create an empty Details disclosure when no details survive the article policy', async () => {
        resolveRowArticleRelationDetailEntriesMock.mockReturnValueOnce([]);
        const built = await buildRowArticleContent(
            { related_id: 7 }, 'travel_info',
            { related_id: { card_element: 'details', foreign_table: 'locations' } },
            ['related_id'], 'seed-1', 'T', false,
        );
        expect(built.rowArticleContentElement.querySelector('.row_article_details_section')).toBeNull();
        expect(built.rowArticleContentElement.querySelector('[data-lang-key="row_article_section_details"]')).toBeNull();
        expect(built.rowArticleContentElement.querySelector('.big_card_details_container')).toBeNull();
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
        expect(header?.querySelector('.big_card_header_dataset_icon')?.dataset.symbolKey).toBe('building');
    });

    test('does not add an automatic table icon to a row article header', async () => {
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

        expect(header?.classList.contains('big_card_header--with-dataset-icon')).toBe(false);
        expect(header?.querySelector('.big_card_header_dataset_icon')).toBeNull();
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
        const imageWrapper = inlineImage?.querySelector('.wrapper');

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
        expect(bindImageFirstViewActivationMock).toHaveBeenCalledWith(
            imageWrapper,
            expect.objectContaining({
                imageSrc: imagePath,
                rowItem: expect.objectContaining({ title: 'Firefox' }),
                tableName: 'app_service_catalog',
                selectedCard: null,
            }),
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

    describe('fields hidden on the article unless the row is the viewer\'s own', () => {
        const renderedColumns = () => createRowArticleKeyValueElementMock.mock.calls.map((call) => call[2]);
        const buildOwnFieldArticle = (rowItem, dataTypes, currentUserId) => buildRowArticleContent(
            rowItem, 'owner_notes', dataTypes, Object.keys(rowItem), 'seed-1', 'N', false, currentUserId,
        );
        const secretMeta = { hide_on_bg_crd_if_not_own: true };

        test('hides the field when the server proved no owner, even if the row id equals the viewer id', async () => {
            await buildOwnFieldArticle(
                { id: 42, created_by: 42, user_id: 42, secret: 'draft' },
                { id: {}, created_by: {}, user_id: {}, secret: secretMeta },
                42,
            );
            expect(renderedColumns()).not.toContain('secret');
            expect(renderedColumns()).toContain('id');
        });

        test('shows the field to the owner the server marked', async () => {
            await buildOwnFieldArticle(
                { id: 7, user_id: 42, secret: 'draft' },
                { id: {}, user_id: { is_row_owner: true }, secret: secretMeta },
                42,
            );
            expect(renderedColumns()).toContain('secret');
        });

        test.each([
            ['another signed-in user', { id: 7, user_id: 42, secret: 'draft' }, 43],
            ['a row whose owner value was not delivered', { id: 42, secret: 'draft' }, 42],
            ['a row without an owner', { id: 7, user_id: null, secret: 'draft' }, 42],
            ['the guest, even on a row it would match', { id: 7, user_id: 1, secret: 'draft' }, 1],
            ['a signed-out viewer', { id: 7, user_id: 42, secret: 'draft' }, null],
        ])('hides the field from %s', async (_label, rowItem, currentUserId) => {
            await buildOwnFieldArticle(
                rowItem,
                { id: {}, user_id: { is_row_owner: true }, secret: secretMeta },
                currentUserId,
            );
            expect(renderedColumns()).not.toContain('secret');
        });
    });

    test('marks raw details-link fields for external HTTP(S)-only navigation', async () => {
        await buildRowArticleContent(
            { id: 5, website: 'https://example.test' },
            'orders',
            { website: { card_element: 'details_link' } },
            ['website'],
            'seed-1',
            '',
            false
        );

        expect(createRowArticleNavigableElementMock).toHaveBeenCalledWith(
            expect.objectContaining({
                value: 'https://example.test',
                href: 'https://example.test',
                externalHttpOnly: true,
                openPrimaryInNewTab: true,
            })
        );
    });
});
