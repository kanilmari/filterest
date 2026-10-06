// site_label_value_layout_renderers.test.js
// Verifies the site choice reaches cards while article pairs retain their own layout.
// Connects real field builders with shared settings and contradictory stored column metadata.
// Guards hidden names, retained values/links and live previews in both card styles.
// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { renderModernCardDetails } from './card_detail_tile_builder.js';
import { renderSingleLineCardDetails } from './card_detail_single_line_helpers.js';
import { decorateStandardCardDetailKey } from './card_detail_standard_key_decorator.js';
import { createKeyValueElement } from './card_field_formatter.js';
import { createRowArticleKeyValueElement, createRowArticleNavigableElement } from './row_article_ui_handler.js';
import { createKvPairBuilders } from '../../../reusable_components/key_value_container/kv_pair_builder.js';
import { applySiteLabelValueLayoutSetting } from '../../../reusable_components/key_value_container/label_value_layout.js';
import { createExperimentalFreeLayoutCard } from '../experimental_free_layout_card/experimental_free_layout_card_view.js';

vi.mock('../../dev_tools/function_counter.js', () => ({ count_this_function: vi.fn() }));

const builders = createKvPairBuilders({ translate: key => key, decorateKeyElement: decorateStandardCardDetailKey });
const rendererCases = [
    ...[renderModernCardDetails, renderSingleLineCardDetails].map(render => ({
        name: render.name,
        render(host, showLabel, metadata) {
            render(host, [{ column: 'website', label: showLabel ? 'Osoite' : '', rawValue: 'https://example.test/long/path', isLink: true }], { website: metadata });
        },
    })),
    ...Object.entries(builders).map(([name, build]) => ({ name,
        render(host, showLabel, metadata) {
            host.append(build({ key: 'website', labelText: showLabel ? 'Osoite' : '', value: 'https://example.test/long/path', isLink: true, labelMeta: metadata }));
        },
    })),
    { name: 'createKeyValueElement', render(host, showLabel, metadata) {
        host.append(createKeyValueElement(showLabel ? 'Osoite' : '', 'https://example.test/long/path', 'website', false, 'card_value', undefined, metadata));
    } },
];

beforeEach(() => {
    document.head.innerHTML = '<meta name="app-env" content="dev">';
    document.body.replaceChildren();
    localStorage.clear();
    delete document.documentElement.dataset.labelValueLayout;
});

function appendFieldPairStyles() {
    const style = document.createElement('style');
    // The KV import is expanded explicitly to exercise the real application order.
    style.textContent = [
        './cards_big.css',
        './cards.css',
        '../../../reusable_components/key_value_container/label_value_layout.css',
        '../../../reusable_components/key_value_container/kv_container.css',
        './card_field_label_placement.css',
    ].map(path => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/@import[^;]+;/g, '')).join('\n');
    document.head.append(style);
}

