/* @vitest-environment jsdom */

import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
    endpointRouterMock,
    hasDatasetPermissionMock,
    primeDatasetPermissionsMock,
    showConfirmModalMock,
    showErrorToastMock,
    showSuccessToastMock,
    showWarningToastMock,
} = vi.hoisted(() => ({
    endpointRouterMock: vi.fn(),
    hasDatasetPermissionMock: vi.fn(),
    primeDatasetPermissionsMock: vi.fn().mockResolvedValue({}),
    showConfirmModalMock: vi.fn(),
    showErrorToastMock: vi.fn(),
    showSuccessToastMock: vi.fn(),
    showWarningToastMock: vi.fn(),
}));

vi.mock('../../endpoints/endpoint_router.js', () => ({
    endpoint_router: endpointRouterMock,
}));

vi.mock('../../route_permission_checker.js', () => ({
    hasDatasetPermission: hasDatasetPermissionMock,
    primeDatasetPermissions: primeDatasetPermissionsMock,
}));

vi.mock('../../../reusable_components/modal/confirm_modal_builder.js', () => ({
    showConfirmModal: showConfirmModalMock,
}));

vi.mock('../../../reusable_components/notifications/toast_notification_printer.js', () => ({
    showErrorToast: showErrorToastMock,
    showSuccessToast: showSuccessToastMock,
    showWarningToast: showWarningToastMock,
}));

import {
    buildAttachmentList,
    buildAcceptAttribute,
    buildPdfPreviewSrc,
    buildPdfThumbnailSrc,
    canPreviewAttachment,
    classifyAttachmentKind,
    filterUploadableAttachmentFiles,
    filterAttachmentRows,
    formatAttachmentSize,
    resolveAttachmentDisplayName,
    resolveAttachmentDownloadName,
    resolveAttachmentDescription,
    resolveAttachmentKind,
    resolveAttachmentOriginalName,
} from './big_card_attachment_list.js';
import { buildRowArticleAttachmentList } from './row_article_attachment_list.js';

beforeEach(() => {
    endpointRouterMock.mockReset();
    endpointRouterMock.mockResolvedValue({
        attachment_asset_linkings: [{
            enabled: true,
            child_table: 'contracts_assets',
            asset_kinds: ['pdf', 'document', 'archive'],
            allowed_file_types: ['pdf', 'docx', 'zip'],
            max_file_size_mb: 25,
        }],
    });
    hasDatasetPermissionMock.mockReset();
    hasDatasetPermissionMock.mockResolvedValue(true);
    primeDatasetPermissionsMock.mockClear();
    showConfirmModalMock.mockReset();
    showConfirmModalMock.mockResolvedValue(true);
    showErrorToastMock.mockReset();
    showSuccessToastMock.mockReset();
    showWarningToastMock.mockReset();
    document.body.innerHTML = '';
});

describe('row article attachment aliases', () => {
    test('keeps the row_article attachment export mapped to the legacy implementation', () => {
        expect(buildRowArticleAttachmentList).toBe(buildAttachmentList);
    });
});

