// notification_triggers_helpers.test.js
// Covers the pure trigger formatting and payload helpers extracted from notification_triggers.js.
// Keeps the DOM-heavy admin tool file thin while pinning down the request-body rules in isolation.
// Mirrors the flat Vitest helper-test style used elsewhere in frontend/core_components.

import { describe, expect, test } from 'vitest';
import {
    buildTriggerCondition,
    buildTriggerFormData,
    serializeTriggerActionValues,
} from './notification_triggers_helpers.js';

// ---------------------------------------------------------------------------
// buildTriggerCondition
// ---------------------------------------------------------------------------
describe('buildTriggerCondition', () => {
    test('returns an empty string when column or operator is missing', () => {
        expect(buildTriggerCondition('', '=', 'value', 'text')).toBe('');
        expect(buildTriggerCondition('title', '', 'value', 'text')).toBe('');
    });

    test('quotes text values', () => {
        expect(buildTriggerCondition('title', '=', 'hello', 'text')).toBe("title = 'hello'");
    });

    test('leaves numeric values unquoted', () => {
        expect(buildTriggerCondition('age', '>=', 18, 'number')).toBe('age >= 18');
    });

    test('leaves checkbox values unquoted', () => {
        expect(buildTriggerCondition('is_active', '=', true, 'checkbox')).toBe('is_active = true');
    });

    test('falls back to quoted values for unknown input types', () => {
        expect(buildTriggerCondition('note', 'ILIKE', 'abc', 'textarea')).toBe("note ILIKE 'abc'");
    });
});

// ---------------------------------------------------------------------------
// serializeTriggerActionValues
// ---------------------------------------------------------------------------
describe('serializeTriggerActionValues', () => {
    test('adds creation_spec while preserving existing entries', () => {
        const result = serializeTriggerActionValues({
            destination_id: '42',
            status: 'draft',
        });

        expect(JSON.parse(result)).toEqual({
            destination_id: '42',
            status: 'draft',
            creation_spec: 'trigger',
        });
    });

    test('handles missing or non-object input by returning the trigger marker only', () => {
        expect(JSON.parse(serializeTriggerActionValues(null))).toEqual({
            creation_spec: 'trigger',
        });
        expect(JSON.parse(serializeTriggerActionValues('unexpected'))).toEqual({
            creation_spec: 'trigger',
        });
    });
});

// ---------------------------------------------------------------------------
// buildTriggerFormData
// ---------------------------------------------------------------------------
describe('buildTriggerFormData', () => {
    test('combines source table, condition, target table, and serialized action values', () => {
        const result = buildTriggerFormData({
            sourceTable: 'orders',
            column: 'priority',
            operator: '=',
            value: 'high',
            valueType: 'text',
            targetTable: 'audit_log',
            actionValues: {
                event_name: 'priority_changed',
            },
        });

        expect(result).toEqual({
            source_table: 'orders',
            condition: "priority = 'high'",
            target_table: 'audit_log',
            action_values: JSON.stringify({
                event_name: 'priority_changed',
                creation_spec: 'trigger',
            }),
        });
    });

    test('normalizes missing table values to null and preserves checkbox conditions', () => {
        const result = buildTriggerFormData({
            sourceTable: '',
            column: 'is_active',
            operator: '=',
            value: false,
            valueType: 'checkbox',
            targetTable: undefined,
            actionValues: {},
        });

        expect(result.source_table).toBeNull();
        expect(result.target_table).toBeNull();
        expect(result.condition).toBe('is_active = false');
        expect(JSON.parse(result.action_values)).toEqual({
            creation_spec: 'trigger',
        });
    });
});
