// front_page_text_style_renderer.test.js
// Proves literal default DOM, safe story composition and immediate line presence.
// Connects the text renderer to Finnish/English copy and live reduced-motion changes.
// Checks one listener per render and no delayed insertion or inaccessible pending text.
import { afterEach, expect, test, vi } from 'vitest';
import { homeStoryLines, renderHomeHeroText } from './front_page_text_style_renderer.js';
import { DEFAULT_HOME_PRESENTATION } from '../../shared/front_page_presentation/validator.js';

let cleanup = () => {};
afterEach(() => { cleanup(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function fixture(overrides = {}) {
    const hero = document.createElement('header'); hero.className = 'front-page-hero morphing-header';
    const heading = document.createElement('h1'); heading.className = 'morphing-title';
    const slogan = document.createElement('div'); slogan.className = 'front-page-slogan morphing-subtitle';
    const description = document.createElement('div'); description.className = 'front-page-description';
    hero.append(heading, slogan, description); document.body.append(hero);
    const options = { hero, heading, slogan, description, title: 'Matkatiedot ja -edut', accent: 'yhdellä silmäyksellä',
        text: '**Ensimmäinen**\nToinen\n\nKolmas', language: 'fi',
        textStyle: { preset: 'serif_story_v1', reveal: { mode: 'none', start_ms: 3000, interval_ms: 800 } }, ...overrides };
    cleanup = renderHomeHeroText(options);
    return options;
}

test('default title/slogan/description DOM stays byte-identical, including literal markers and newlines', () => {
    const { hero } = fixture({ title: 'Home', accent: 'Slogan\nsecond', text: '**Literal**\nline\n\n<safe>',
        textStyle: DEFAULT_HOME_PRESENTATION.text_style });
    expect(new XMLSerializer().serializeToString(hero)).toMatchInlineSnapshot(`"<header xmlns="http://www.w3.org/1999/xhtml" class="front-page-hero morphing-header"><h1 class="morphing-title">Home</h1><div class="front-page-slogan morphing-subtitle"><p class="home-text-paragraph">Slogan
second</p></div><div class="front-page-description"><p class="home-text-paragraph">**Literal**
line</p><p class="home-text-paragraph">&lt;safe&gt;</p></div></header>"`);
});

test.each([
    ['fi', 'Matkatiedot ja -edut', 'yhdellä silmäyksellä'],
    ['en', 'Travel news and deals', 'at a glance'],
])('composes one safe two-style heading in %s', (language, title, accent) => {
    const { hero, heading } = fixture({ language, title, accent });
    expect(hero.lang).toBe(language);
    expect(heading.textContent).toBe(`${title} ${accent}`);
    expect(heading.querySelector('em')?.textContent).toBe(accent);
    expect(hero.querySelector('.front-page-slogan')).toBeNull();
    expect(hero.querySelectorAll('.front-page-story-line--section-start')).toHaveLength(1);
    expect(hero.querySelectorAll('.front-page-story-line--emphasis')).toHaveLength(1);
});

test('empty slogan omits the accent and markup-like copy is literal', () => {
    const { heading, description } = fixture({ accent: '', text: '**<img src=x onerror=alert(1)>**' });
    expect(heading.querySelector('em')).toBeNull();
    expect(description.querySelector('img')).toBeNull();
    expect(description.textContent).toBe('<img src=x onerror=alert(1)>');
});

test('only whole-line marker pairs are stripped, with whitespace and inner markers preserved', () => {
    expect(homeStoryLines('**x**\n**\na **b** c\n**x\n  ** spaced **  \n**a **b** c**'))
        .toEqual([
            { text: 'x', emphasis: true, sectionStart: false },
            { text: '**', emphasis: false, sectionStart: false },
            { text: 'a **b** c', emphasis: false, sectionStart: false },
            { text: '**x', emphasis: false, sectionStart: false },
            { text: ' spaced ', emphasis: true, sectionStart: false },
            { text: 'a **b** c', emphasis: true, sectionStart: false },
        ]);
});

test('all lines exist at t=0, retain normal flow and cap the delay index at line forty', () => {
    const { description } = fixture({ text: Array.from({ length: 43 }, (_, i) => `Line ${i}`).join('\n') });
    const lines = [...description.children];
    expect(lines).toHaveLength(43);
    expect(lines.map(line => line.style.getPropertyValue('--line-index')))
        .toEqual(Array.from({ length: 43 }, (_, i) => String(Math.min(i, 39))));
    expect(description.querySelector('[hidden], [aria-hidden], [aria-live]')).toBeNull();
    expect(description.hasAttribute('aria-live')).toBe(false);
});

test('reduced motion latches completion, leaving reduce never re-hides and cleanup removes its listener', () => {
    const motion = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    vi.stubGlobal('matchMedia', vi.fn(() => motion));
    const options = fixture({ textStyle: { preset: 'serif_story_v1', reveal: { mode: 'lines', start_ms: 3000, interval_ms: 800 } } });
    expect(window.matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
    const listener = motion.addEventListener.mock.calls[0][1];
    motion.matches = true; listener();
    expect(options.hero.classList.contains('front-page-hero--reveal-complete')).toBe(true);
    motion.matches = false; listener();
    expect(options.hero.classList.contains('front-page-hero--reveal-complete')).toBe(true);
    cleanup();
    expect(motion.removeEventListener).toHaveBeenCalledWith('change', listener);
    motion.matches = true;
    cleanup = renderHomeHeroText(options);
    expect(options.hero.classList.contains('front-page-hero--reveal-complete')).toBe(true);
});
