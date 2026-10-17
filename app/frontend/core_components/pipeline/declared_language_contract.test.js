// @vitest-environment jsdom
// declared_language_contract.test.js
// Reads producer-owned declarations and sends their response keys through the browser.
// Connects Go's tested error/status outputs to real refusal notices and profile copy.
// Detects contract drift without maintaining another key catalogue in the tests.
import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import { resolveFailureNotice } from './api_pipeline_helpers.js';
import { showRequestFailureNotice } from '../error_and_status_handling/request_failure_notice.js';

function declarations(path) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    return source.split('\n').filter(line => line.startsWith('// lang-key-declaration: '))
        .map(line => JSON.parse(line.slice('// lang-key-declaration: '.length)));
}
const producers = [
    '../../../backend/core_components/application_updates/admission_handler.go',
    '../../../backend/core_components/dynamic_table_tools/dtt_triggers/notification_triggers.go',
];

test.each(producers)('declared refusal names reach translated notice elements: %s', producer => {
    vi.useFakeTimers();
    try {
        const contracts = declarations(producer);
        expect(contracts.length).toBeGreaterThan(0);
        for (const contract of contracts) {
            for (const value of contract.values) {
                const key = `${contract.prefix}${value}${contract.suffix || ''}`;
                const notice = resolveFailureNotice(503, JSON.stringify({ error_lang_key: key }));
                expect(notice).toEqual({ langKey: key });
                const shown = showRequestFailureNotice(notice.langKey);
                expect(shown.element.querySelector('[data-lang-key]').dataset.langKey).toBe(key);
                shown.dismiss();
            }
        }
    } finally {
        vi.clearAllTimers(); vi.useRealTimers(); document.body.replaceChildren();
    }
});

const endpoint = vi.hoisted(() => vi.fn());
vi.mock('../endpoints/endpoint_router.js', () => ({ endpoint_router: endpoint }));
vi.mock('../lang/translation_handler.js', () => ({ getTranslationForKey: key => `translated:${key}` }));
import { appendProfileSecurity } from '../user_tools/profile_security_printer.js';

const mailStatuses = declarations('../../../backend/core_components/email/account_email.go')
    .flatMap(contract => contract.values.map(value => `${contract.prefix}${value}`));
test.each(mailStatuses)('declared account-mail status is translated by the browser: %s', async key => {
    document.body.replaceChildren();
    endpoint.mockResolvedValue({ success: true, mail_status: key });
    const root = document.createElement('div'); document.body.append(root);
    appendProfileSecurity(root, vi.fn().mockResolvedValue('test-only'));
    root.querySelector('#new_login_name').value = 'private-canary';
    root.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(document.body.textContent).toContain(`translated:${key}`));
    expect(root.textContent).not.toContain('private-canary');
    document.body.replaceChildren();
});
