// card_field_label_placement.test.js
// Verifies where a result card puts a field's name, and that the column decides it.
// Bridges the placement rule with the card field element the card renderer builds.
// Exists so a long text field never spends a card line on its own name, a short
// value keeps its name beside it, and a column's own setting still overrules both.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest';

const { endpointRouterMock, getLanguageWithBrowserFallbackMock } = vi.hoisted(() => ({
    endpointRouterMock: vi.fn(),
    getLanguageWithBrowserFallbackMock: vi.fn(() => 'en'),
}));

vi.mock('../../endpoints/endpoint_router.js', () => ({
    endpoint_router: endpointRouterMock,
}));
vi.mock('../../state_stores/lang_preference_reader.js', () => ({
    getLanguageWithBrowserFallback: getLanguageWithBrowserFallbackMock,
}));

import {
    CARD_FIELD_LABEL_PLACEMENTS,
    isLongTextCardField,
    resolveCardFieldLabelPlacement,
} from './card_field_label_placement.js';
import { createKeyValueElement } from './card_field_formatter.js';

/** One card field as the card renderer builds it, with the name already allowed. */
function renderCardField(column, value, columnMeta) {
    return createKeyValueElement(
        'Placeholder label', value, column, false, 'card_value', value, columnMeta,
    );
}

const label = (element) => element.querySelector('.kv_label');
const placement = (element) => element.dataset.cardLabelPlacement;

describe('the rule that places a card field name', () => {
    test('treats the card running-text role as long text, whatever its type', () => {
        expect(isLongTextCardField(['description'], 'character varying')).toBe(true);
        expect(isLongTextCardField(['description2'], 'integer')).toBe(true);
    });

    test('treats every other stated card role as a short value', () => {
        for (const role of ['details', 'details3', 'details_link', 'header', 'keywords']) {
            expect(isLongTextCardField([role], 'text')).toBe(false);
        }
    });

    test('judges a column without a card role by its declared type only', () => {
        expect(isLongTextCardField([], 'text')).toBe(true);
        expect(isLongTextCardField([], 'jsonb')).toBe(true);
        expect(isLongTextCardField([], 'character varying')).toBe(false);
        expect(isLongTextCardField([], 'numeric(10,2)')).toBe(false);
        expect(isLongTextCardField([], 'timestamp with time zone')).toBe(false);
    });

    test('hides the name of a long text field and keeps a short value name inline', () => {
        expect(resolveCardFieldLabelPlacement({
            labelRequested: true, baseRoles: ['description1'], dataType: 'text',
        })).toBe(CARD_FIELD_LABEL_PLACEMENTS.HIDDEN);
        expect(resolveCardFieldLabelPlacement({
            labelRequested: true, baseRoles: ['details'], dataType: 'numeric',
        })).toBe(CARD_FIELD_LABEL_PLACEMENTS.INLINE);
    });

    test('leaves the name out when the column says no name is shown at all', () => {
        expect(resolveCardFieldLabelPlacement({
            labelRequested: false, baseRoles: ['details'], dataType: 'numeric',
        })).toBe(CARD_FIELD_LABEL_PLACEMENTS.HIDDEN);
        expect(resolveCardFieldLabelPlacement({
            labelRequested: false, baseRoles: ['details'], labelValueLayout: 'stacked',
        })).toBe(CARD_FIELD_LABEL_PLACEMENTS.HIDDEN);
    });

    test("the column's own layout setting overrules the rule in both directions", () => {
        expect(resolveCardFieldLabelPlacement({
            labelRequested: true, baseRoles: ['description'], dataType: 'text', labelValueLayout: 'inline',
        })).toBe(CARD_FIELD_LABEL_PLACEMENTS.INLINE);
        expect(resolveCardFieldLabelPlacement({
            labelRequested: true, baseRoles: ['details'], dataType: 'numeric', labelValueLayout: 'stacked',
        })).toBe(CARD_FIELD_LABEL_PLACEMENTS.STACKED);
        // "auto" states no arrangement, so the long-text rule still answers.
        expect(resolveCardFieldLabelPlacement({
            labelRequested: true, baseRoles: ['description'], labelValueLayout: 'auto',
        })).toBe(CARD_FIELD_LABEL_PLACEMENTS.HIDDEN);
    });
});

describe('the card field the renderer builds', () => {
    beforeEach(() => {
        getLanguageWithBrowserFallbackMock.mockReturnValue('en');
    });

    test('leaves out the name of a long text field', () => {
        const element = renderCardField('summary', 'A long summary of this row.', {
            card_element: 'description1', data_type: 'text', label_value_layout: null,
        });

        expect(label(element)).toBeNull();
        expect(placement(element)).toBeUndefined();
        expect(element.querySelector('[data-column="summary"]')?.textContent)
            .toBe('A long summary of this row.');
    });

    test('puts a short value name on the same line, ready for its colon', () => {
        const element = renderCardField('price', '129 €', {
            card_element: 'details', data_type: 'numeric(10,2)', label_value_layout: null,
        });

        expect(placement(element)).toBe('inline');
        expect(label(element)?.dataset.langKey).toBe('price');
        // The colon is styled, never written into the element the translator rewrites.
        expect(label(element)?.textContent).toBe('');
    });

    test("keeps a column's own stacked setting as the exception it is", () => {
        const element = renderCardField('summary', 'A long summary of this row.', {
            card_element: 'description1', data_type: 'text', label_value_layout: 'stacked',
        });

        expect(placement(element)).toBe('stacked');
        expect(label(element)?.dataset.langKey).toBe('summary');
    });

    test('shows no name when the column asked for none', () => {
        const element = createKeyValueElement(
            '', '129 €', 'price', false, 'card_value', '129 €',
            { card_element: 'details', data_type: 'numeric' },
        );

        expect(label(element)).toBeNull();
        expect(placement(element)).toBeUndefined();
    });
});
