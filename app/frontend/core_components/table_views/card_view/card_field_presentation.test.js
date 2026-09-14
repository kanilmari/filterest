// @vitest-environment jsdom
// Verifies localized emptiness and field-only updates without retaining detached cards.
// Bridges shared locale semantics and actual before-DOM selection with stable card identity.
// Preserves explicit values, article summaries and caller-owned field cleanup.
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { extractLangValue } from '../../../reusable_components/lang_value_reader.js';
import { applyCardFieldPresentationSetting, isEmptyCardFieldValue, mountCardFieldGroup, selectCardFieldEntries } from './card_field_presentation.js';

beforeEach(() => {
    document.body.replaceChildren();
    delete document.documentElement.dataset.cardShowAllFields;
    delete document.documentElement.dataset.cardStyleVariant;
    delete document.documentElement.dataset.cardDetailColumns;
});

describe('card field presentation', () => {
    test('dataset column overrides win over site defaults and project the effective layout on the actual card', () => {
        const list = document.createElement('div'); list.className = 'card_container'; document.body.append(list);
        const card = document.createElement('div'); card.className = 'card';
        card.dataset.cardColumnsOverride = '1'; card.dataset.datasetName = 'ordinary_dataset';
        list.append(card);
        const render = vi.fn();
        mountCardFieldGroup(card, card, 'card', render);
        applyCardFieldPresentationSetting(true, 'modern', 4);
        expect(render.mock.calls.at(-1)[3]).toBe(1);
        expect(card.dataset.cardDetailColumns).toBe('1');
        expect(list.dataset.cardDetailColumns).toBe('1');
    });
    test('absent dataset override inherits the changed site count without changing article context', () => {
        const card = document.createElement('div'); card.className = 'card'; document.body.append(card);
        const render = vi.fn(); mountCardFieldGroup(card, card, 'card', render);
        applyCardFieldPresentationSetting(true, 'modern', 3);
        expect(card.dataset.cardDetailColumns).toBe('3');
        expect(render.mock.calls.at(-1)[3]).toBe(3);
    });
    test('updates column count in both card styles and keeps connected outer nodes and legacy summaries', () => {
        const makeCard = (style, view = 'card') => {
            const card = document.createElement('div'); card.className = 'card';
            card.dataset.cardStyleOverride = style; card.dataset.cardStyleVariant = style;
            const media = document.createElement('img'); card.append(media); document.body.append(card);
            const cleanup = vi.fn();
            const render = vi.fn((parent, _showAll, _style, columns) => {
                const span = document.createElement('span'); span.textContent = String(columns); parent.append(span);
                return cleanup;
            });
            mountCardFieldGroup(card, card, view, render);
            return { card, media, render, cleanup };
        };
        const glowy = makeCard('modern'), plain = makeCard('standard'), article = makeCard('modern', 'article_view');
        expect(glowy.render.mock.calls[0][3]).toBe(2);
        applyCardFieldPresentationSetting(true, 'modern', 4);
        expect(glowy.render.mock.calls.at(-1)[3]).toBe(4);
        expect(glowy.cleanup).toHaveBeenCalledTimes(1);
        expect(glowy.card.firstChild).toBe(glowy.media);
        expect(plain.render).toHaveBeenCalledTimes(2);
        expect(plain.render.mock.calls.at(-1)[3]).toBe(4);
        expect(plain.card.firstChild).toBe(plain.media);
        expect(article.render).toHaveBeenCalledTimes(1);
        applyCardFieldPresentationSetting(true, 'modern', 4);
        expect(glowy.render).toHaveBeenCalledTimes(2);
    });
    test('resolves inherited styles without replacing cards, media, selection or article groups', () => {
        const makeCard = (override, viewKey = 'card') => {
            const card = document.createElement('div'); card.className = 'card';
            card.style.display = 'none';
            if (override) card.dataset.cardStyleOverride = override;
            card.dataset.cardStyleVariant = 'standard';
            const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = true;
            const image = document.createElement('img'); card.append(checkbox, image);
            const render = vi.fn((parent, showAll, style) => {
                const field = document.createElement('span'); field.textContent = `${style}:${showAll}`; parent.append(field);
            });
            mountCardFieldGroup(card, card, viewKey, render); document.body.append(card);
            return { card, checkbox, image, render };
        };
        const inherited = makeCard(null), explicit = makeCard('standard'), article = makeCard(null, 'article_view');
        expect(inherited.card.dataset.cardStyleVariant).toBe('modern');
        expect(explicit.card.classList.contains('card--modern')).toBe(false);
        applyCardFieldPresentationSetting(false, 'standard');
        expect(inherited.card.querySelector('span').textContent).toBe('standard:false');
        expect(inherited.card.firstChild).toBe(inherited.checkbox);
        expect(inherited.checkbox.checked).toBe(true); expect(inherited.card.contains(inherited.image)).toBe(true);
        expect(article.render).toHaveBeenCalledTimes(1);
        applyCardFieldPresentationSetting(false, 'modern');
        expect(inherited.card.querySelector('span').textContent).toBe('modern:false');
        expect(inherited.card.classList.contains('card--modern')).toBe(true);
        expect(explicit.render).toHaveBeenCalledTimes(2); // Only its field-visibility changed.
        const detached = makeCard(null); detached.card.remove();
        applyCardFieldPresentationSetting(true, 'standard');
        document.body.append(detached.card);
        detached.card._refreshFieldPresentation.forEach(refresh => refresh());
        expect(detached.card.querySelector('span').textContent).toBe('standard:true');
    });
    test.each([
        [null, false, true], [undefined, false, true], ['', false, true], ['   ', false, true],
        [0, false, false], [false, false, false], ['N/A', false, false], ['—', false, false],
        ['-', false, false], ['{}', true, true], ['{}', false, false], ['{invalid}', true, false],
    ])('classifies %j with multilingual=%s as empty=%s', (value, multilingual, empty) => {
        expect(isEmptyCardFieldValue(value, multilingual)).toBe(empty);
    });
    test('uses the current locale fallback without hiding ordinary JSON or a relation id', () => {
        const value = { fi: '', en: 'Value' };
        expect(isEmptyCardFieldValue(extractLangValue(value, 'fi', true), true)).toBe(true);
        expect(isEmptyCardFieldValue(extractLangValue(value, 'en', true), true)).toBe(false);
        expect(isEmptyCardFieldValue(extractLangValue({ en: 'Value' }, 'fi', true), true)).toBe(false);
        const entries = [{ column: 'empty', rawValue: '{}', isMultilingual: true },
            { column: 'object', rawValue: '{}', isMultilingual: false },
            { column: 'fk', rawValue: '7', isLink: true, isMultilingual: true }];
        expect(selectCardFieldEntries(entries, false).map(entry => entry.column)).toEqual(['object', 'fk']);
        expect(selectCardFieldEntries(entries, true)).toEqual(entries);
        expect(entries).toHaveLength(3);
    });
    test('rebuilds only field nodes of connected cards and cleans up the previous renderer', () => {
        const host = document.createElement('div');
        host.style.display = 'none'; // A retained history surface remains in the document.
        const card = document.createElement('div'); card.className = 'card';
        const selected = document.createElement('input'); selected.type = 'checkbox'; selected.checked = true;
        const media = document.createElement('img');
        card.append(selected, media); host.append(card); document.body.append(host);
        const cleanup = vi.fn();
        const renderer = vi.fn((parent, showAll) => {
            const entries = selectCardFieldEntries([{ rawValue: '', column: 'empty' }, { rawValue: 0, column: 'zero' }], showAll);
            entries.forEach(entry => { const node=document.createElement('span'); node.dataset.column=entry.column; parent.append(node); });
            return cleanup;
        });
        mountCardFieldGroup(card, card, 'card', renderer);
        const footer=document.createElement('footer'); card.append(footer);
        const article=document.createElement('div'); article.className='card'; document.body.append(article);
        const articleRender=vi.fn(parent => parent.appendChild(document.createElement('span')) && undefined);
        mountCardFieldGroup(article, article, 'article_view', articleRender);
        applyCardFieldPresentationSetting(false);
        expect(card.querySelector('[data-column="empty"]')).toBeNull();
        expect(card.querySelector('[data-column="zero"]')).not.toBeNull();
        expect(card.firstChild).toBe(selected); expect(selected.checked).toBe(true);
        expect(card.contains(media)).toBe(true); expect(card.lastChild).toBe(footer);
        expect(cleanup).toHaveBeenCalledTimes(1); expect(articleRender).toHaveBeenCalledTimes(1);
        applyCardFieldPresentationSetting(false);
        expect(renderer).toHaveBeenCalledTimes(2);
        applyCardFieldPresentationSetting(true);
        expect(card.querySelector('[data-column="empty"]')).not.toBeNull();
        host.remove(); applyCardFieldPresentationSetting(false);
        expect(renderer).toHaveBeenCalledTimes(3);
    });
});
