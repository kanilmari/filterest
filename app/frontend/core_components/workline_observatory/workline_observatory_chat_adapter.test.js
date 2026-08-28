// workline_observatory_chat_adapter.test.js
// Verifies AI prompts contain only the selected workline's structured snapshot.
// Bridges observatory selection with existing managed Queen session requests.
// Exists so unrelated worklines and raw report-history conversations cannot leak into prompts.

import { beforeEach, describe, expect, test, vi } from 'vitest';

const { endpointRouterMock } = vi.hoisted(() => ({ endpointRouterMock: vi.fn() }));
vi.mock('../endpoints/endpoint_router.js', () => ({ endpoint_router: endpointRouterMock }));

import { buildWorklineConversationPrompt, startWorklineConversation } from './workline_observatory_chat_adapter.js';

beforeEach(() => vi.clearAllMocks());

describe('workline observatory AI adapter', () => {
    test('uses only selected structured context and starts the existing Queen session route', async () => {
        endpointRouterMock.mockResolvedValue({ session: { id: 'session-1' } });
        const workline = {
            id: 869, title: 'Observatory', status: 'active', current_phase: 3, task_ids: [869],
            latest_report: { context: 'Selected context', technical: 'Selected technical', next_step: 'Selected next' },
        };
        const prompt = buildWorklineConversationPrompt(workline, null, 'What next?');
        expect(prompt).toContain('Selected context');
        expect(prompt).toContain('Human question: What next?');
        expect(prompt).toContain('Do not write raw conversation text into workline reports');

        await startWorklineConversation(workline, null, 'What next?');
        expect(endpointRouterMock).toHaveBeenCalledWith('queenSessions', expect.objectContaining({
            method: 'POST',
            body_data: expect.objectContaining({ task_id: 869 }),
        }));
    });
});
