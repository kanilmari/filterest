// @vitest-environment jsdom
// duration_input.test.js
// Verifies shared units, translated labels, stored names and integer validation.
// Connects a portable DOM widget to the same definition used by Go.
// Exists to keep duration controls repairable without silently replacing old values.
import { describe, expect, test } from 'vitest';
import definitions from '../../shared/setting_durations/definitions.json' with { type: 'json' };
import { createDurationInput } from './duration_input.js';

describe('duration input', () => {
    function input(value = { limit_amount: 30, limit_unit: 'days', limit_enabled: true, extra: 'kept' }) {
        return createDurationInput({
            definition: definitions.settings.absolute_sign_in_limit,
            value,
            translate: key => `fi:${key}`,
            inputId: 'duration',
            label: 'Sign-in limit',
        });
    }

    test('renders seven translated units and emits the existing JSON shape', () => {
        const editor = input();
        expect(editor.element.querySelectorAll('option')).toHaveLength(7);
        expect(editor.element.querySelector('option').textContent).toBe('fi:duration_unit_seconds');
        expect(editor.element.querySelector('input[type="checkbox"]').checked).toBe(true);
        expect(editor.getValue()).toEqual({ limit_amount: 30, limit_unit: 'days', limit_enabled: true, extra: 'kept' });
        const number = editor.element.querySelector('input[type="number"]');
        const select = editor.element.querySelector('select');
        number.value = '2';
        select.value = 'months';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        expect(number.max).toBe('120');
        expect(editor.getValue().limit_unit).toBe('months');
        expect(editor.validate()).toBe(true);
    });

    test('refuses fractional, empty, unknown and out-of-range values', () => {
        const editor = input();
        for (const value of ['1.5', '', '-1', '3651']) {
            editor.element.querySelector('input[type="number"]').value = value;
            expect(editor.validate()).toBe(false);
        }
        expect(input({ limit_enabled: true, limit_amount: 2, limit_unit: 'unknown' }).validate()).toBe(false);
        expect(input('{broken').validate()).toBe(false);
    });

    test('supports another field shape without a switch or hardcoded setting key', () => {
        const editor = createDurationInput({
            definition: { amount_field: 'amount', unit_field: 'unit', bounds: { hours: { min: 1, max: 100 } } },
            value: { amount: 10, unit: 'hours' }, translate: key => key, inputId: 'retention', label: 'Retention',
        });
        expect(editor.getValue()).toEqual({ amount: 10, unit: 'hours' });
        expect(editor.element.querySelector('input[type="checkbox"]')).toBeNull();
        expect(editor.validate()).toBe(true);
    });

    test('refreshes translations in place and disabling retains the stored shape', () => {
        let language = 'en';
        const editor = createDurationInput({ definition: definitions.settings.absolute_sign_in_limit,
            value: definitions.settings.absolute_sign_in_limit.default,
            translate: key => `${language}:${key}`, inputId: 'limit', label: 'Limit' });
        language = 'fi';
        editor.updateTranslations();
        expect(editor.element.querySelector('option').textContent).toBe('fi:duration_unit_seconds');
        const checkbox = editor.element.querySelector('input[type="checkbox"]');
        checkbox.checked = false;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        expect(editor.element.querySelector('select').disabled).toBe(true);
        expect(editor.getValue()).toEqual({ limit_amount: 30, limit_unit: 'days', limit_enabled: false });
    });
});
