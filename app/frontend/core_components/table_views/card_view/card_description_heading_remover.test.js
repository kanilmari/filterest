// @vitest-environment jsdom
// card_description_heading_remover.test.js
// Verifies that a result card's short description leaves out the text's own subheadings and nothing else.
// Between the stored field text, the card's own HTML renderer, and the few lines one card has room for.
// Exists so the card stops spending a line on a subheading while every full view, and the stored value the edit form reads, keep the text exactly as it was written.
import { describe, expect, test, vi } from 'vitest';

import { removeHeadingsFromCardDescription } from './card_description_heading_remover.js';
import { renderAllowedHtml } from '../../../reusable_components/dom_container_builder.js';

// The card builder runs with the real field formatter and HTML renderer, so these
// tests see the rendered card text and its data-raw-value; only unrelated
// neighbours are stubbed.
vi.mock('../../endpoints/endpoint_router.js', () => ({ endpoint_router: vi.fn() }));
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

/** The card's short description element, built the way a result card builds it. */
function cardDescription(storedText, entry = {}) {
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
        rawValue: storedText,
        ...entry,
    }], { id: 1 }, 'demo_table', container);
    return container.querySelector('.description_value[data-column="body"]');
}

/** What the card's HTML renderer makes of a text, headings included. */
function renderedWithHeadings(text) {
    const element = document.createElement('div');
    element.appendChild(renderAllowedHtml(text));
    return element;
}

describe('the subheadings a result card leaves out of its short description', () => {
    test.each([1, 2, 3, 4, 5, 6])('an h%i heading goes together with its content', (level) => {
        const storedText = `Intro\n<h${level}>Heading ${level}</h${level}>\nBody`;
        const value = cardDescription(storedText);

        expect(value.innerHTML).toBe('Intro\nBody');
        expect(value.getAttribute('data-raw-value')).toBe(storedText);
    });

    test('a heading goes whatever its tags hold: attributes with ">" or "<", capitals, spaces', () => {
        for (const storedText of [
            '<h2 class="section" data-note="a > b" title="x<y">Opening hours</h2>\nBody',
            "<H3 STYLE='color: red'>Upper case</H3>\nBody",
            '<h4 >Spaced tags</h4 >\nBody',
            '<h2/>Self-closing slash</h2>\nBody',
        ]) {
            expect(cardDescription(storedText).innerHTML).toBe('Body');
        }
    });

    test('inline tags inside a heading go with it', () => {
        expect(cardDescription(
            '<h2><strong>Opening</strong> <em>hours</em> <a href="/hours">today</a><br></h2>Body'
        ).innerHTML).toBe('Body');
    });

    test('several headings go, and the text and other HTML between them stay', () => {
        const value = cardDescription(
            '<h1>Guide</h1>\n<p>First part</p>\n<h2>Next</h2>\nSecond part <b>bold</b>\n<h6>Small print</h6>\nLast part'
        );

        expect(value.innerHTML).toBe('<p>First part</p>Second part <b>bold</b>\nLast part');
    });

    test('a heading written over several lines goes as a whole', () => {
        expect(cardDescription('<h2>Opening\nhours</h2>\r\nBody').innerHTML).toBe('Body');
    });

    test('a text that is nothing but headings leaves the card text empty and the stored text whole', () => {
        const storedText = '<h1>Title</h1>\n\n<h2>Subtitle</h2>';
        const value = cardDescription(storedText);

        expect(value.innerHTML).toBe('');
        expect(value.getAttribute('data-raw-value')).toBe(storedText);
    });

    test('the rest of an HTML text still reads as HTML once its heading is gone', () => {
        expect(cardDescription('<h2>Title</h2>\nTom &amp; Jerry').textContent).toBe('Tom & Jerry');
        expect(cardDescription('<h2>Title</h2><section>Body &amp; more</section>').textContent)
            .toBe('Body & more');
    });

    test('text on both sides of a heading stays on lines of its own', () => {
        expect(cardDescription('Intro<h2>Title</h2>Body').textContent).toBe('Intro\nBody');
        expect(cardDescription('Intro<div><h2>Title</h2></div>Body').textContent).toBe('Intro\nBody');
    });

    test('a heading at the end leaves no empty line after the text', () => {
        expect(cardDescription('Body\n<h2>Closing words</h2>').innerHTML).toBe('Body');
    });

    test('a list item or other element that held nothing but the heading goes with it', () => {
        expect(cardDescription('<ul><li><h3>Only a heading</h3></li><li>Item</li></ul>').innerHTML)
            .toBe('<ul><li>Item</li></ul>');
    });

    test('a formatting element left open inside a heading does not keep the heading', () => {
        expect(cardDescription('<h2><b>Bold title</h2>\nBody').innerHTML).toBe('<b>Body</b>');
    });

    test('a long text loses every heading and keeps every line', () => {
        const parts = Array.from({ length: 2000 }, (_, index) => index);
        const value = cardDescription(parts.map((index) => `<h3>Part ${index}</h3>\nBody ${index}`).join('\n'));

        expect(value.querySelector('h1, h2, h3, h4, h5, h6')).toBeNull();
        expect(value.textContent).toBe(parts.map((index) => `Body ${index}`).join('\n'));
    });
});

