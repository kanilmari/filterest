// child_card_formatter.test.js
// Verifies the related-record card formatter against DOM-backed card UI output.
// Bridges the formatter module and jsdom so card_field_formatter imports can touch document safely.
// Exists to keep reverse-FK card rendering covered even though the formatter chain is DOM-aware at import time.
// @vitest-environment jsdom

import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { DATE_TIME_DISPLAY_SEPARATOR } from '../timestamp_display_formatter.js';
import { createRelatedRecordCard, getRelatedRecordDisplayName } from './child_card_formatter.js';

function displayDateTime(dateText, timeText) {
    return `${dateText}${DATE_TIME_DISPLAY_SEPARATOR}${timeText}`;
}

describe('createRelatedRecordCard', () => {
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
        localStorage.clear();
        document.body.innerHTML = '';
    });

    test('renders a compact summary row from metadata-defined header and audit fields', () => {
        const card = createRelatedRecordCard(
            {
                id: 10,
                otsikko: 'Ohjeet ryhmäoikeuden lisäämiseen',
                created: '2026-03-29T10:15:00',
                updated: '2026-03-30T13:45:00',
                content: 'This longer content should stay out of the related list.',
            },
            {
                dataTypes: {
                    otsikko: { card_element: 'header' },
                },
            },
        );

        expect(card.classList.contains('related_pretty_card')).toBe(true);
        expect(card.classList.contains('comment_item')).toBe(true);
        expect(card.classList.contains('child_record_list_item')).toBe(true);

        const cells = [...card.querySelectorAll('.child_record_summary_cell')]
            .map((cell) => cell.textContent);
        expect(cells).toEqual([
            'ID10',
            'NimiOhjeet ryhmäoikeuden lisäämiseen',
            `Luotu${displayDateTime('2026-03-29', '10:15')}`,
            `Muokattu${displayDateTime('2026-03-30', '13:45')}`,
        ]);
        expect(card.dataset.recordId).toBe('10');
        expect(card.querySelector('[data-column="created"] .child_record_summary_value')?.title).toBe('2026-03-29 10:15:00');
        expect(card.querySelector('[data-column="updated"] .child_record_summary_value')?.title).toBe('2026-03-30 13:45:00');

        expect(card.querySelector('.related_record_body')).toBeNull();
        expect(card.textContent).not.toContain('This longer content');
    });

    test('formats missing summary values as dash without guessing a title field', () => {
        const card = createRelatedRecordCard(
            {
                id: 3,
                name: 'Legacy name without metadata',
                created: null,
            },
            { dataTypes: {} },
        );

        expect(card.querySelector('[data-column="id"] .child_record_summary_value')?.textContent).toBe('3');
        expect(card.querySelector('.child_record_summary_cell--title .child_record_summary_value')?.textContent).toBe('—');
        expect(card.querySelector('[data-column="created"] .child_record_summary_value')?.textContent).toBe('—');
    });

    test('uses metadata to distinguish transported naive timestamps from zoned instants', () => {
        const card = createRelatedRecordCard(
            {
                id: 4,
                created: '2026-03-29T10:15:30Z',
                updated: '2026-03-29T11:45:10+00:00',
            },
            {
                dataTypes: {
                    created: { data_type: 'timestamp without time zone' },
                    updated: { data_type: 'timestamp with time zone' },
                },
            },
        );

        const created = card.querySelector('[data-column="created"] .child_record_summary_value');
        const updated = card.querySelector('[data-column="updated"] .child_record_summary_value');

        expect(created?.textContent).toBe(displayDateTime('2026-03-29', '10:15'));
        expect(created?.title).toBe('2026-03-29 10:15:30');
        expect(updated?.textContent).toBe(displayDateTime('2026-03-29', '19:45'));
        expect(updated?.title).toBe('2026-03-29 19:45:10');

        const offsetNaiveCard = createRelatedRecordCard(
            {
                id: 5,
                created: '2026-03-29T10:15:30+02:00',
            },
            {
                dataTypes: {
                    created: { data_type: 'timestamp without time zone' },
                },
            },
        );
        const offsetNaive = offsetNaiveCard.querySelector('[data-column="created"] .child_record_summary_value');
        expect(offsetNaive?.textContent).toBe(displayDateTime('2026-03-29', '10:15'));
        expect(offsetNaive?.title).toBe('2026-03-29 10:15:30');
    });

    test('auto-detects timestamp payloads only when temporal metadata is absent', () => {
        const withoutMetadata = createRelatedRecordCard({
            id: 6,
            created: '2026-03-29T10:15:30Z',
        });
        const explicitTextMetadata = createRelatedRecordCard(
            {
                id: 7,
                created: '2026-03-29T10:15:30Z',
            },
            {
                dataTypes: {
                    created: { data_type: 'text' },
                },
            },
        );

        expect(withoutMetadata.querySelector('[data-column="created"] .child_record_summary_value')?.textContent)
            .toBe(displayDateTime('2026-03-29', '18:15'));
        expect(explicitTextMetadata.querySelector('[data-column="created"] .child_record_summary_value')?.textContent)
            .toBe('2026-03-29T10:15:30Z');
    });

    test('renders related-row actions and wires open/delete handlers', () => {
        const onOpen = vi.fn();
        const onDelete = vi.fn();
        const card = createRelatedRecordCard(
            {
                id: 42,
                aihe: 'Security follow-up',
            },
            {
                dataTypes: {
                    aihe: { card_element: 'summary+header' },
                },
                onOpen,
                onDelete,
            },
        );

        const titleButton = card.querySelector('.related_record_title_button');
        const deleteButton = card.querySelector('.related_record_action--delete');

        expect(titleButton?.textContent).toBe('Security follow-up');
        expect(deleteButton?.textContent).toBe('Poista');

        titleButton?.click();
        deleteButton?.click();

        expect(onOpen).toHaveBeenCalledTimes(1);
        expect(onDelete).toHaveBeenCalledTimes(1);
    });

    test('uses card_element header metadata for display names', () => {
        const row = {
            id: 5,
            kuvaus: 'Core Team',
        };
        const dataTypes = {
            kuvaus: { card_element: 'header' },
        };

        expect(getRelatedRecordDisplayName(row, { dataTypes })).toBe('Core Team');
        expect(getRelatedRecordDisplayName(row)).toBe('');
    });

    test('renders multilingual related-row headers in the active language instead of raw JSON', () => {
        localStorage.setItem('chosen_language', 'yue');
        const multilingualTitle = JSON.stringify({
            fi: 'Vierailijaverkon ohje',
            en: 'Guest network guidance',
            ch: '访客网络指南',
            yue: '訪客網絡指引',
        });
        const row = { id: 9, otsikko: multilingualTitle };
        const dataTypes = {
            otsikko: { card_element: 'header', is_multilingual: true },
        };

        const card = createRelatedRecordCard(row, { dataTypes });
        const title = card.querySelector('.child_record_summary_cell--title .child_record_summary_value');

        expect(title?.textContent).toBe('訪客網絡指引');
        expect(title?.textContent).not.toContain('{');
        expect(getRelatedRecordDisplayName(row, { dataTypes })).toBe('訪客網絡指引');
    });
});
