// table_chat_coding_agent_copy.js
// Names the two coding-agent runtimes and their waiting states in Finnish and English.
// Bridges the server's runner kind with the table-chat selector and pending message.
// Exists so repository access is never implied for the API-only site assistant.
import { getTranslationForKey } from '../../lang/translation_handler.js';

const CODING_AGENT_COPY_KEYS = Object.freeze({
    legacy_dev: Object.freeze({
        selectorLabel: Object.freeze([
            'coding_agent_repository_label',
            'Repository agent (Codex)',
        ]),
        pendingStatusMessages: Object.freeze([
            Object.freeze([
                'coding_agent_repository_started',
                'Repository agent started working.',
            ]),
            Object.freeze([
                'coding_agent_repository_context',
                'Codex is reading the chat and repository context.',
            ]),
            Object.freeze([
                'coding_agent_repository_scope',
                'Codex may inspect and edit the configured code repository.',
            ]),
            Object.freeze([
                'coding_agent_repository_working',
                'Repository agent is still working.',
            ]),
            Object.freeze([
                'coding_agent_repository_duration',
                'Long repository jobs may take up to 40 minutes.',
            ]),
        ]),
    }),
    external: Object.freeze({
        selectorLabel: Object.freeze([
            'site_assistant_api_label',
            'Site assistant (site API only)',
        ]),
        pendingStatusMessages: Object.freeze([
            Object.freeze(['site_assistant_started', 'Site assistant started working.']),
            Object.freeze([
                'site_assistant_context',
                'Site assistant is reading the chat and site context.',
            ]),
            Object.freeze([
                'site_assistant_scope',
                'Site assistant may inspect the site and prepare API changes for your approval.',
            ]),
            Object.freeze(['site_assistant_working', 'Site assistant is still working.']),
            Object.freeze([
                'site_assistant_duration',
                'Long site-assistant jobs may take up to 40 minutes.',
            ]),
        ]),
    }),
    unavailable: Object.freeze({
        selectorLabel: Object.freeze([
            'coding_agent_unavailable_label',
            'Coding agent (unavailable)',
        ]),
        pendingStatusMessages: Object.freeze([
            Object.freeze(['coding_agent_unavailable_waiting', 'Coding agent is unavailable.']),
        ]),
    }),
});

function translatedCopy([key, fallback]) {
    return getTranslationForKey(key, { fallback }) || fallback;
}

/** Return whether the server named one of the two supported execution boundaries. */
export function isKnownCodingAgentRunnerKind(runnerKind) {
    return runnerKind === 'legacy_dev' || runnerKind === 'external';
}

/** Resolve runner-specific copy in the two languages supported by this interface. */
export function getCodingAgentRunnerCopy(runnerKind) {
    const runnerKey = isKnownCodingAgentRunnerKind(runnerKind) ? runnerKind : 'unavailable';
    const copyKeys = CODING_AGENT_COPY_KEYS[runnerKey];
    return {
        selectorLabel: translatedCopy(copyKeys.selectorLabel),
        pendingStatusMessages: copyKeys.pendingStatusMessages.map(translatedCopy),
    };
}
