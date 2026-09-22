// @vitest-environment jsdom
// table_chat_coding_agent_copy.test.js
// Verifies that each coding-agent mode is named truthfully while a job is waiting and under its answer.
// Covers the site's own keys and the local fallback in Finnish, English, Chinese and Cantonese.
import { expect, test, vi } from 'vitest';

const TRANSLATIONS = vi.hoisted(() => ({
    fi: {
        coding_agent_mode_site_assistant: 'Sivustoavustaja (sivuston oma käännös)',
    },
}));
vi.mock('../../lang/translation_handler.js', () => ({
    getTranslationForKey: (key, { fallback } = {}) => {
        const language = String(document.documentElement.lang || '').toLowerCase();
        return TRANSLATIONS[language]?.[key] || fallback;
    },
}));
import {
    CODING_AGENT_MODES,
    getCodingAgentAnswerFooter,
    getCodingAgentCopy,
    getCodingAgentModeCopy,
    getCodingAgentReasonText,
    isCodingAgentMode,
} from './table_chat_coding_agent_copy.js';

test.each([
    { theme: 'light', language: 'fi', mode: 'code_workspace', label: 'Koodityötila (Codex)',
      waiting: 'Koodityötila voi muokata tämän koneen koodia, ajaa testejä ja käynnistää kehityspalvelimen uudelleen.',
      forbidden: 'sivuston API' },
    { theme: 'dark', language: 'en', mode: 'code_workspace', label: 'Code workspace (Codex)',
      waiting: "Code workspace may edit this machine's code, run tests and restart the development server.",
      forbidden: 'approval' },
    { theme: 'dark', language: 'fi', mode: 'site_assistant', label: 'Sivustoavustaja (sivuston oma käännös)',
      waiting: 'Sivustoavustaja voi tarkistaa sivustoa ja valmistella API-muutoksia hyväksyttäväksesi.',
      forbidden: 'koodia' },
    { theme: 'light', language: 'en', mode: 'site_assistant', label: 'Site assistant (Codex)',
      waiting: 'Site assistant may inspect the site and prepare API changes for your approval.',
      forbidden: "machine's code" },
    { theme: 'light', language: 'ch', mode: 'code_workspace', label: '代码工作区 (Codex)',
      waiting: '代码工作区已开始工作。', forbidden: 'Code workspace' },
    { theme: 'dark', language: 'yue', mode: 'site_assistant', label: '網站助手 (Codex)',
      waiting: '網站助手開始咗工作。', forbidden: 'Site assistant' },
])('names the $mode mode in $language with the $theme theme', ({ theme, language, mode, label, waiting, forbidden }) => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.lang = language;

    const copy = getCodingAgentModeCopy(mode);

    expect(copy.label).toBe(label);
    expect(copy.pendingStatusMessages).toContain(waiting);
    expect(copy.pendingStatusMessages.join(' ')).not.toContain(forbidden);
    expect(getCodingAgentAnswerFooter(mode)).toContain(label);
});

test('rejects an unknown mode instead of guessing its capability', () => {
    expect(CODING_AGENT_MODES).toEqual(['code_workspace', 'site_assistant']);
    expect(isCodingAgentMode('site_assistant')).toBe(true);
    expect(isCodingAgentMode('codex_dev')).toBe(false);
    expect(getCodingAgentModeCopy('isolated_copy')).toBeNull();
    expect(getCodingAgentAnswerFooter('')).toBe('');
});

test.each([
    ['en', 'runner_not_running', './ctl agent start'],
    ['fi', 'runner_not_running', 'ei ole käynnissä'],
    ['en', 'runner_authentication_required', 'codex login'],
    ['en', 'runner_version_mismatch', 'is not ready'],
])('explains reason %s/%s', (language, reason, expected) => {
    document.documentElement.lang = language;
    expect(getCodingAgentReasonText(reason)).toContain(expected);
});

test('every general and mode key has fallback copy in all four languages', () => {
    for (const language of ['fi', 'en', 'ch', 'yue']) {
        document.documentElement.lang = language;
        const text = [...Object.values(getCodingAgentCopy()),
            ...CODING_AGENT_MODES.flatMap(mode => {
                const copy = getCodingAgentModeCopy(mode);
                return [copy.label, ...copy.pendingStatusMessages];
            })];
        for (const value of text) {
            expect(value).not.toMatch(/^(coding_agent|site_assistant)_/);
        }
        if (language !== 'en') {
            document.documentElement.lang = 'en';
            const english = getCodingAgentCopy().failed;
            document.documentElement.lang = language;
            expect(getCodingAgentCopy().failed).not.toBe(english);
        }
    }
});