test.each(['stacked', 'inline'])('Plain relation links share the two-line preview in %s mode; article links stay full', mode => {
    applySiteLabelValueLayoutSetting(mode);
    appendFieldPairStyles();
    const relation = {
        key: 'riski_id', labelText: 'Riski',
        value: 'Pitkä riskin nimi, jonka koko sisältö näkyy avatussa artikkelissa',
        href: '/riskit/42', openInNewTabHref: '/riskit/42',
        labelMeta: { card_element: 'details', show_key_on_card: true },
    };

    for (const build of Object.values(builders)) {
        const card = document.createElement('div');
        card.className = 'card';
        const details = document.createElement('div');
        details.className = 'card_details_kv kv-display kv-' + (build.name === 'createConditionalElement' ? 'conditional' : build.name === 'createInlineElement' ? 'inline' : 'stacked');
        details.append(build(relation));
        card.append(details);
        document.body.append(card);

        const pair = details.querySelector('.label-value-layout');
        const value = pair.querySelector('.label-value-layout__value');
        const computed = getComputedStyle(value);
        expect(pair.dataset.labelValueLayout).toBe(mode);
        expect(computed.display).toBe('-webkit-box');
        expect(computed.getPropertyValue('-webkit-line-clamp')).toBe('2');
        expect(computed.overflow).toBe('hidden');
        expect(value.textContent).toBe(relation.value);
        const group = value.querySelector('.kv-link-group');
        const [link, openLink] = group.children;
        expect(getComputedStyle(group).display).toBe('inline');
        expect(getComputedStyle(link).display).toBe('inline');
        expect(link.getAttribute('href')).toBe(relation.href);
        link.focus();
        expect(document.activeElement).toBe(link);
        expect(openLink.getAttribute('href')).toBe(relation.openInNewTabHref);
        expect(openLink.target).toBe('_blank');
        expect(openLink.rel).toBe('noopener noreferrer');
        expect(openLink.querySelector('.open-in-new-tab-icon')).not.toBeNull();
        expect(getComputedStyle(openLink).display).toBe('inline-flex');
        expect(getComputedStyle(openLink).marginInlineStart).toBe('0.5rem');
        openLink.focus();
        expect(document.activeElement).toBe(openLink);
    }

    for (const articleClass of ['big_card_content', 'image_first_view_article_content']) {
        const article = document.createElement('article');
        article.className = articleClass;
        const details = document.createElement('div');
        details.className = 'big_card_details_container';
        const pair = createRowArticleNavigableElement({
            label: relation.labelText, column: relation.key, value: relation.value,
            href: relation.href, openInNewTabHref: relation.openInNewTabHref,
        });
        details.append(pair);
        article.append(details);
        document.body.append(article);
        const value = pair.querySelector('.two_line_value');
        const computed = getComputedStyle(value);
        expect(pair.dataset.labelValueLayout).toBeUndefined();
        expect(getComputedStyle(pair).display).toBe('flex');
        expect(getComputedStyle(pair).alignItems).toBe('baseline');
        expect(computed.display).toBe('block');
        expect(computed.getPropertyValue('-webkit-line-clamp')).not.toBe('2');
        expect(computed.overflow).not.toBe('hidden');
        expect(value.textContent).toBe(relation.value);
        expect(value.querySelector('a').getAttribute('href')).toBe(relation.href);
    }
});

describe.each(['big_card_content', 'image_first_view_article_content'])('article layout in %s', articleClass => {
    test.each(['stacked', 'inline', 'auto'])('keeps label and value on one row under %s and a live preview', mode => {
        applySiteLabelValueLayoutSetting(mode);
        appendFieldPairStyles();
        const article = document.createElement('article');
        article.className = articleClass;
        const details = document.createElement('div');
        details.className = 'big_card_details_container';
        article.append(details);
        document.body.append(article);
        const text = 'Pitkä arvo, joka jatkuu omassa sarakkeessaan ja säilyttää\nmyös rivinvaihdon';

        for (const showKey of [true, false]) {
            const labelMeta = { label_value_layout: mode, card_detail_icon_key: 'link' };
            details.append(
                createRowArticleKeyValueElement('Osoite', text, 'website', false,
                    'big_card_detail_value', showKey, null, 'original raw', labelMeta),
                createRowArticleNavigableElement({ label: 'Osoite', value: text, column: 'website',
                    showKey, href: '/example/7', storedRawValue: '7', labelMeta }),
            );
        }
        const originalMarkup = article.outerHTML;
        const assertArticleLayout = () => {
            expect(article.querySelector('.label-value-layout')).toBeNull();
            for (const pair of details.children) {
                const computed = getComputedStyle(pair);
                expect(computed.display).toBe('flex');
                expect(computed.flexDirection).not.toBe('column');
                expect(computed.alignItems).toBe('baseline');
                expect(pair.hasAttribute('data-label-value-layout')).toBe(false);
                const label = pair.querySelector('.two_line_label');
                if (label) expect(getComputedStyle(label).flex).toBe('0 0 14rem');
                else expect(pair.children).toHaveLength(1);
                const value = pair.querySelector('.two_line_value');
                expect(value.textContent).toBe(text);
                expect(getComputedStyle(value).flex).toBe('1 1 auto');
                expect(getComputedStyle(value).overflowWrap).toBe('anywhere');
            }
        };
        assertArticleLayout();
        applySiteLabelValueLayoutSetting(mode === 'stacked' ? 'inline' : 'stacked');
        expect(article.outerHTML).toBe(originalMarkup);
        assertArticleLayout();
    });
});

