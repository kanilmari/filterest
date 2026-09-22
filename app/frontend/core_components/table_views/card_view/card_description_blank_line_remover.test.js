// @vitest-environment jsdom
// card_description_blank_line_remover.test.js
// Verifies that a result card's short description loses its blank lines and nothing else.
// Between the stored field text and the few lines one card has room for.
// Exists so the card stops spending a line on a gap while every full view, and the
// stored value the edit form reads, keep the text exactly as it was written.
import { describe, expect, test, vi } from 'vitest';

import { removeBlankLinesFromCardDescription } from './card_description_blank_line_remover.js';

const { createKeyValueElementMock } = vi.hoisted(() => ({
    createKeyValueElementMock: vi.fn(() => {
        const wrapper = document.createElement('div');
        wrapper.classList.add('key_value_wrapper');
        return wrapper;
    }),
}));

vi.mock('./card_field_formatter.js', () => ({
    createKeyValueElement: createKeyValueElementMock,
}));
vi.mock('./card_avatar_builder.js', () => ({
    createImageElement: vi.fn(),
    create_seeded_avatar: vi.fn(),
}));
vi.mock('./row_article_opener.js', () => ({ openRowArticleView: vi.fn() }));
vi.mock('./image_first_view_activation.js', () => ({ bindImageFirstViewActivation: vi.fn() }));
vi.mock('../../dev_tools/function_counter.js', () => ({ count_this_function: vi.fn() }));
vi.mock('../../../ui_config.js', () => ({
    show_more_button_on_cards: false,
    predictCardImageCssWidth: vi.fn(() => 300),
    resolveCardMediaFolderForImageWidth: vi.fn(() => '1000'),
}));
vi.mock('../../../reusable_components/lang_value_reader.js', () => ({
    extractLangValue: vi.fn((value) => String(value ?? '')),
}));
vi.mock('../../../icons/icon_loader.js', () => ({ setElementSvgContent: vi.fn() }));
vi.mock('../../state_stores/lang_preference_reader.js', () => ({
    getLanguageWithBrowserFallback: vi.fn(() => 'en'),
}));

const { addDescriptionSection } = await import('./card_element_builder.js');

describe('a card description without its blank lines', () => {
    test('an empty line after a heading line is left out', () => {
        expect(removeBlankLinesFromCardDescription('Opening hours\n\nMonday to Friday'))
            .toBe('Opening hours\nMonday to Friday');
    });

    test('several blank lines in a row, and lines of only spaces or tabs, all go', () => {
        expect(removeBlankLinesFromCardDescription('First\n\n\n   \n\t\nSecond'))
            .toBe('First\nSecond');
    });

    test('blank lines at the beginning and at the end go too', () => {
        expect(removeBlankLinesFromCardDescription('\n\nOnly paragraph\n\n'))
            .toBe('Only paragraph');
    });

    test('a text that is only blank lines becomes empty', () => {
        expect(removeBlankLinesFromCardDescription('\n \n\t\n\n')).toBe('');
        expect(removeBlankLinesFromCardDescription('\n')).toBe('');
    });

    test('a text without blank lines is returned exactly as it came', () => {
        const unchanged = '  Indented line\nSecond line  ';
        expect(removeBlankLinesFromCardDescription(unchanged)).toBe(unchanged);
        expect(removeBlankLinesFromCardDescription('One single line')).toBe('One single line');
    });

    test('a kept line keeps its own leading and trailing space', () => {
        expect(removeBlankLinesFromCardDescription('  spaced  \n\n  also spaced  '))
            .toBe('  spaced  \n  also spaced  ');
    });

    test('Windows and old Mac line breaks are recognised as line breaks', () => {
        expect(removeBlankLinesFromCardDescription('Title\r\n\r\nBody')).toBe('Title\nBody');
        expect(removeBlankLinesFromCardDescription('Title\r\rBody')).toBe('Title\nBody');
    });

    test('no text at all is an empty short description, not the word undefined', () => {
        expect(removeBlankLinesFromCardDescription(null)).toBe('');
        expect(removeBlankLinesFromCardDescription(undefined)).toBe('');
        expect(removeBlankLinesFromCardDescription('')).toBe('');
    });
});

// The card must show the shortened text while the element still carries the
// stored text, because the article view and the edit form read that value.
describe('the description a result card builds', () => {
    function buildDescription(entry) {
        createKeyValueElementMock.mockClear();
        document.body.replaceChildren();
        const card = document.createElement('div');
        card.classList.add('card');
        const container = document.createElement('div');
        card.appendChild(container);
        document.body.appendChild(card);
        addDescriptionSection([{
            suffix_number: 1,
            label: '',
            column: 'body',
            columnClass: 'demo_table_body',
            columnMeta: {},
            hasLangKey: false,
            ...entry,
        }], { id: 1 }, 'demo_table', container);
        return createKeyValueElementMock.mock.calls[0];
    }

    test('shows the text without blank lines but hands on the stored text unchanged', () => {
        const storedText = 'Opening hours\n\nMonday to Friday';
        const [, rawValueArgument, , , cssClass, displayValueArgument] = buildDescription({
            rawValue: storedText,
        });

        expect(cssClass).toBe('description_value');
        expect(displayValueArgument).toBe('Opening hours\nMonday to Friday');
        expect(rawValueArgument).toBe(storedText);
    });

    test('a language-key description is passed through untouched, because it names a translation', () => {
        const [, rawValueArgument, , hasLangKey, , displayValueArgument] = buildDescription({
            rawValue: 'opening_hours_key',
            hasLangKey: true,
        });

        expect(hasLangKey).toBe(true);
        expect(displayValueArgument).toBe('opening_hours_key');
        expect(rawValueArgument).toBe('opening_hours_key');
    });
});
