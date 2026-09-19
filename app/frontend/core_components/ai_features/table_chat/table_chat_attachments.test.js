// @vitest-environment jsdom
// table_chat_attachments.test.js
// Verifies what the chat composer accepts as an image for the site assistant.
// Bridges the file chooser, the upload route and the tokens one question carries.
// Exists so a refused file is visibly refused instead of silently dropped.
import { beforeEach, describe, expect, test, vi } from 'vitest';

const endpointRouterMock = vi.fn();
vi.mock('../../endpoints/endpoint_router.js', () => ({
    endpoint_router: (...args) => endpointRouterMock(...args),
}));

// The control reads its copy from the site's language keys; the fixture lets
// every key fall back to the built-in English.
vi.mock('../../lang/translation_handler.js', () => ({
    getTranslationForKey: (key, { fallback } = {}) => fallback,
}));

const { createChatAttachments, MAX_CHAT_ATTACHMENTS, chatAttachmentCopy } = await import(
    './table_chat_attachments.js'
);

function imageFile(name = 'shot.png', type = 'image/png') {
    return new File([new Uint8Array([1, 2, 3])], name, { type });
}

async function attach(handle, ...files) {
    await handle.addFiles(files);
}

beforeEach(() => {
    document.body.innerHTML = '';
    endpointRouterMock.mockReset();
    endpointRouterMock.mockImplementation(async () => ({ token: `fsi1_${Math.random()}`, name: 'shot.png' }));
});

describe('chat attachments', () => {
    test('an attached image is uploaded and carried as a token', async () => {
        const handle = createChatAttachments('app_notes');
        document.body.append(handle.row, handle.button);

        await attach(handle, imageFile());

        expect(endpointRouterMock).toHaveBeenCalledWith('aiChatAttachment', expect.objectContaining({
            method: 'POST',
        }));
        const [, options] = endpointRouterMock.mock.calls[0];
        expect(options.body_data).toBeInstanceOf(FormData);
        expect(options.body_data.get('image')).toBeInstanceOf(File);

        expect(handle.tokens()).toHaveLength(1);
        expect(handle.row.querySelectorAll('.chat_attachment')).toHaveLength(1);
        expect(handle.row.querySelector('.chat_attachment_name').textContent).toBe('shot.png');
    });

    test('a file that is not a supported image is refused before any upload', async () => {
        const handle = createChatAttachments('app_notes');
        document.body.append(handle.row);

        await attach(handle, new File(['text'], 'notes.txt', { type: 'text/plain' }));

        expect(endpointRouterMock).not.toHaveBeenCalled();
        expect(handle.tokens()).toHaveLength(0);
        expect(handle.row.querySelector('.chat_attachment_status').textContent)
            .toBe(chatAttachmentCopy().rejected);
    });

    test('no more than four images wait at a time', async () => {
        const handle = createChatAttachments('app_notes');
        document.body.append(handle.row, handle.button);

        await attach(handle, ...Array.from({ length: MAX_CHAT_ATTACHMENTS + 1 }, () => imageFile()));

        expect(handle.tokens()).toHaveLength(MAX_CHAT_ATTACHMENTS);
        expect(handle.button.disabled).toBe(true);
        expect(handle.row.querySelector('.chat_attachment_status').textContent)
            .toBe(chatAttachmentCopy().tooMany);
    });

    test('a failed upload is reported and attaches nothing', async () => {
        endpointRouterMock.mockRejectedValue(new Error('network'));
        const handle = createChatAttachments('app_notes');
        document.body.append(handle.row);

        await attach(handle, imageFile());

        expect(handle.tokens()).toHaveLength(0);
        expect(handle.row.querySelector('.chat_attachment_status').textContent)
            .toBe(chatAttachmentCopy().failed);
    });

    test('an attachment can be removed, and sending clears them all', async () => {
        const handle = createChatAttachments('app_notes');
        document.body.append(handle.row, handle.button);

        await attach(handle, imageFile('first.png'), imageFile('second.png'));
        expect(handle.tokens()).toHaveLength(2);

        handle.row.querySelector('.chat_attachment_remove').click();
        expect(handle.tokens()).toHaveLength(1);
        expect(handle.button.disabled).toBe(false);

        handle.clear();
        expect(handle.tokens()).toHaveLength(0);
        expect(handle.row.querySelectorAll('.chat_attachment')).toHaveLength(0);
    });
});