describe('what a result card leaves as it is', () => {
    test('tag-like text inside attribute values is no heading, and the text around it stays', () => {
        const storedText = '<p title="<h2>">Keep this</p><p title="</h2>">And this</p>';
        const value = cardDescription(storedText);

        expect(value.innerHTML).toBe('<p>Keep this</p><p>And this</p>');
        expect(value.getAttribute('data-raw-value')).toBe(storedText);
    });

    test('tag-like text inside a comment is no heading', () => {
        expect(cardDescription('Body<!-- <h2>Draft</h2> -->').innerHTML).toBe('Body');
        expect(cardDescription('<!-- <h2>Draft</h2> --><h2>Real</h2>\nBody').innerHTML).toBe('Body');
    });

    test('a heading without an end tag of its own stays, so it never takes the rest of the text with it', () => {
        expect(cardDescription('<h2>Unclosed title\nBody').innerHTML).toBe('<h2>Unclosed title\nBody</h2>');
        expect(cardDescription('<h2>Mismatched levels</h3>\nBody').innerHTML)
            .toBe('<h2>Mismatched levels</h2>\nBody');
        expect(cardDescription('<h2/>\nBody').innerHTML).toBe('<h2>\nBody</h2>');
        expect(cardDescription('Stray closing tag</h2>\nBody').textContent).toBe('Stray closing tag</h2>\nBody');
    });

    test('only the heading its own end tag closes goes; one the next heading cut short stays', () => {
        expect(cardDescription('<h2>Unclosed <h2>Closed</h2>\nBody').innerHTML).toBe('<h2>Unclosed </h2>Body');
        expect(cardDescription('<h2>Outer <h3>inner</h3> title</h2>\nBody').innerHTML)
            .toBe('<h2>Outer </h2> title\nBody');
    });

    test('tags that only look like headings, and the other allowed tags, stay', () => {
        const storedText = '<header>Top</header><hr><h7>Not a heading</h7><h1x>Unknown</h1x><p>Text</p>';

        expect(cardDescription(storedText).innerHTML).toBe(renderedWithHeadings(storedText).innerHTML);
    });

    test('Markdown "#" lines are not headings here and stay on the card as written', () => {
        const storedText = '# Opening hours\n## Weekdays\nMonday to Friday';
        const value = cardDescription(storedText);

        expect(value.textContent).toBe(storedText);
        expect(value.getAttribute('data-raw-value')).toBe(storedText);
    });

    test('a plain text keeps exactly the short form it had before', () => {
        expect(cardDescription('  Indented line\n\nSecond < third &amp; fourth  ').textContent)
            .toBe('  Indented line\nSecond < third &amp; fourth  ');
    });

    test('a language key is handed on untouched, even one that holds heading tags', () => {
        const languageKey = '<h3>legacy</h3>opening_hours';
        const value = cardDescription(languageKey, { hasLangKey: true });

        expect(value.dataset.langKey).toBe(languageKey);
        expect(value.getAttribute('data-raw-value')).toBe(languageKey);
    });

    test('an element that was not rendered from the given text is left as it is', () => {
        const element = renderedWithHeadings('<h2>Title</h2>Body');
        removeHeadingsFromCardDescription(element, '<h2>Title</h2><h2>Other</h2>Body');

        expect(element.innerHTML).toBe('<h2>Title</h2>Body');
    });
});
