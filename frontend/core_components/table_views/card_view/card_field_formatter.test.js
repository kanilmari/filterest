// card_field_formatter.test.js
// Verifies multilingual card editing keeps one active language and preserves sibling translations.
// Bridges the live card field editor DOM with jsdom-driven language selector interactions.
// Exists to lock ticket #20's stacked-checkbox language-selection behavior to explicit regression tests.
// @vitest-environment jsdom

import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { DATE_TIME_DISPLAY_SEPARATOR } from '../timestamp_display_formatter.js';

const {
    endpointRouterMock,
    getLanguageWithBrowserFallbackMock,
} = vi.hoisted(() => ({
    endpointRouterMock: vi.fn(),
    getLanguageWithBrowserFallbackMock: vi.fn(),
}));

vi.mock('../../endpoints/endpoint_router.js', () => ({
    endpoint_router: endpointRouterMock,
}));

vi.mock('../../state_stores/lang_preference_reader.js', () => ({
    getLanguageWithBrowserFallback: getLanguageWithBrowserFallbackMock,
}));

import {
    cancelEditing,
    createKeyValueElement,
    disableEditing,
    enableEditing,
} from './card_field_formatter.js';

function displayDateTime(dateText, timeText) {
    return `${dateText}${DATE_TIME_DISPLAY_SEPARATOR}${timeText}`;
}

function setColumnDetails(columnDetails) {
    localStorage.setItem('full_tree_data', JSON.stringify({ column_details: columnDetails }));
}

function createEditableField(columnName, rawValue) {
    const field = document.createElement('div');
    field.setAttribute('data-column', columnName);
    field.setAttribute('data-raw-value', rawValue);
    field.textContent = rawValue;
    return field;
}

function buildMultilangContainer() {
    const container = document.createElement('div');
    const titleValue = JSON.stringify({ fi: 'Hei', en: 'Hello' });
    const summaryValue = JSON.stringify({ fi: 'Kuvaus', sv: 'Beskrivning' });

    container.appendChild(createEditableField('title', titleValue));
    container.appendChild(createEditableField('summary', summaryValue));

    return container;
}

