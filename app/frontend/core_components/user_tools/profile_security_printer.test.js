// profile_security_printer.test.js
// Verifies password-gated name changes, device revocation and translated notices.
// Bridges the existing profile surface with its account mutation payloads.
// Exists to keep private login names out of visible success/error output.
// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest';
const { endpoint, success, info, error } = vi.hoisted(() => ({ endpoint: vi.fn(), success: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock('../endpoints/endpoint_router.js', () => ({ endpoint_router: endpoint }));
vi.mock('../lang/translation_handler.js', () => ({ getTranslationForKey: key => `translated:${key}` }));
vi.mock('../../reusable_components/notifications/toast_notification_printer.js', () => ({ showSuccessToast: success, showInfoToast: info, showErrorToast: error }));
import { appendProfileSecurity, appendPublicProfileFields } from './profile_security_printer.js';
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

beforeEach(() => { vi.clearAllMocks(); document.body.replaceChildren(); });

test('login name is sent only after password confirmation and then cleared', async () => {
    const root = document.createElement('div'); document.body.append(root);
    const password = vi.fn().mockResolvedValue('current-secret');
    endpoint.mockResolvedValue({ success: true, mail_status: 'notice_email_failed' });
    appendProfileSecurity(root, password);
    root.querySelector('#new_login_name').value = 'private-canary';
    root.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(password).toHaveBeenCalledOnce();
    expect(endpoint).toHaveBeenCalledWith('updateUserProfile', { method: 'POST', suppressErrorToast: true, body_data: { login_name: 'private-canary', current_password: 'current-secret' } });
    expect(success).toHaveBeenCalledWith('translated:login_name_changed');
    expect(info).toHaveBeenCalledWith('translated:notice_email_failed');
    expect(root.querySelector('#new_login_name').value).toBe('');
    expect(root.textContent).not.toContain('private-canary');
});

test('other-device sign-out uses the current password and no submitted account id', async () => {
    const root = document.createElement('div'); document.body.append(root);
    const password = vi.fn().mockResolvedValueOnce('').mockResolvedValueOnce('current-secret');
    endpoint.mockResolvedValue({ success: true });
    appendProfileSecurity(root, password);
    root.querySelector('#sign_out_other_devices').click(); await settle();
    expect(endpoint).not.toHaveBeenCalled();
    root.querySelector('#sign_out_other_devices').click(); await settle();
    expect(endpoint).toHaveBeenCalledWith('updateUserProfile', { method: 'POST', suppressErrorToast: true, body_data: { sign_out_other_devices: true, current_password: 'current-secret' } });
    expect(success).toHaveBeenCalledWith('translated:other_devices_signed_out');
});

test('name conflict uses the translated reason and resets the busy state', async () => {
    const root = document.createElement('div'); document.body.append(root);
    appendProfileSecurity(root, vi.fn().mockResolvedValue('current-secret'));
    endpoint.mockRejectedValue({ failureNotice: { langKey: 'error_user_display_name_equals_login_name' } });
    root.querySelector('#new_login_name').value = 'private-canary';
    root.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await settle();
    expect(error).toHaveBeenCalledWith('translated:error_user_display_name_equals_login_name');
    expect(root.querySelector('button').disabled).toBe(false);
});

test('website and biography controls carry language keys and application-owned ids', () => {
    const fields = document.createElement('fieldset');
    const inputs = appendPublicProfileFields(fields);
    expect(Object.keys(inputs)).toEqual(['website', 'bio_social_medias']);
    expect(fields.querySelector('label').dataset.langKey).toBe('website');
    expect(inputs.bio_social_medias.tagName).toBe('TEXTAREA');
    expect(inputs.website.id).toBe('edit_website');
});
