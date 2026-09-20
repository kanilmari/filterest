// @vitest-environment jsdom
// table_chat_coding_agent_copy.test.js
// Verifies that each coding-agent runtime is named truthfully while a job is waiting.
// Covers Finnish and English under both explicit application themes.
import { expect, test, vi } from 'vitest';

const TRANSLATIONS = vi.hoisted(() => ({
    fi: {
        coding_agent_repository_label: 'Repositorioagentti (Codex)',
        coding_agent_repository_started: 'Repositorioagentti aloitti työn.',
        coding_agent_repository_context: 'Codex lukee keskustelua ja repositorion kontekstia.',
        coding_agent_repository_scope: 'Codex voi tarkistaa ja muokata sille määritettyä koodirepositoriota.',
        coding_agent_repository_working: 'Repositorioagentti työskentelee edelleen.',
        coding_agent_repository_duration: 'Pitkä repositoriotyö voi kestää enintään 40 minuuttia.',
        site_assistant_api_label: 'Sivustoavustaja (vain sivuston API)',
        site_assistant_started: 'Sivustoavustaja aloitti työn.',
        site_assistant_context: 'Sivustoavustaja lukee keskustelua ja sivuston kontekstia.',
        site_assistant_scope: 'Sivustoavustaja voi tarkistaa sivustoa ja valmistella API-muutoksia hyväksyttäväksesi.',
        site_assistant_working: 'Sivustoavustaja työskentelee edelleen.',
        site_assistant_duration: 'Pitkä sivustoavustajan työ voi kestää enintään 40 minuuttia.',
    },
}));
vi.mock('../../lang/translation_handler.js', () => ({
    getTranslationForKey: (key, { fallback } = {}) => {
        const language = String(document.documentElement.lang || '').toLowerCase();
        return TRANSLATIONS[language]?.[key] || fallback;
    },
}));
import {
    getCodingAgentRunnerCopy,
    isKnownCodingAgentRunnerKind,
} from './table_chat_coding_agent_copy.js';

test.each([
    {
        theme: 'light',
        language: 'fi',
        runnerKind: 'legacy_dev',
        selectorLabel: 'Repositorioagentti (Codex)',
        waitingText: 'Codex voi tarkistaa ja muokata sille määritettyä koodirepositoriota.',
        forbiddenText: 'sivuston API',
    },
    {
        theme: 'dark',
        language: 'en',
        runnerKind: 'legacy_dev',
        selectorLabel: 'Repository agent (Codex)',
        waitingText: 'Codex may inspect and edit the configured code repository.',
        forbiddenText: 'site API',
    },
    {
        theme: 'dark',
        language: 'fi',
        runnerKind: 'external',
        selectorLabel: 'Sivustoavustaja (vain sivuston API)',
        waitingText: 'Sivustoavustaja voi tarkistaa sivustoa ja valmistella API-muutoksia hyväksyttäväksesi.',
        forbiddenText: 'koodirepositoriota',
    },
    {
        theme: 'light',
        language: 'en',
        runnerKind: 'external',
        selectorLabel: 'Site assistant (site API only)',
        waitingText: 'Site assistant may inspect the site and prepare API changes for your approval.',
        forbiddenText: 'code repository',
    },
])('names the $runnerKind runtime in $language with the $theme theme', ({
    theme,
    language,
    runnerKind,
    selectorLabel,
    waitingText,
    forbiddenText,
}) => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.lang = language;

    const copy = getCodingAgentRunnerCopy(runnerKind);

    expect(copy.selectorLabel).toBe(selectorLabel);
    expect(copy.pendingStatusMessages).toContain(waitingText);
    expect(copy.pendingStatusMessages.join(' ')).not.toContain(forbiddenText);
});

test('rejects an unknown runner kind instead of guessing its capability', () => {
    expect(isKnownCodingAgentRunnerKind('external')).toBe(true);
    expect(isKnownCodingAgentRunnerKind('legacy_dev')).toBe(true);
    expect(isKnownCodingAgentRunnerKind('future_runner')).toBe(false);
    document.documentElement.lang = 'en';
    expect(getCodingAgentRunnerCopy('future_runner').selectorLabel).toBe(
        'Coding agent (unavailable)'
    );
});