describe('card_field_formatter multilingual editing', () => {
    const originalTimezone = process.env.TZ;

    beforeAll(() => {
        process.env.TZ = 'Asia/Hong_Kong';
    });

    afterAll(() => {
        if (originalTimezone === undefined) {
            delete process.env.TZ;
        } else {
            process.env.TZ = originalTimezone;
        }
    });

    beforeEach(() => {
        document.body.innerHTML = '';
        localStorage.clear();
        sessionStorage.clear();
        endpointRouterMock.mockReset();
        getLanguageWithBrowserFallbackMock.mockReset();
        getLanguageWithBrowserFallbackMock.mockReturnValue('fi');

        setColumnDetails([
            {
                table_name: 'demo_dataset',
                column_name: 'title',
                editable_in_ui: true,
                data_type: 'text',
                is_multilingual: true,
            },
            {
                table_name: 'demo_dataset',
                column_name: 'summary',
                editable_in_ui: true,
                data_type: 'text',
                is_multilingual: true,
            },
        ]);
    });

    test('renders a stacked checkbox selector and initializes fields to one active language', () => {
        const container = buildMultilangContainer();

        enableEditing(container, 'demo_dataset');

        const selector = container.querySelector('.multilang-selector');
        const selectorHeading = container.querySelector('.multilang-selector__heading');
        const selectorOptions = container.querySelectorAll('.multilang-selector__option');
        const checkboxes = Array.from(selector.querySelectorAll('input[type="checkbox"]'));
        const checkedLanguages = checkboxes.filter((checkbox) => checkbox.checked).map((checkbox) => checkbox.value);
        const titleInput = container.querySelector('[data-column="title"] input');
        const summaryInput = container.querySelector('[data-column="summary"] input');

        expect(selector).not.toBeNull();
        expect(selectorHeading?.textContent).toBe('🌐');
        expect(selectorOptions).toHaveLength(3);
        expect(checkboxes.map((checkbox) => checkbox.value)).toEqual(['en', 'fi', 'sv']);
        expect(checkedLanguages).toEqual(['fi']);
        expect(titleInput?.value).toBe('Hei');
        expect(summaryInput?.value).toBe('Kuvaus');
        expect(container.querySelector('[data-column="title"]')?.getAttribute('data-multilang-edit-lang')).toBe('fi');
        expect(container.querySelector('[data-column="summary"]')?.getAttribute('data-multilang-edit-lang')).toBe('fi');
    });

    test('switches the active language with single-selection checkboxes and preserves other translations on save', () => {
        const container = buildMultilangContainer();

        enableEditing(container, 'demo_dataset');

        const titleField = container.querySelector('[data-column="title"]');
        const titleInput = titleField.querySelector('input');
        titleInput.value = 'Terve';

        const englishCheckbox = container.querySelector('.multilang-selector input[value="en"]');
        englishCheckbox.checked = true;
        englishCheckbox.dispatchEvent(new Event('change', { bubbles: true }));

        const checkedValues = Array.from(container.querySelectorAll('.multilang-selector input[type="checkbox"]'))
            .filter((checkbox) => checkbox.checked)
            .map((checkbox) => checkbox.value);
        const updatedJson = JSON.parse(titleField.getAttribute('data-multilang-json'));

        expect(checkedValues).toEqual(['en']);
        expect(updatedJson).toEqual({ fi: 'Terve', en: 'Hello' });
        expect(titleInput.value).toBe('Hello');
        expect(titleField.getAttribute('data-multilang-edit-lang')).toBe('en');

        titleInput.value = 'Hello updated';

        const updatedValues = disableEditing(container);

        expect(JSON.parse(updatedValues.title)).toEqual({ fi: 'Terve', en: 'Hello updated' });
        expect(updatedValues).not.toHaveProperty('summary');
        expect(container.querySelector('.multilang-selector')).toBeNull();
    });

    test('restores localized read-mode text after save instead of showing the raw multilingual JSON blob', () => {
        getLanguageWithBrowserFallbackMock.mockReturnValue('en');
        const container = buildMultilangContainer();

        enableEditing(container, 'demo_dataset');

        const titleField = container.querySelector('[data-column="title"]');
        const titleInput = titleField.querySelector('input');
        titleInput.value = 'Hello updated';

        const updatedValues = disableEditing(container);

        expect(JSON.parse(updatedValues.title)).toEqual({ fi: 'Hei', en: 'Hello updated' });
        expect(titleField.textContent).toBe('Hello updated');
        expect(titleField.getAttribute('data-raw-value')).toBe(updatedValues.title);

        enableEditing(container, 'demo_dataset');

        expect(titleField.querySelector('input')?.value).toBe('Hello updated');
    });

    test('canceling edit mode discards unsaved multilingual changes and restores the original display', () => {
        const container = buildMultilangContainer();
        const originalTitleValue = JSON.stringify({ fi: 'Hei', en: 'Hello' });

        enableEditing(container, 'demo_dataset');

        const titleField = container.querySelector('[data-column="title"]');
        const titleInput = titleField.querySelector('input');
        titleInput.value = 'Muokattu suomi';

        const englishCheckbox = container.querySelector('.multilang-selector input[value="en"]');
        englishCheckbox.checked = true;
        englishCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
        titleInput.value = 'Changed english';

        cancelEditing(container);

        expect(container.querySelector('.multilang-selector')).toBeNull();
        expect(titleField.textContent).toBe('Hei');
        expect(titleField.getAttribute('data-raw-value')).toBe(originalTitleValue);

        enableEditing(container, 'demo_dataset');

        expect(titleField.querySelector('input')?.value).toBe('Hei');
        expect(titleField.getAttribute('data-multilang-edit-lang')).toBe('fi');
    });

    test('keeps service catalog moderation fields read-only for non-admin actors', () => {
        setColumnDetails([
            {
                table_name: 'app_service_catalog',
                column_name: 'admin_approved',
                editable_in_ui: true,
                data_type: 'boolean',
                is_multilingual: false,
            },
        ]);
        sessionStorage.setItem('user_permissions', JSON.stringify(['/ui/view/table']));

        const container = document.createElement('div');
        container.appendChild(createEditableField('admin_approved', 'false'));

        enableEditing(container, 'app_service_catalog');

        expect(container.querySelector('[data-column="admin_approved"] input')).toBeNull();
        expect(container.querySelector('[data-column="admin_approved"]')?.textContent).toBe('false');
    });

    test('allows non-admin owners to edit their own published flag in service catalog cards', () => {
        setColumnDetails([
            {
                table_name: 'app_service_catalog',
                column_name: 'published',
                editable_in_ui: true,
                data_type: 'boolean',
                is_multilingual: false,
            },
        ]);
        sessionStorage.setItem('user_permissions', JSON.stringify(['/ui/view/table']));

        const container = document.createElement('div');
        container.appendChild(createEditableField('published', 'false'));

        enableEditing(container, 'app_service_catalog');

        expect(container.querySelector('[data-column="published"] input[type="checkbox"]')).not.toBeNull();
    });

    test('allows admins to edit service catalog moderation fields', () => {
        setColumnDetails([
            {
                table_name: 'app_service_catalog',
                column_name: 'admin_approved',
                editable_in_ui: true,
                data_type: 'boolean',
                is_multilingual: false,
            },
        ]);
        sessionStorage.setItem('user_permissions', JSON.stringify(['/ui/admin/service_catalog_moderation']));

        const container = document.createElement('div');
        container.appendChild(createEditableField('admin_approved', 'false'));

        enableEditing(container, 'app_service_catalog');

        expect(container.querySelector('[data-column="admin_approved"] input[type="checkbox"]')).not.toBeNull();
    });

    test('returns only changed fields when saving article-card edits', () => {
        setColumnDetails([
            {
                table_name: 'dev_agent_tasks',
                column_name: 'status',
                editable_in_ui: true,
                data_type: 'text',
                is_multilingual: false,
            },
            {
                table_name: 'dev_agent_tasks',
                column_name: 'title',
                editable_in_ui: true,
                data_type: 'text',
                is_multilingual: false,
            },
        ]);
        const container = document.createElement('div');
        container.appendChild(createEditableField('status', 'in_progress'));
        container.appendChild(createEditableField('title', 'Aborted status acceptance test'));

        enableEditing(container, 'dev_agent_tasks');

        const statusSelect = container.querySelector('[data-column="status"] select');
        const titleInput = container.querySelector('[data-column="title"] input');
        statusSelect.value = 'aborted';

        const updatedValues = disableEditing(container);

        expect(updatedValues).toEqual({ status: 'aborted' });
        expect(titleInput).not.toBeNull();
        expect(container.querySelector('[data-column="title"]')?.textContent)
            .toBe('Aborted status acceptance test');
    });

    test('updates editable ticket status badge tone after saving', () => {
        setColumnDetails([
            {
                table_name: 'dev_agent_tasks',
                column_name: 'status',
                editable_in_ui: true,
                data_type: 'text',
                is_multilingual: false,
            },
        ]);
        const container = document.createElement('div');
        const statusBadge = createEditableField('status', 'in_progress');
        statusBadge.classList.add('ticket_status_badge');
        statusBadge.dataset.statusTone = 'progress';
        statusBadge.title = 'in_progress';
        container.appendChild(statusBadge);

        enableEditing(container, 'dev_agent_tasks');

        const statusSelect = container.querySelector('[data-column="status"] select');
        statusSelect.value = 'aborted';

        const updatedValues = disableEditing(container);

        expect(updatedValues).toEqual({ status: 'aborted' });
        expect(statusBadge.textContent).toBe('aborted');
        expect(statusBadge.dataset.statusTone).toBe('aborted');
        expect(statusBadge.title).toBe('aborted');
    });

    test('renders timestamp key-value fields without visible seconds and with precise hover text', () => {
        const element = createKeyValueElement(
            'Created',
            '2026-06-15T21:36:10',
            'created',
            false,
            'card_value',
            '2026-06-15T21:36:10',
            { data_type: 'timestamp with time zone' },
        );

        const value = element.querySelector('[data-column="created"]');

        expect(value?.textContent).toBe(displayDateTime('2026-06-15', '21:36'));
        expect(value?.title).toBe('2026-06-15 21:36:10');
        expect(value?.getAttribute('data-raw-value')).toBe('2026-06-15T21:36:10');
    });

    test('keeps DATE and naive TIMESTAMP article-card editors stable on no-op save', () => {
        setColumnDetails([
            {
                table_name: 'demo_dataset',
                column_name: 'due_date',
                editable_in_ui: true,
                data_type: 'date',
            },
            {
                table_name: 'demo_dataset',
                column_name: 'scheduled_at',
                editable_in_ui: true,
                data_type: 'timestamp without time zone',
            },
        ]);
        const container = document.createElement('div');
        container.appendChild(createEditableField('due_date', '2026-01-15'));
        container.appendChild(createEditableField('scheduled_at', '2026-06-14 09:30:00'));

        enableEditing(container, 'demo_dataset');

        expect(container.querySelector('[data-column="due_date"] input')?.value).toBe('2026-01-15');
        expect(container.querySelector('[data-column="scheduled_at"] input')?.value).toBe('2026-06-14T09:30');
        expect(disableEditing(container)).toEqual({});
        expect(container.querySelector('[data-column="due_date"]')?.getAttribute('data-raw-value')).toBe('2026-01-15');
        expect(container.querySelector('[data-column="scheduled_at"]')?.getAttribute('data-raw-value'))
            .toBe('2026-06-14 09:30:00');
    });

    test('serializes an explicit article-card TIMESTAMP edit without timezone conversion', () => {
        setColumnDetails([
            {
                table_name: 'demo_dataset',
                column_name: 'scheduled_at',
                editable_in_ui: true,
                data_type: 'timestamp without time zone',
            },
        ]);
        const container = document.createElement('div');
        const field = createEditableField('scheduled_at', '2026-06-14 09:30:00');
        field.title = '2026-06-14 09:30:00';
        container.appendChild(field);

        enableEditing(container, 'demo_dataset');
        const input = container.querySelector('[data-column="scheduled_at"] input');
        input.value = '2026-06-15T14:30';

        expect(disableEditing(container)).toEqual({
            scheduled_at: '2026-06-15 14:30:00',
        });
        expect(field.textContent).toBe(displayDateTime('2026-06-15', '14:30'));
        expect(field.title).toBe('2026-06-15 14:30:00');
    });

    test('keeps TIMESTAMPTZ seconds and raw instant on no-op, then serializes an explicit local edit', () => {
        setColumnDetails([
            {
                table_name: 'demo_dataset',
                column_name: 'published_at',
                editable_in_ui: true,
                data_type: 'timestamp with time zone',
            },
        ]);
        const container = document.createElement('div');
        const field = createEditableField('published_at', '2026-06-14T01:30:45Z');
        container.appendChild(field);

        enableEditing(container, 'demo_dataset');
        expect(field.querySelector('input')?.value).toBe('2026-06-14T09:30');
        expect(disableEditing(container)).toEqual({});
        expect(field.getAttribute('data-raw-value')).toBe('2026-06-14T01:30:45Z');

        enableEditing(container, 'demo_dataset');
        const input = field.querySelector('input');
        input.value = '2026-06-14T10:30';

        expect(disableEditing(container)).toEqual({
            published_at: '2026-06-14T02:30:00.000Z',
        });
    });

    test('treats an invalid temporal card value as a no-op instead of returning the original value as an update', () => {
        setColumnDetails([
            {
                table_name: 'demo_dataset',
                column_name: 'scheduled_at',
                editable_in_ui: true,
                data_type: 'timestamp without time zone',
            },
        ]);
        const container = document.createElement('div');
        const field = createEditableField('scheduled_at', '2026-06-14 09:30:45');
        container.appendChild(field);

        enableEditing(container, 'demo_dataset');
        const input = field.querySelector('input');
        input.value = '';

        expect(disableEditing(container)).toEqual({});
        expect(field.getAttribute('data-raw-value')).toBe('2026-06-14 09:30:45');
    });
});
