// front_page_text_style_renderer.test.js
// Proves literal default DOM, safe story composition and immediate line presence.
// Connects the text renderer to Finnish/English copy and live reduced-motion changes.
// Checks one listener per render and no delayed insertion or inaccessible pending text.
import { afterEach, expect, test, vi } from 'vitest';
import { homeStoryLines, renderHomeHeroText, SERIF_STORY_ACCENT_MAX_CHARS, serifStoryAccentFitsTitle } from './front_page_text_style_renderer.js';
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
    expect(heading.childNodes[1].textContent).toBe(' ');
    expect(hero.querySelector('.front-page-story-lead')).toBeNull();
    expect(hero.querySelector('.front-page-slogan')).toBeNull();
    expect(hero.querySelectorAll('.front-page-story-line--section-start')).toHaveLength(1);
    expect(hero.querySelectorAll('.front-page-story-line--emphasis')).toHaveLength(1);
});

test.each([
    ['at a glance', true], ['a'.repeat(40), true], ['a'.repeat(41), false],
    ['a'.repeat(39) + '🌍', true], ['  ' + 'a'.repeat(40) + '  ', true], ['', false], [' \n\t ', false],
])('title accent eligibility counts trimmed Unicode code points: %j', (accent, expected) => {
    expect(SERIF_STORY_ACCENT_MAX_CHARS).toBe(40);
    expect(serifStoryAccentFitsTitle(accent)).toBe(expected);
});

test.each(['a'.repeat(40), 'a'.repeat(39) + '🌍', '  ' + 'a'.repeat(40) + '  '])(
    'forty code points keep the original title accent DOM: %j', accent => {
        const { hero, heading, title } = fixture({ accent });
        expect(heading.textContent).toBe(`${title} ${accent}`);
        expect(heading.querySelector('em.front-page-title-accent')?.textContent).toBe(accent);
        expect(hero.querySelector('.front-page-story-lead')).toBeNull();
    });

test.each(['a'.repeat(41), '<img src=x onerror=alert(1)>' + '🌍'.repeat(16)])(
    'a long slogan becomes one literal lead before the story: %j', accent => {
        const { hero, heading, description, title } = fixture({ accent });
        expect(heading.textContent).toBe(title);
        expect(heading.querySelector('em')).toBeNull();
        expect(hero.querySelectorAll('.front-page-story-lead')).toHaveLength(1);
        const lead = description.firstElementChild;
        expect(lead.tagName).toBe('P');
        expect(lead.className).toBe('front-page-story-lead');
        expect(lead.textContent).toBe(accent);
        expect(lead.children).toHaveLength(0);
        expect(lead.hasAttribute('style')).toBe(false);
        expect(lead.hasAttribute('hidden')).toBe(false);
        expect([...description.querySelectorAll('.front-page-story-line')]
            .map(line => line.style.getPropertyValue('--line-index'))).toEqual(['0', '1', '2']);
    });

test.each(['', ' \n\t '])('a blank slogan renders neither accent nor lead: %j', accent => {
    const { hero, heading, title } = fixture({ accent });
    expect(heading.textContent).toBe(title);
    expect(hero.querySelector('em, .front-page-story-lead')).toBeNull();
});

test.each([
    ['at a glance', 'yhdellä silmäyksellä'], ['a'.repeat(41), '🌍'.repeat(41)],
    ['at a glance', 'a'.repeat(41)], ['a'.repeat(41), 'yhdellä silmäyksellä'],
])('language rebuilds replace accents and leads without duplicates: %j → %j', (english, finnish) => {
    const options = fixture({ language: 'en', accent: english });
    for (const [language, title, accent] of [['fi', 'Matkatiedot', finnish], ['en', 'Travel', english]]) {
        cleanup();
        Object.assign(options, { language, title, accent });
        cleanup = renderHomeHeroText(options);
        const fits = serifStoryAccentFitsTitle(accent);
        expect(options.hero.querySelectorAll('.front-page-title-accent')).toHaveLength(fits ? 1 : 0);
        expect(options.hero.querySelectorAll('.front-page-story-lead')).toHaveLength(fits ? 0 : 1);
        expect(options.heading.textContent).toBe(fits ? `${title} ${accent}` : title);
    }
});

test('line reveal leaves the lead present and outside the indexed story lines', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    const { hero, description } = fixture({ accent: '🌍'.repeat(41),
        textStyle: { preset: 'serif_story_v1', reveal: { mode: 'lines', start_ms: 3000, interval_ms: 800 } } });
    expect(hero.classList.contains('front-page-hero--reveal-lines')).toBe(true);
    const lead = description.firstElementChild;
    expect(lead.className).toBe('front-page-story-lead');
    expect(lead.style.getPropertyValue('--line-index')).toBe('');
    expect(lead.hasAttribute('hidden')).toBe(false);
    expect(description.querySelector('.front-page-story-line').style.getPropertyValue('--line-index')).toBe('0');
});

test('default keeps long slogans separate and clears a previous Serif lead', () => {
    const options = fixture({ accent: 'a'.repeat(41) });
    cleanup();
    options.textStyle = DEFAULT_HOME_PRESENTATION.text_style;
    cleanup = renderHomeHeroText(options);
    expect(options.heading.textContent).toBe(options.title);
    expect(options.hero.querySelector('em, .front-page-story-lead')).toBeNull();
    expect(options.hero.querySelector('.front-page-slogan')?.textContent).toBe(options.accent);
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