describe.each(['standard', 'modern'])('site wrapping in %s style', style => {
    describe.each(['stacked', 'inline', 'auto'])('mode %s', mode => {
        test.each(rendererCases)('$name follows the site with visible and hidden names', ({ render }) => {
            applySiteLabelValueLayoutSetting(mode);
            for (const showLabel of [true, false]) {
                const host = document.createElement('div');
                host.className = 'card card_details_kv' + (style === 'modern' ? ' card--modern' : '');
                document.body.append(host);
                const metadata = { card_element: 'details_link', show_key_on_card: showLabel, card_detail_label_mode: 'label', label_value_layout: mode === 'inline' ? 'stacked' : 'inline' };
                render(host, showLabel, metadata);
                const pair = host.querySelector('.label-value-layout');
                expect(pair.dataset.labelValueLayout).toBe(mode);
                expect(Boolean(pair.querySelector('.label-value-layout__label'))).toBe(showLabel);
                // Generic wrappers receive their field name through the translation owner.
                const label = pair.querySelector('.label-value-layout__label');
                if (label?.classList.contains('kv_label')) label.textContent = 'Osoite';
                if (label) expect(label.textContent).toBe('Osoite');
                expect(pair.querySelector('.label-value-layout__value').textContent).toContain('https://example.test/long/path');
                expect(pair.querySelector('.kv-dropped')).toBeNull();
                const link = pair.querySelector('.label-value-layout__value a');
                expect(link.getAttribute('href')).toBe('https://example.test/long/path');
                expect(link.getAttribute('rel')).toBe('noopener noreferrer');
                const nodes = [...pair.children];
                applySiteLabelValueLayoutSetting(mode === 'stacked' ? 'inline' : 'stacked');
                expect([...pair.children]).toEqual(nodes);
                if (label) expect(label.textContent).toBe('Osoite');
                applySiteLabelValueLayoutSetting(mode);
            }
        });
    });
});

test.each(['stacked', 'inline', 'auto'])('experimental ordinary field pairs follow %s without moving canvas geometry', async mode => {
    applySiteLabelValueLayoutSetting(mode);
    localStorage.setItem('chosen_language', 'en');
    localStorage.setItem('demo_experimental_free_layout_card_design_mode', 'true');
    const card = await createExperimentalFreeLayoutCard({
        rowItem: { id: 7, title: 'Example', website: 'https://example.test/long/path', note: 'Hidden name value' },
        columns: ['title', 'website', 'note'], tableName: 'demo',
        dataTypes: {
            title: { card_element: 'header', show_value_on_card: true, show_key_on_card: false },
            website: { card_element: 'details_link', show_value_on_card: true, show_key_on_card: true, label_value_layout: 'stacked' },
            note: { card_element: 'details', show_value_on_card: true, show_key_on_card: false, label_value_layout: 'inline' },
        },
        renderContext: { hasDeleteRight: false, tableHasImageRole: true },
    });
    document.body.append(card);
    const pairs = [...card.querySelectorAll('.label-value-layout')];
    expect(pairs.length).toBeGreaterThanOrEqual(3);
    expect(pairs.every(pair => pair.dataset.labelValueLayout === mode)).toBe(true);
    for (const label of card.querySelectorAll('.experimental-free-layout-card__label')) {
        expect(label.textContent).not.toContain(':');
    }
    const note = pairs.find(pair => pair.textContent === 'Hidden name value');
    expect(note.querySelector('.label-value-layout__label')).toBeNull();
    const blocks = [...card.querySelectorAll('[data-layout-block-id]')];
    const geometry = blocks.map(block => block.style.cssText);
    expect(blocks.every(block => block.querySelector('.experimental-free-layout-card__resize-handle'))).toBe(true);
    applySiteLabelValueLayoutSetting('inline');
    expect(blocks.map(block => block.style.cssText)).toEqual(geometry);
});