describe('classifyAttachmentKind', () => {
    test('classifies pdf files as pdf', () => {
        expect(classifyAttachmentKind('offer.pdf', 'application/pdf')).toBe('pdf');
    });

    test('classifies archive extensions as archive', () => {
        expect(classifyAttachmentKind('backup.zip', 'application/zip')).toBe('archive');
        expect(classifyAttachmentKind('backup.7z', '')).toBe('archive');
    });

    test('classifies common office files as document', () => {
        expect(classifyAttachmentKind('notes.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('document');
        expect(classifyAttachmentKind('readme.txt', 'text/plain')).toBe('document');
    });
});

describe('filterAttachmentRows', () => {
    test('keeps rows with allowed asset kinds', () => {
        const rows = [
            { id: 1, asset_kind: 'pdf' },
            { id: 2, asset_kind: 'document' },
            { id: 3, asset_kind: 'image' },
        ];
        expect(filterAttachmentRows(rows).map(row => row.id)).toEqual([1, 2]);
    });

    test('keeps legacy rows without asset_kind for backward compatibility', () => {
        const rows = [
            { id: 1, filename: 'legacy.pdf' },
            { id: 2, asset_kind: 'image' },
        ];
        expect(filterAttachmentRows(rows).map(row => row.id)).toEqual([1]);
    });

    test('sorts attachment rows deterministically by sort_order, created, and id', () => {
        const rows = [
            { id: 3, asset_kind: 'pdf', original_name: 'c.pdf' },
            { id: 2, asset_kind: 'pdf', original_name: 'b.pdf', created: '2026-04-14T09:00:00Z' },
            { id: 1, asset_kind: 'pdf', original_name: 'a.pdf', created: '2026-04-14T08:00:00Z' },
        ];
        expect(filterAttachmentRows(rows).map((row) => row.id)).toEqual([1, 2, 3]);
    });
});

describe('resolveAttachmentDisplayName', () => {
    test('prefers edited title over original_name and filename', () => {
        expect(resolveAttachmentDisplayName({
            title: 'Customer contract',
            original_name: 'contract.pdf',
            filename: '104_55_9.pdf',
        })).toBe('Customer contract');
    });

    test('falls back to original_name over filename', () => {
        expect(resolveAttachmentDisplayName({
            original_name: 'contract.pdf',
            filename: '104_55_9.pdf',
        })).toBe('contract.pdf');
    });

    test('falls back to attachment placeholder when row is empty', () => {
        expect(resolveAttachmentDisplayName({})).toBe('attachment');
    });
});

describe('attachment text helpers', () => {
    test('resolves original file name and trimmed description safely', () => {
        expect(resolveAttachmentOriginalName({
            original_name: 'contract.pdf',
            filename: '104_55_9.pdf',
        })).toBe('contract.pdf');
        expect(resolveAttachmentDescription({
            description: '  Customer-facing brochure  ',
        })).toBe('Customer-facing brochure');
    });

    test('preserves original extension in download name after title edits', () => {
        expect(resolveAttachmentDownloadName({
            title: 'Customer contract',
            original_name: 'contract.pdf',
        })).toBe('Customer contract.pdf');
        expect(resolveAttachmentDownloadName({
            title: 'Customer contract.pdf',
            original_name: 'contract.pdf',
        })).toBe('Customer contract.pdf');
    });
});

describe('resolveAttachmentKind', () => {
    test('uses explicit asset_kind when available', () => {
        expect(resolveAttachmentKind({ asset_kind: 'archive', filename: 'notes.pdf' })).toBe('archive');
    });

    test('infers asset kind from file name when missing', () => {
        expect(resolveAttachmentKind({ original_name: 'notes.pdf', mime_type: 'application/pdf' })).toBe('pdf');
    });
});

describe('formatAttachmentSize', () => {
    test('formats bytes, kilobytes, and megabytes', () => {
        expect(formatAttachmentSize(512)).toBe('512 B');
        expect(formatAttachmentSize(1536)).toBe('1.5 KB');
        expect(formatAttachmentSize(3 * 1024 * 1024)).toBe('3.0 MB');
    });

    test('returns empty string for invalid values', () => {
        expect(formatAttachmentSize(null)).toBe('');
        expect(formatAttachmentSize('bad')).toBe('');
    });
});

describe('pdf preview helpers', () => {
    test('marks only pdf attachments as previewable', () => {
        expect(canPreviewAttachment({ asset_kind: 'pdf' }, '/storage/104/1/original/contract.pdf')).toBe(true);
        expect(canPreviewAttachment({ asset_kind: 'document' }, '/storage/104/1/original/spec.docx')).toBe(false);
        expect(canPreviewAttachment({ asset_kind: 'pdf' }, '')).toBe(false);
    });

    test('adds viewer-friendly hash params to preview src', () => {
        expect(buildPdfPreviewSrc('/storage/104/1/original/contract.pdf')).toBe('/storage/104/1/original/contract.pdf#toolbar=0&navpanes=0&view=FitH');
        expect(buildPdfPreviewSrc('/storage/104/1/original/contract.pdf#page=2')).toBe('/storage/104/1/original/contract.pdf#page=2&toolbar=0&navpanes=0&view=FitH');
    });

    test('adds first-page hint to thumbnail src', () => {
        expect(buildPdfThumbnailSrc('/storage/104/1/original/contract.pdf')).toContain('#toolbar=0&navpanes=0&view=FitH&page=1');
    });
});

describe('buildAcceptAttribute', () => {
    test('converts extension arrays into input accept string', () => {
        expect(buildAcceptAttribute(['pdf', '.docx', 'zip'])).toBe('.pdf,.docx,.zip');
    });

    test('returns empty string when no types were provided', () => {
        expect(buildAcceptAttribute([])).toBe('');
        expect(buildAcceptAttribute(null)).toBe('');
    });
});

describe('filterUploadableAttachmentFiles', () => {
    test('splits accepted files from size and type rejections', () => {
        const pdf = new File(['%PDF-1.4'], 'offer.pdf', { type: 'application/pdf' });
        const docx = new File(['doc'], 'notes.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
        const oversized = new File([new Uint8Array(3 * 1024 * 1024)], 'huge.pdf', { type: 'application/pdf' });
        const png = new File(['img'], 'cover.png', { type: 'image/png' });

        const result = filterUploadableAttachmentFiles([pdf, docx, oversized, png], {
            allowedFileTypes: ['pdf', 'docx'],
            maxFileSizeMB: 2,
        });

        expect(result.acceptedFiles.map((file) => file.name)).toEqual(['offer.pdf', 'notes.docx']);
        expect(result.rejectedBySize.map((file) => file.name)).toEqual(['huge.pdf']);
        expect(result.rejectedByType.map((file) => file.name)).toEqual(['cover.png']);
    });
});

describe('buildAttachmentList', () => {
    test('uses caller-provided attachment linking status without refetching the status route', async () => {
        endpointRouterMock.mockClear();

        await buildAttachmentList(
            'contracts',
            7,
            {
                dataset: 'contracts_media',
                column: 'contracts_id',
                relation_kind: 'shared_asset',
                rows: [],
            },
            vi.fn(),
            {
                linkingStatus: {
                    enabled: true,
                    child_table: 'contracts_media',
                    asset_kinds: ['pdf', 'document', 'archive'],
                    allowed_file_types: ['pdf', 'docx'],
                    max_file_size_mb: 25,
                },
            },
        );

        expect(endpointRouterMock).not.toHaveBeenCalledWith('assetLinkingStatus', expect.anything());
    });

    test('treats an explicit null linking status as a permission-aware no-refetch result', async () => {
        endpointRouterMock.mockClear();
        hasDatasetPermissionMock.mockResolvedValue(false);

        const list = await buildAttachmentList(
            'tiketit',
            9,
            {
                dataset: 'tiketit_assets',
                column: 'tiketit_id',
                relation_kind: 'shared_asset',
                rows: [{
                    id: 1,
                    asset_kind: 'pdf',
                    original_name: 'guest-network-instructions.pdf',
                    filename: '10_9_1.pdf',
                    mime_type: 'application/pdf',
                }],
            },
            vi.fn(),
            { linkingStatus: null },
        );

        expect(list?.querySelector('[data-testid="big-card-attachment-item-0"]')).not.toBeNull();
        expect(list?.querySelector('[data-testid="big-card-attachments-add"]')).toBeNull();
        expect(list?.querySelector('[data-testid="big-card-attachment-edit-0"]')).toBeNull();
        expect(list?.querySelector('[data-testid="big-card-attachment-delete-0"]')).toBeNull();
        expect(endpointRouterMock).not.toHaveBeenCalledWith('assetLinkingStatus', expect.anything());
    });

    test('renders preview action only for pdf attachments', async () => {
        const list = await buildAttachmentList(
            'contracts',
            7,
            {
                dataset: 'contracts_assets',
                column: 'contracts_id',
                relation_kind: 'shared_asset',
                rows: [
                    { id: 1, asset_kind: 'pdf', original_name: 'contract.pdf', filename: '200_7_1.pdf', mime_type: 'application/pdf' },
                    { id: 2, asset_kind: 'document', original_name: 'specification.docx', filename: '200_7_2.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
                ],
            },
            vi.fn(),
        );

        expect(list?.querySelector('[data-testid="big-card-attachment-preview-0"]')).not.toBeNull();
        expect(list?.querySelector('[data-testid="big-card-attachment-preview-1"]')).toBeNull();
    });

    test('opens preview modal when pdf preview action is clicked', async () => {
        const list = await buildAttachmentList(
            'contracts',
            7,
            {
                dataset: 'contracts_assets',
                column: 'contracts_id',
                relation_kind: 'shared_asset',
                rows: [{ id: 1, asset_kind: 'pdf', original_name: 'contract.pdf', filename: '200_7_1.pdf', mime_type: 'application/pdf' }],
            },
            vi.fn(),
        );

        list?.querySelector('[data-testid="big-card-attachment-preview-0"]')?.dispatchEvent(
            new MouseEvent('click', { bubbles: true })
        );

        expect(list?.querySelector('[data-testid="big-card-pdf-preview-frame"]')?.getAttribute('src')).toContain('200_7_1.pdf#toolbar=0');
        expect(list?.querySelector('[data-testid="big-card-pdf-preview-open"]')?.getAttribute('href')).toContain('200_7_1.pdf');
    });

    test('saves attachment title and description inline through one batch updateRow request', async () => {
        endpointRouterMock.mockClear();
        const onAttachmentChanged = vi.fn().mockResolvedValue(undefined);

        const list = await buildAttachmentList(
            'contracts',
            7,
            {
                dataset: 'contracts_assets',
                column: 'contracts_id',
                relation_kind: 'shared_asset',
                rows: [{
                    id: 1,
                    asset_kind: 'pdf',
                    title: 'Old title',
                    description: 'Old description',
                    original_name: 'contract.pdf',
                    filename: '200_7_1.pdf',
                    mime_type: 'application/pdf',
                }],
            },
            onAttachmentChanged,
            {
                linkingStatus: {
                    enabled: true,
                    child_table: 'contracts_assets',
                    relation_kind: 'shared_asset',
                    foreign_key_column: 'contracts_id',
                    asset_kinds: ['pdf', 'document', 'archive'],
                },
            },
        );

        document.body.appendChild(list);
        endpointRouterMock.mockClear();

        list?.querySelector('[data-testid="big-card-attachment-edit-0"]')?.dispatchEvent(
            new MouseEvent('click', { bubbles: true })
        );

        const titleInput = list?.querySelector('[data-testid="big-card-attachment-title-input-0"]');
        const descriptionInput = list?.querySelector('[data-testid="big-card-attachment-description-input-0"]');
        expect(titleInput).not.toBeNull();
        expect(descriptionInput).not.toBeNull();

        titleInput.value = 'Customer contract';
        descriptionInput.value = 'Final signed PDF';

        list?.querySelector('[data-testid="big-card-attachment-save-0"]')?.dispatchEvent(
            new MouseEvent('click', { bubbles: true })
        );

        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(endpointRouterMock).toHaveBeenCalledTimes(1);
        expect(endpointRouterMock).toHaveBeenCalledWith('updateRow', expect.objectContaining({
            method: 'POST',
            url_params: '?dataset=contracts_assets',
            body_data: {
                id: 1,
                updates: [
                    { column: 'title', value: 'Customer contract' },
                    { column: 'description', value: 'Final signed PDF' },
                ],
            },
        }));
        expect(onAttachmentChanged).toHaveBeenCalledTimes(1);
    });

    test('uses backend foreign_key_column metadata for attachment uploads when child stub is incomplete', async () => {
        endpointRouterMock.mockClear();
        const list = await buildAttachmentList(
            'contracts',
            7,
            {
                dataset: 'contracts_assets',
                rows: [],
            },
            vi.fn(),
            {
                linkingStatus: {
                    enabled: true,
                    child_table: 'contracts_assets',
                    relation_kind: 'shared_asset',
                    foreign_key_column: 'contracts_parent_id',
                    asset_kinds: ['pdf', 'document', 'archive'],
                    allowed_file_types: ['pdf'],
                },
            },
        );

        document.body.appendChild(list);
        endpointRouterMock.mockClear();

        const input = list?.querySelector('[data-testid="big-card-attachments-input"]');
        const file = new File(['%PDF-1.4'], 'contract.pdf', { type: 'application/pdf' });
        Object.defineProperty(input, 'files', {
            value: [file],
            configurable: true,
        });
        input.dispatchEvent(new Event('change', { bubbles: true }));

        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(endpointRouterMock).toHaveBeenCalledWith('addRowMultipart', expect.objectContaining({
            method: 'POST',
            url_params: '?dataset=contracts_assets',
            body_data: expect.any(FormData),
        }));
        const call = endpointRouterMock.mock.calls.find(([routeName]) => routeName === 'addRowMultipart');
        expect(call).toBeTruthy();
        const formData = call[1].body_data;
        const payload = JSON.parse(formData.get('jsonPayload'));
        expect(payload.contracts_parent_id).toBe(7);
    });

    test('renders pdf thumbnail card for previewable attachments', async () => {
        const list = await buildAttachmentList(
            'contracts',
            7,
            {
                dataset: 'contracts_assets',
                column: 'contracts_id',
                relation_kind: 'shared_asset',
                rows: [{ id: 1, asset_kind: 'pdf', original_name: 'contract.pdf', filename: '200_7_1.pdf', mime_type: 'application/pdf' }],
            },
            vi.fn(),
        );

        expect(list?.querySelector('[data-testid="big-card-pdf-thumbnail-0"]')).not.toBeNull();
        expect(list?.querySelector('[data-testid="big-card-pdf-thumbnail-frame-0"]')?.getAttribute('src')).toContain('200_7_1.pdf#toolbar=0');
    });

    test('opens preview panel when pdf thumbnail is clicked', async () => {
        const list = await buildAttachmentList(
            'contracts',
            7,
            {
                dataset: 'contracts_assets',
                column: 'contracts_id',
                relation_kind: 'shared_asset',
                rows: [{ id: 1, asset_kind: 'pdf', original_name: 'contract.pdf', filename: '200_7_1.pdf', mime_type: 'application/pdf' }],
            },
            vi.fn(),
        );

        list?.querySelector('[data-testid="big-card-pdf-thumbnail-0"]')?.dispatchEvent(
            new MouseEvent('click', { bubbles: true })
        );

        expect(list?.querySelector('[data-testid="big-card-pdf-preview"]')?.hasAttribute('hidden')).toBe(false);
        expect(list?.querySelector('[data-testid="big-card-pdf-preview-frame"]')?.getAttribute('src')).toContain('200_7_1.pdf#toolbar=0');
    });

    test('toggles preview panel closed when the same preview button is clicked again', async () => {
        const list = await buildAttachmentList(
            'contracts',
            7,
            {
                dataset: 'contracts_assets',
                column: 'contracts_id',
                relation_kind: 'shared_asset',
                rows: [{ id: 1, asset_kind: 'pdf', original_name: 'contract.pdf', filename: '200_7_1.pdf', mime_type: 'application/pdf' }],
            },
            vi.fn(),
        );

        const previewButton = list?.querySelector('[data-testid="big-card-attachment-preview-0"]');
        previewButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(list?.querySelector('[data-testid="big-card-pdf-preview"]')?.hasAttribute('hidden')).toBe(false);

        previewButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(list?.querySelector('[data-testid="big-card-pdf-preview"]')?.hasAttribute('hidden')).toBe(true);
    });

    test('renders count badge, visible dropzone, and multiple upload input for shared asset attachments', async () => {
        const list = await buildAttachmentList(
            'contracts',
            7,
            {
                dataset: 'contracts_assets',
                column: 'contracts_id',
                relation_kind: 'shared_asset',
                rows: [{ id: 1, asset_kind: 'pdf', original_name: 'contract.pdf', filename: '200_7_1.pdf' }],
            },
            vi.fn(),
        );

        expect(list?.querySelector('[data-testid="big-card-attachments-count"]')?.textContent).toBe('1');
        const uploadInput = list?.querySelector('[data-testid="big-card-attachments-input"]');
        expect(uploadInput).not.toBeNull();
        expect(uploadInput.multiple).toBe(true);
        expect(list?.querySelector('[data-testid="big-card-attachments-dropzone"]')?.textContent).toContain('Raahaa lisää liitteitä');
        expect(list?.classList.contains('is-uploadable')).toBe(true);
    });

    test('shows upload-oriented empty state when attachments are enabled but none exist yet', async () => {
        const list = await buildAttachmentList(
            'contracts',
            7,
            {
                dataset: 'contracts_assets',
                column: 'contracts_id',
                relation_kind: 'shared_asset',
                rows: [],
            },
            vi.fn(),
        );

        expect(list?.querySelector('[data-testid="big-card-attachments-empty"]')?.textContent).toContain('Ei liitteitä');
        expect(list?.querySelector('[data-testid="big-card-attachments-dropzone"]')?.textContent).toContain('Pudota liitteet');
    });
});
