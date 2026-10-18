// @vitest-environment jsdom
// dom_container_builder.test.js
// Proves rich-text rendering preserves only safe absolute links and allowed children.
// Connects HTML parsing, URL validation and the unchanged plain-text linkifier.
// Guards against scheme obfuscation, attribute injection and duplicate anchors.

import { describe, expect, test } from 'vitest';
import { renderAllowedHtml } from './dom_container_builder.js';
import { linkifyHttpTextNodes } from './http_text_linkifier.js';

function render(html) {
    const container = document.createElement('div');
    container.appendChild(renderAllowedHtml(html));
    return container;
}

describe('rich-text link allow-list', () => {
    test.each([
        'JaVaScRiPt:alert(1)',
        'java\tscript:alert(1)',
        'java\nscript:alert(1)',
        'java\rscript:alert(1)',
        '\x01javascript:alert(1)',
        ' javascript:alert(1)',
        '&#106;avascript:alert(1)',
        '&#x4a;aVaScRiPt&#58;alert(1)',
        'java&#9;script:alert(1)',
        '&#13;&#10; javascript:alert(1)',
        'data:text/html,<script>alert(1)</script>',
        'vbscript:msgbox(1)',
        'file:///tmp/page.html',
        'ftp://example.test/file',
        'story/page',
        '/story/page',
        '//evil.example',
        '/\\evil.example',
        '\\\\evil.example',
        '#fragment',
        'https://',
        '',
    ])('unwraps refused href %j without losing content', href => {
        const container = render(`<a href="${href}">Näkyvä teksti</a>`);
        expect(container.querySelector('a')).toBeNull();
        expect(container.textContent).toBe('Näkyvä teksti');
    });

    test.each([
        'http://example.test/story',
        'https://x/?utm_source=a&utm_medium=b#frag',
        'mailto:reader@example.test?subject=News&body=Hello#part',
        'HtTpS://Example.test/story',
        'MaIlTo:reader@example.test',
    ])('keeps the validated input href exactly: %s', href => {
        const link = render(`<a href="${href}">Lue lisää</a>`).querySelector('a');
        expect(link?.getAttribute('href')).toBe(href);
        expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
        expect(link?.getAttribute('target')).toBe('_blank');
    });

    test('normalizes ASCII tabs/newlines anywhere and C0 controls/spaces at both ends', () => {
        const link = render('<a href="\x01 \thTt\nPs:\r//example.test/?a=1&b=2#frag\x1f ">Linkki</a>')
            .querySelector('a');
        expect(link?.getAttribute('href')).toBe('hTtPs://example.test/?a=1&b=2#frag');
    });

    test('validates entity-decoded schemes and preserves decoded query separators', () => {
        const link = render('<a href="&#72;TTPS&#58;//x/?utm_source=a&amp;utm_medium=b#frag">Linkki</a>')
            .querySelector('a');
        expect(link?.getAttribute('href')).toBe('HTTPS://x/?utm_source=a&utm_medium=b#frag');
    });

    test.each(['href="javascript:alert(1)"', ''])('unwraps %s and keeps nested allowed children', attributes => {
        const children = 'Alku <strong class="source">tärkeä <em>osa</em></strong><br>Loppu';
        const container = render(`<p><a ${attributes}>${children}</a></p>`);
        const outsideLink = render(`<p>${children}</p>`);
        expect(container.querySelector('a')).toBeNull();
        expect(container.isEqualNode(outsideLink)).toBe(true);
        expect(container.querySelector('strong em')?.textContent).toBe('osa');
        expect(container.querySelector('br')).not.toBeNull();
        expect(container.textContent).toBe('Alku tärkeä osaLoppu');
    });

    test('strips every source attribute except a validated anchor href', () => {
        const container = render('<p href="https://wrong.test/" onclick="alert(1)" style="color:red" class="source" id="source">'
            + '<a href="https://x/" target="_self" rel="opener" onclick="alert(1)" style="color:red" class="source" id="link" download ping="https://tracker.test/" data-source="x">'
            + '<strong title="source">Linkki</strong></a></p>');
        const link = container.querySelector('a');
        expect(link?.getAttributeNames().sort()).toEqual(['href', 'rel', 'target']);
        expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
        expect(link?.getAttribute('target')).toBe('_blank');
        expect(container.querySelector('p')?.getAttributeNames()).toEqual([]);
        expect(container.querySelector('strong')?.getAttributeNames()).toEqual([]);
    });

    test('keeps plain URLs linkified and avoids anchors inside kept rich-text links', () => {
        const container = render('<p><a href="https://x/"><strong>https://x/</strong></a>'
            + ' sekä https://plain.test/path <a href="javascript:alert(1)">Vaarallinen</a></p>');
        linkifyHttpTextNodes(container);
        expect(container.querySelectorAll('a')).toHaveLength(2);
        expect(container.querySelector('a a')).toBeNull();
        expect(container.querySelector('a strong')?.textContent).toBe('https://x/');
        expect(container.querySelector('a.auto-http-link')?.getAttribute('href')).toBe('https://plain.test/path');
        expect(container.textContent).toBe('https://x/ sekä https://plain.test/path Vaarallinen');
        for (const link of container.querySelectorAll('a')) {
            expect(link.target).toBe('_blank');
            expect(link.rel).toBe('noopener noreferrer');
        }
    });

    test('HTML parsing and subsequent linkification cannot introduce nested anchors', () => {
        const container = render('<a href="https://outer.test/">Outer <a href="https://inner.test/">https://inner.test/</a> end</a>');
        linkifyHttpTextNodes(container);
        expect(container.querySelectorAll('a')).toHaveLength(2);
        expect(container.querySelector('a a')).toBeNull();
        expect(container.textContent).toBe('Outer https://inner.test/ end');
    });

    test('rich-text and linkified links retain the same native click propagation', () => {
        const container = render('<a href="https://rich.test/"><em>Linkki</em></a> https://plain.test/');
        linkifyHttpTextNodes(container);
        const clicks = [];
        container.addEventListener('click', event => {
            clicks.push(event.defaultPrevented);
            event.preventDefault(); // Avoid navigation in jsdom after observing native behavior.
        });
        for (const target of [container.querySelector('em'), container.querySelector('.auto-http-link')]) {
            target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        }
        expect(clicks).toEqual([false, false]);
    });
});
