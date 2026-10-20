// front_page_text_style_renderer.js
// Composes the opt-in serif heading and safely authored story lines.
// Connects Home's language/palette render to bundled CSS and motion preferences.
// Keeps all copy in normal flow from the first render and owns one removable listener.
import { renderHomeDescription } from './front_page_presentation_renderer.js';

const LAST_REVEAL_INDEX = 39;
export const SERIF_STORY_ACCENT_MAX_CHARS = 40;

/** Keep only short slogans in the title; count Unicode code points after trimming. */
export function serifStoryAccentFitsTitle(accent) {
    const length = Array.from(accent.trim()).length;
    return length > 0 && length <= SERIF_STORY_ACCENT_MAX_CHARS;
}

/** Only whole-line markers have meaning; every other asterisk remains literal text. */
export function homeStoryLines(text) {
    const lines = [];
    let sectionStart = false;
    for (const authored of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
        const trimmed = authored.trim();
        if (!trimmed) { sectionStart = lines.length > 0; continue; }
        const emphasis = trimmed.length > 4 && trimmed.startsWith('**') && trimmed.endsWith('**');
        lines.push({ text: emphasis ? trimmed.slice(2, -2) : authored, emphasis, sectionStart });
        sectionStart = false;
    }
    return lines;
}

/** Rebuild once per language/preview/save/reset. The caller releases the previous listener first. */
export function renderHomeHeroText({ hero, heading, slogan, description, title, accent, text, language, textStyle }) {
    const serif = textStyle.preset === 'serif_story_v1';
    hero.classList.toggle('front-page-hero--serif-story-v1', serif);
    hero.classList.remove('front-page-hero--reveal-lines', 'front-page-hero--reveal-complete');
    heading.textContent = title;
    if (!serif) {
        hero.removeAttribute('lang');
        hero.style.removeProperty('--home-reveal-start');
        hero.style.removeProperty('--home-reveal-interval');
        if (!slogan.isConnected || slogan.parentElement !== hero) hero.insertBefore(slogan, description);
        renderHomeDescription(slogan, accent);
        renderHomeDescription(description, text);
        return () => {};
    }
    hero.lang = language;
    slogan.remove();
    const accentFitsTitle = serifStoryAccentFitsTitle(accent);
    if (accentFitsTitle) {
        const emphasis = document.createElement('em');
        emphasis.className = 'front-page-title-accent';
        emphasis.textContent = accent;
        heading.append(document.createTextNode(' '), emphasis);
    }
    description.removeAttribute('hidden');
    description.replaceChildren();
    if (!accentFitsTitle && accent.trim()) {
        const lead = document.createElement('p');
        lead.className = 'front-page-story-lead';
        lead.textContent = accent;
        description.append(lead);
    }
    homeStoryLines(text).forEach((item, index) => {
        const line = document.createElement('p');
        line.className = 'front-page-story-line';
        line.classList.toggle('front-page-story-line--emphasis', item.emphasis);
        line.classList.toggle('front-page-story-line--section-start', item.sectionStart);
        line.style.setProperty('--line-index', String(Math.min(index, LAST_REVEAL_INDEX)));
        line.textContent = item.text;
        description.append(line);
    });
    if (textStyle.reveal.mode !== 'lines') return () => {};
    hero.style.setProperty('--home-reveal-start', `${textStyle.reveal.start_ms}ms`);
    hero.style.setProperty('--home-reveal-interval', `${textStyle.reveal.interval_ms}ms`);
    hero.classList.add('front-page-hero--reveal-lines');
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const complete = () => {
        if (motion.matches) hero.classList.add('front-page-hero--reveal-complete');
    };
    complete();
    motion.addEventListener('change', complete);
    return () => motion.removeEventListener('change', complete);
}
