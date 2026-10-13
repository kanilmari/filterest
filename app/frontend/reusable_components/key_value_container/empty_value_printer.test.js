// empty_value_printer.test.js
// Checks the shared empty-value boundary without a page translation loader.
// Connects null/empty values and real false/zero values to the portable renderer.
// Guards the dash's tooltip and screen-reader copy while leaving real values alone.
// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { printEmptyValue } from './empty_value_printer.js';

test.each([null, undefined, ''])('prints an accessible translated placeholder for %s', value => {
    const element = document.createElement('span');
    expect(printEmptyValue(element, value, () => 'Tuntematon')).toBe(true);
    expect(element.textContent).toBe('—');
    expect(element.title).toBe('Tuntematon');
    expect(element.getAttribute('aria-label')).toBe('Tuntematon');
});
test.each([0, false, '2026-10-12', 'value', ' '])('preserves the existing nonempty boundary for %s', value => {
    const element = document.createElement('span'); element.textContent = 'unchanged';
    expect(printEmptyValue(element, value)).toBe(false);
    expect(element.textContent).toBe('unchanged');
    expect(element.hasAttribute('title')).toBe(false);
});
test('a populated reused field clears only the empty tooltip and accessible label', () => {
    const element = document.createElement('span');
    printEmptyValue(element, '', () => 'Tuntematon');
    expect(printEmptyValue(element, '2026-10-12')).toBe(false);
    expect(element.hasAttribute('title')).toBe(false);
    expect(element.hasAttribute('aria-label')).toBe(false);
    expect(element.dataset.titleLangKey).toBeUndefined();
    expect(element.dataset.ariaLabelLangKey).toBeUndefined();
});
