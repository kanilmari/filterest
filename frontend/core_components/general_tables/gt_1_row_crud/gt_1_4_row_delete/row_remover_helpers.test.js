import { describe, test, expect } from 'vitest';
import {
    findHeaderColumn,
    buildConfirmationMessage,
    buildDeletePayload,
} from './row_remover_helpers.js';

// ---------------------------------------------------------------------------
// findHeaderColumn
// ---------------------------------------------------------------------------
describe('findHeaderColumn', () => {
    test('finds column with header role', () => {
        const dataTypes = {
            id: { card_element: 'hidden' },
            name: { card_element: 'header+subtitle' },
            email: { card_element: 'body' },
        };
        expect(findHeaderColumn(dataTypes)).toBe('name');
    });

    test('finds column with header as only role', () => {
        const dataTypes = {
            title: { card_element: 'header' },
        };
        expect(findHeaderColumn(dataTypes)).toBe('title');
    });

    test('returns null when no header column exists', () => {
        const dataTypes = {
            id: { card_element: 'hidden' },
            email: { card_element: 'body' },
        };
        expect(findHeaderColumn(dataTypes)).toBeNull();
    });

    test('returns null for null/undefined input', () => {
        expect(findHeaderColumn(null)).toBeNull();
        expect(findHeaderColumn(undefined)).toBeNull();
    });

    test('returns null for empty object', () => {
        expect(findHeaderColumn({})).toBeNull();
    });

    test('handles missing card_element gracefully', () => {
        const dataTypes = { id: {}, name: {} };
        expect(findHeaderColumn(dataTypes)).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// buildConfirmationMessage
// ---------------------------------------------------------------------------
describe('buildConfirmationMessage', () => {
    test('single item with names', () => {
        const result = buildConfirmationMessage(1, true);
        expect(result.messageLangKey).toBe('delete_confirm_single');
        expect(result.messagePlainText).toBe('Haluatko poistaa kohteen:');
    });

    test('single item without names', () => {
        const result = buildConfirmationMessage(1, false);
        expect(result.messageLangKey).toBe('delete_confirm_single');
        expect(result.messagePlainText).toBe('Haluatko poistaa valitun kohteen?');
    });

    test('multiple items with names', () => {
        const result = buildConfirmationMessage(5, true);
        expect(result.messageLangKey).toBe('delete_confirm_multiple');
        expect(result.messagePlainText).toBe('Haluatko poistaa 5 kohdetta:');
    });

    test('multiple items without names', () => {
        const result = buildConfirmationMessage(3, false);
        expect(result.messageLangKey).toBe('delete_confirm_multiple');
        expect(result.messagePlainText).toBe('Haluatko poistaa 3 valittua kohdetta?');
    });

    test('uses epic detachment warning for dev_agent_tasks epic rows', () => {
        const result = buildConfirmationMessage(1, true, {
            tableName: 'dev_agent_tasks',
            selectedRows: [{ issue_type: 'epic' }],
            language: 'fi',
        });

        expect(result.messageLangKey).toBe('');
        expect(result.messagePlainText).toContain('Poistetaanko tämä epic?');
        expect(result.messagePlainText).toContain('Mahdolliset child ticketit jäävät paikalleen');
    });

    test('uses linked child count when big-card delete already knows children exist', () => {
        const result = buildConfirmationMessage(1, false, {
            tableName: 'dev_agent_tasks',
            selectedRows: [{ issue_type: 'task' }],
            linkedChildCount: 2,
            language: 'en',
        });

        expect(result.messagePlainText).toContain('Delete the selected ticket?');
        expect(result.messagePlainText).toContain('2 child tickets will stay in place');
        expect(result.messagePlainText).toContain('parent_id will be cleared automatically');
    });
});

// ---------------------------------------------------------------------------
// buildDeletePayload
// ---------------------------------------------------------------------------
describe('buildDeletePayload', () => {
    test('returns ids payload when IDs available', () => {
        const result = buildDeletePayload([1, 2, 3], []);
        expect(result).toEqual({ ids: [1, 2, 3] });
    });

    test('returns rows payload when no IDs', () => {
        const rows = [{ col1: 'a' }, { col1: 'b' }];
        const result = buildDeletePayload([], rows);
        expect(result).toEqual({ rows });
    });

    test('prefers IDs over rows when both present', () => {
        const result = buildDeletePayload([1], [{ col1: 'a' }]);
        expect(result).toEqual({ ids: [1] });
    });
});
