// application_update_endpoint_router.test.js
// Verifies stable update wrappers pass requests through the normal API pipeline.
// Connects versioned contracts and job identities without exposing a UI control.
// Keeps CSRF, authentication handling and safe path resolution in their shared boundary.
import { beforeEach, expect, test, vi } from 'vitest';

const routed = vi.hoisted(() => vi.fn());
vi.mock('./endpoint_router.js', () => ({ endpoint_router: routed }));
import {
    fetchApplicationUpdateStatus, requestApplicationUpdate, fetchApplicationUpdateJob,
    decideApplicationUpdate, reauthenticateApplicationUpdate,
} from './stable_endpoint_router.js';

beforeEach(() => routed.mockReset());

test('all update operations use the routed pipeline and preserve exact job identity', async () => {
    const request = { protocol_version: 1, idempotency_key: 'request-1' };
    const decision = { protocol_version: 1, decision: 'refuse' };
    const proof = { protocol_version: 1, action: 'request', password: 'test-only' };
    await fetchApplicationUpdateStatus();
    await requestApplicationUpdate(request);
    await fetchApplicationUpdateJob('job-1');
    await decideApplicationUpdate('job-1', decision);
    await reauthenticateApplicationUpdate(proof);
    expect(routed.mock.calls).toEqual([
        ['applicationUpdateStatus'],
        ['applicationUpdateRequest', { method: 'POST', body_data: request }],
        ['applicationUpdateJob', { url_params: { id: 'job-1' } }],
        ['applicationUpdateDecision', { method: 'POST', url_params: { id: 'job-1' }, body_data: decision }],
        ['applicationUpdateReauthentication', { method: 'POST', body_data: proof }],
    ]);
});
