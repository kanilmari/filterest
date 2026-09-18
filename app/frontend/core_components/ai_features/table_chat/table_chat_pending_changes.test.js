// @vitest-environment jsdom
// table_chat_pending_changes.test.js
// Verifies the chat view that shows an assistant job's waiting changes and approves them.
// Bridges the job answer, the approval route and the administrator's confirmation.
// Exists so nothing is presented as done before the approval actually succeeded.
import { beforeEach, describe, expect, test, vi } from 'vitest';

const endpointRouterMock = vi.fn();
vi.mock('../../endpoints/endpoint_router.js', () => ({
    endpoint_router: (...args) => endpointRouterMock(...args),
}));

const { renderPendingChanges, describePendingChange, pendingChangesCopy } = await import(
    './table_chat_pending_changes.js'
);

function waitingChange(overrides = {}) {
    return {
        method: 'POST',
        path: '/api/update-row',
        body_sha256: 'a'.repeat(64),
        query: { dataset: 'app_notes' },
        body: { id: 1, updates: [{ column: 'fi', value: 'Muistiinpano' }] },
        status: 'pending',
        ...overrides,
    };
}

function render(changes, onApproved) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderPendingChanges(container, { dataset: 'app_notes', jobId: 'job-1', changes, onApproved });
    return container;
}

beforeEach(() => {
    document.body.innerHTML = '';
    document.documentElement.lang = 'fi';
    endpointRouterMock.mockReset();
});

describe('pending changes view', () => {
    test('shows each waiting change with its exact call available', () => {
        const container = render([waitingChange()]);

        const text = pendingChangesCopy();
        expect(container.querySelector('.chat_pending_changes_heading').textContent).toBe(text.heading);
        expect(container.querySelectorAll('.chat_pending_change')).toHaveLength(1);
        expect(container.querySelector('.chat_pending_change_summary').textContent)
            .toBe('POST /api/update-row · Aineisto: app_notes');
        expect(container.querySelector('.chat_pending_change_body').textContent).toContain('Muistiinpano');
        expect(container.querySelector('.chat_pending_changes_approve').textContent).toBe(text.approveOne);
    });

    test('renders nothing without waiting changes', () => {
        const container = document.createElement('div');
        expect(renderPendingChanges(container, { dataset: 'app_notes', jobId: 'job-1', changes: [] })).toBeNull();
        expect(container.children).toHaveLength(0);
    });

    test('approval sends only the identity of each waiting call and refreshes the view', async () => {
        endpointRouterMock.mockResolvedValue({
            status: 'applied',
            pending_changes: [waitingChange({ status: 'done' })],
        });
        const onApproved = vi.fn();
        const container = render([waitingChange()], onApproved);

        container.querySelector('.chat_pending_changes_approve').click();
        await vi.waitFor(() => expect(onApproved).toHaveBeenCalled());

        expect(endpointRouterMock).toHaveBeenCalledWith('aiChatSiteAssistantApproval', {
            method: 'POST',
            body_data: {
                dataset: 'app_notes',
                job_id: 'job-1',
                approvals: [{ method: 'POST', path: '/api/update-row', body_sha256: 'a'.repeat(64) }],
            },
        });
        expect(container.querySelector('.chat_pending_change').dataset.status).toBe('done');
        expect(container.querySelector('.chat_pending_changes_status').textContent).toBe(pendingChangesCopy().done);
    });

    test('a failed change keeps the button available and says nothing was completed after it', async () => {
        endpointRouterMock.mockResolvedValue({
            status: 'apply_failed',
            pending_changes: [waitingChange({ status: 'failed' })],
        });
        const container = render([waitingChange()]);

        const approve = container.querySelector('.chat_pending_changes_approve');
        approve.click();
        await vi.waitFor(() =>
            expect(container.querySelector('.chat_pending_changes_status').textContent)
                .toBe(pendingChangesCopy().failed));
        expect(approve.disabled).toBe(false);
        expect(container.querySelector('.chat_pending_change').dataset.status).toBe('failed');
    });

    test('a failed request reports that nothing was changed', async () => {
        endpointRouterMock.mockRejectedValue(new Error('network'));
        const onApproved = vi.fn();
        const container = render([waitingChange()], onApproved);

        container.querySelector('.chat_pending_changes_approve').click();
        await vi.waitFor(() =>
            expect(container.querySelector('.chat_pending_changes_status').textContent)
                .toBe(pendingChangesCopy().error));
        expect(onApproved).not.toHaveBeenCalled();
        expect(container.querySelector('.chat_pending_change').dataset.status).toBe('pending');
    });

    test('already completed changes are not sent again', async () => {
        endpointRouterMock.mockResolvedValue({ status: 'applied', pending_changes: [] });
        const container = render([waitingChange({ status: 'done' }), waitingChange({ body_sha256: 'b'.repeat(64) })]);

        container.querySelector('.chat_pending_changes_approve').click();
        await vi.waitFor(() => expect(endpointRouterMock).toHaveBeenCalled());

        const approvals = endpointRouterMock.mock.calls[0][1].body_data.approvals;
        expect(approvals).toHaveLength(1);
        expect(approvals[0].body_sha256).toBe('b'.repeat(64));
    });

    test('copy follows the document language', () => {
        document.documentElement.lang = 'en';
        expect(pendingChangesCopy().heading).toBe('Waiting for your approval');
        expect(describePendingChange({ method: 'post', path: '/api/delete-rows', query: {} }))
            .toBe('POST /api/delete-rows');
    });
});
