// asset_linking_view.test.js
// Exercises the T10 capability lifecycle without a browser or live database.
// Connects rendered row actions to a stateful endpoint double and status reads.
// Keeps server-confirmed status and failure handling covered independently of E2E timing.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { endpoint, confirm, success } = vi.hoisted(() => ({
    endpoint: vi.fn(), confirm: vi.fn(), success: vi.fn(),
}));

vi.mock('../../endpoints/endpoint_router.js', () => ({ endpoint_router: endpoint }));
vi.mock('../../../reusable_components/modal/modal_builder.js', () => ({
    createModal: vi.fn(), hideModal: vi.fn(), showModal: vi.fn(),
}));
vi.mock('../../../reusable_components/modal/confirm_modal_builder.js', () => ({ showConfirmModal: confirm }));
vi.mock('../../../reusable_components/notifications/toast_notification_printer.js', () => ({
    showSuccessToast: success, showWarningToast: vi.fn(),
}));
vi.mock('../../../reusable_components/vanilla_dropdown/vanilla_dropdown_builder.js', () => ({ createVanillaDropdown: vi.fn() }));
vi.mock('../../lang/translation_handler.js', () => ({ getTranslationForKey: key => `translated:${key}` }));

import { generate_asset_linking_view } from './asset_linking_view.js';

let container;
let server;

function row(profile, name) {
    return container.querySelector(`[data-testid="asset-linking-${profile}-${name}-articles"]`);
}

async function settleActions() {
    // Drain the endpoint, confirmation and sequential section-render promises.
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

async function click(profile, action) {
    row(profile, action).click();
    await settleActions();
}

function expectStatus(profile, enabled) {
    expect(row(profile, 'status').dataset.state).toBe(enabled ? 'enabled' : 'disabled');
    expect(row(profile, 'toggle').textContent).toBe(`translated:${enabled ? 'disable' : 'enable'}`);
}

beforeEach(() => {
    vi.clearAllMocks();
    server = { image: true, attachment: true };
    container = document.createElement('div');
    document.body.replaceChildren(container);
    confirm.mockResolvedValue(true);
    endpoint.mockImplementation(async (route, options) => {
        const profile = route.includes('Attachment') || route.startsWith('attachment') ? 'attachment' : 'image';
        if (route.endsWith('Status')) {
            return { asset_linkings: server[profile] === null ? [] : [{
                parent_table: 'articles', child_table: 'articles_assets',
                enabled: server[profile], max_file_size_mb: profile === 'image' ? 10 : 25,
            }] };
        }
        expect(options.method).toBe('POST');
        expect(options.body_data.parent_table).toBe('articles');
        if (route.startsWith('disable')) server[profile] = false;
        else if (route.startsWith('remove')) {
            expect(options.body_data.confirm).toBe(true);
            server[profile] = null;
        } else if (route === 'updateImageAssetLinking') server.image = options.body_data.enabled;
        else if (route === 'enableAttachmentAssetLinking') server.attachment = true;
        else throw new Error(`Unexpected route: ${route}`);
        return {};
    });
});

afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
});

describe('asset linking server-confirmed state', () => {
    test('reenables images after the complete T10 attachment removal sequence', async () => {
        await generate_asset_linking_view(container);
        expectStatus('image', true);
        expectStatus('attachment', true);
        await click('image', 'toggle');
        expectStatus('image', false);
        await click('image', 'toggle');
        expectStatus('image', true);
        await click('attachment', 'toggle');
        expectStatus('attachment', false);
        await click('attachment', 'toggle');
        expectStatus('attachment', true);
        await click('attachment', 'remove');
        expect(row('attachment', 'row')).toBeNull();
        expectStatus('image', true);
        await click('image', 'toggle');
        expectStatus('image', false);
        await click('image', 'toggle');
        expectStatus('image', true);
        expect(server).toEqual({ image: true, attachment: null });
        expect(container.querySelectorAll('[data-testid="asset-linking-image-row-articles"]')).toHaveLength(1);
        await click('image', 'remove');
        expect(row('image', 'row')).toBeNull();
    });

    test('uses fresh server status rather than assuming a successful toggle enabled images', async () => {
        server.image = false;
        server.attachment = null;
        await generate_asset_linking_view(container);
        endpoint.mockResolvedValueOnce({ updated_specs: { file_upload: { enabled: true } } });
        await click('image', 'toggle');
        expectStatus('image', false);
        expect(endpoint.mock.calls.slice(-2).map(([route]) => route)).toEqual([
            'imageAssetLinkingStatus', 'attachmentAssetLinkingStatus',
        ]);
    });

    test('keeps the disabled image row when the reenable request fails', async () => {
        server.image = false;
        server.attachment = null;
        await generate_asset_linking_view(container);
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        endpoint.mockRejectedValueOnce(new Error('request canceled'));
        await click('image', 'toggle');
        expectStatus('image', false);
        expect(success).not.toHaveBeenCalled();
    });
});
