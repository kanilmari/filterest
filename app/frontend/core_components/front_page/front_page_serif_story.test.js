// front_page_serif_story.test.js
// Exercises shipped typography against the universal reset and later shared heading CSS.
// Connects computed desktop styles with CSS media/reveal rules jsdom cannot lay out.
// Guards both explicit themes and reserved CSS ownership without relying on class names alone.
import { readFileSync } from 'node:fs';
import { afterEach, expect, test } from 'vitest';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = read('./front_page_serif_story.css');
const styles = read('../../styles/base.css') + read('./front_page.css') + css
    + read('../filterbar/morphing_filterbar_content.css');
afterEach(() => { document.body.replaceChildren(); document.body.className = ''; document.head.querySelector('[data-story-test]')?.remove(); });

test.each(['light', 'dark'])('computed text styles defeat the element reset in the explicit %s theme', theme => {
    const style = document.createElement('style'); style.dataset.storyTest = 'true'; style.textContent = styles;
    document.head.append(style); document.body.className = `${theme}-mode`;
    const hero = document.createElement('header'); hero.className = 'front-page-hero front-page-hero--serif-story-v1';
    const heading = document.createElement('h1'); heading.className = 'morphing-title'; heading.textContent = 'Title ';
    const accent = document.createElement('em'); accent.className = 'front-page-title-accent'; accent.textContent = 'accent';
    heading.append(accent); hero.append(heading);
    for (const emphasis of [false, true]) {
        const line = document.createElement('p'); line.className = 'front-page-story-line';
        if (emphasis) line.classList.add('front-page-story-line--emphasis');
        line.textContent = 'Story'; hero.append(line);
    }
    document.body.append(hero);
    const elements = [heading, accent, ...hero.querySelectorAll('p')];
    const computed = elements.map(element => getComputedStyle(element));
    for (const index of [0, 1]) {
        expect(computed[index].fontFamily).toBe('Georgia, "Times New Roman", serif');
        expect(computed[index].fontWeight).toBe('400');
        expect(computed[index].letterSpacing).toBe('-0.06em');
    }
    for (const index of [2, 3]) {
        expect(computed[index].fontFamily).toContain('ui-sans-serif, system-ui');
        expect(computed[index].fontWeight).toBe(index === 2 ? '570' : '700');
        expect(computed[index].letterSpacing).toBe('-0.007em');
    }
    // jsdom retains var() in computed colours; verify both the winning declaration and theme values.
    expect(computed.map(value => value.color)).toEqual(['var(--home-story-text)', 'var(--home-story-accent)',
        'var(--home-story-soft)', 'var(--home-story-text)']);
    const palette = getComputedStyle(hero);
    expect(palette.getPropertyValue('--home-story-text').trim()).toBe(theme === 'dark' ? '#fffdf5' : '#182226');
    expect(palette.getPropertyValue('--home-story-accent').trim()).toBe(theme === 'dark' ? '#efae55' : '#a95620');
    expect(palette.getPropertyValue('--home-story-soft').trim()).toBe(theme === 'dark' ? 'rgb(255 253 245/88%)' : 'rgb(24 34 38/86%)');
    expect(computed[1].fontStyle).toBe('italic');
    for (const index of [0, 1]) {
        expect(computed[index].whiteSpace).toBe('nowrap'); expect(computed[index].overflowWrap).toBe('normal');
    }
    for (const index of [2, 3]) {
        expect(computed[index].whiteSpace).toBe('normal'); expect(computed[index].overflowWrap).toBe('break-word');
    }
});

test('responsive language sizes and normal-flow animation stay scoped to the preset', () => {
    expect(css).toMatch(/@media \(width <= 1180px\)[\s\S]*font-size: 4.7vw/);
    const phone = css.split('@media (width <= 760px)')[1].split('@keyframes')[0];
    expect(phone).toContain('clamp(30px, 9vw, 54px)'); expect(phone).toContain('clamp(29px, 8.4vw, 50px)');
    expect(phone.match(/white-space: normal/g)).toHaveLength(1);
    expect(phone.match(/overflow-wrap: break-word/g)).toHaveLength(1);
    expect(css).toContain('animation-fill-mode: both');
    expect(css).toContain('calc(var(--home-reveal-start) + var(--line-index) * var(--home-reveal-interval))');
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\)[\s\S]*:not\(\.front-page-hero--reveal-complete\)/);
    expect(css).not.toMatch(/prefers-color-scheme|display: none|position: absolute|(?<!line-)height:/);
});
