/**
 * test-artifact-recovery-diagnostics.test.ts
 * Proves recovery errors cannot retain session secrets or private response contents.
 * Bridges injected API failures, complete error serialization and Playwright's reporter.
 * Protects every shared recovery read and drop, including parser and transport causes.
 */
// @vitest-environment node
import * as fs from 'node:fs';
import * as path from 'node:path';
import { inspect } from 'node:util';
import { expect, test, vi } from 'vitest';
import { requireNodeDependency } from '../../../server_tools/lib/node_dependency_loader.mjs';
import { assertAuthenticatedCleanupIdentity } from './test-artifact-cleanup';
import { readDatasetIdentityFromRequest, readDatasetTableUIDFromRequest } from './test-artifact-dataset-identity-reader';
import { readArtifactRunTarget, normalizeE2EBaseURL } from './test-artifact-run-target';
import { fetchCsrfTokenForRequest } from './temp-dataset';
import { initializeArtifactRunRegistryWithRecovery } from './test-artifact-stale-run-recovery';
import { listRegisteredTestArtifacts } from './test-artifact-run-registry';
import {
  TARGET, RUN_ID, root, fakeApi, recover, seedArtifact, expectDeadRecordKept, useRecoveryRegistry,
} from './test-artifact-recovery-fakes';

const { ListModeReporter } = requireNodeDependency('playwright/lib/runner');
const { serializeError } = requireNodeDependency('playwright/lib/util');
const MARKERS = ['SYNTHETIC_COOKIE_929', 'SYNTHETIC_CSRF_929', 'PRIVATE_RESPONSE_BODY_929'];
const PRIVATE = MARKERS.join(' ');
const ROUTES = ['/api/user-profile', '/api/admin/version-info', '/api/get-results',
  '/api/tree_data', '/api/datasets', '/api/get-metadata', '/api/csrf-token', '/api/drop-dataset'];
const JSON_ROUTES = ROUTES.filter(route => !['/api/admin/version-info', '/api/drop-dataset'].includes(route));
type FailureKind = 'HTTP' | 'transport' | 'body read' | 'malformed JSON' | 'malformed shape';

useRecoveryRegistry();

function privateTransportError() {
  const error = new Error(`request failed\nCall log:\n Cookie: ${MARKERS[0]}\n X-CSRF-Token: ${MARKERS[1]}`,
    { cause: new AggregateError([new Error(PRIVATE)], `response: ${MARKERS[2]}`) });
  return Object.assign(error, { headers: { Cookie: MARKERS[0], 'X-CSRF-Token': MARKERS[1] }, body: PRIVATE });
}

/** Runs the installed reporter's real recursive error formatter with captured output. */
function printedFailure(error: Error): string {
  let printed = '';
  const reporter = new ListModeReporter({ screen: {
    stderr: { write: (text: string) => { printed += text; } },
  } });
  reporter.onError(serializeError(error));
  return printed;
}

function completeFailure(error: unknown): string {
  const visit = (value: unknown): unknown => value instanceof Error ? {
    message: value.message, stack: value.stack, json: JSON.stringify(value),
    properties: Object.fromEntries(Object.getOwnPropertyNames(value)
      .filter(key => !['cause', 'errors'].includes(key)).map(key => [key, Reflect.get(value, key)])),
    cause: visit(value.cause),
    errors: value instanceof AggregateError ? value.errors.map(visit) : undefined,
  } : value;
  return JSON.stringify(visit(error)) + inspect(error, { depth: Infinity })
    + JSON.stringify(serializeError(error)) + printedFailure(error as Error);
}

function assertSafeFailure(error: unknown, route?: string) {
  expect(error).toBeInstanceOf(Error);
  const serialized = completeFailure(error);
  for (const marker of MARKERS) expect(serialized).not.toContain(marker);
  expect((error as Error).cause).toBeUndefined();
  expect((error as Error).message).toMatch(/^operation=/);
  if (route) expect((error as Error).message).toContain(route);
  expect(printedFailure(error as Error)).toContain((error as Error).message);
}

function injectFailure(api: ReturnType<typeof fakeApi>, route: string, kind: FailureKind) {
  const method = route === '/api/drop-dataset' ? api.post : api.get;
  const original = method.getMockImplementation()!;
  method.mockImplementation(async (...args: Parameters<typeof original>) => {
    if (args[0] !== route) return original(...args);
    if (kind === 'transport') throw privateTransportError();
    const status = kind === 'HTTP' ? 503 : 200;
    return {
      ok: () => status === 200, status: () => status,
      text: async () => {
        if (kind === 'body read') throw privateTransportError();
        // The invalid body deliberately appears in V8's JSON.parse error.
        return kind === 'malformed JSON' ? PRIVATE : JSON.stringify({ private: PRIVATE });
      },
      json: async () => {
        if (kind === 'body read') throw privateTransportError();
        if (kind === 'malformed JSON') return JSON.parse(PRIVATE);
        return { private: PRIVATE };
      },
    };
  });
}

test('serialization and reporter counterproof detect markers in the original transport error', () => {
  const serialized = completeFailure(privateTransportError());
  for (const marker of MARKERS) expect(serialized).toContain(marker);
});

test.each(ROUTES.flatMap(route => (['HTTP', 'transport'] as FailureKind[]).map(kind => [route, kind] as const)))
('recovery never exposes secrets from %s %s failures', async (route, kind) => {
  seedArtifact();
  const api = fakeApi({ e2e_recorded: { uid: 919 } });
  const evidence = listRegisteredTestArtifacts(RUN_ID);
  injectFailure(api, route, kind);
  const log = vi.fn();
  const failure = await recover(api, log).catch(error => error);
  assertSafeFailure(failure, route);
  expectDeadRecordKept();
  expect(listRegisteredTestArtifacts(RUN_ID)).toEqual(evidence);
  if (route !== '/api/drop-dataset') expect(api.post).not.toHaveBeenCalled();
  for (const marker of MARKERS) expect(JSON.stringify(log.mock.calls)).not.toContain(marker);
});

test.each(JSON_ROUTES.flatMap(route => (['body read', 'malformed JSON', 'malformed shape'] as FailureKind[])
  .map(kind => [route, kind] as const)))
('recovery never exposes secrets from %s %s responses', async (route, kind) => {
  seedArtifact();
  const api = fakeApi({ e2e_recorded: { uid: 919 } });
  injectFailure(api, route, kind);
  const failure = await recover(api).catch(error => error);
  assertSafeFailure(failure, route === '/api/tree_data' || route === '/api/datasets'
    || kind !== 'malformed shape' ? route : undefined);
  expect(api.post).not.toHaveBeenCalled();
  expectDeadRecordKept();
  expect(listRegisteredTestArtifacts(RUN_ID)).toHaveLength(1);
});

test.each(['HTTP', 'transport', 'body read', 'malformed JSON'] as FailureKind[])
('shared helpers directly return secret-free %s failures', async kind => {
  const calls = [
    ['/api/user-profile', (api: ReturnType<typeof fakeApi>) => assertAuthenticatedCleanupIdentity(api.request, { userId: 4, username: 'test_admin' })],
    ['/api/tree_data', (api: ReturnType<typeof fakeApi>) => readDatasetTableUIDFromRequest(api.request, 'e2e_recorded')],
    ['/api/datasets', (api: ReturnType<typeof fakeApi>) => readDatasetIdentityFromRequest(api.request, 'e2e_recorded')],
    ['/api/get-metadata', (api: ReturnType<typeof fakeApi>) => readDatasetIdentityFromRequest(api.request, 'e2e_recorded')],
    ['/api/get-results', (api: ReturnType<typeof fakeApi>) => readArtifactRunTarget(api.request, TARGET.baseURL)],
    ['/api/csrf-token', (api: ReturnType<typeof fakeApi>) => fetchCsrfTokenForRequest(api.request)],
  ] as const;
  for (const [route, call] of calls) {
    const api = fakeApi({ e2e_recorded: { uid: 919 } });
    injectFailure(api, route, kind);
    assertSafeFailure(await call(api).catch(error => error), route);
  }
});

test('profile identity mismatch never prints arbitrary public display-name contents', async () => {
  seedArtifact();
  const api = fakeApi();
  api.state.profile.username = PRIVATE;
  const failure = await recover(api).catch(error => error);
  assertSafeFailure(failure);
  expect(failure.message).toContain('Authenticated cleanup identity mismatch');
  expectDeadRecordKept();
});

test('new-target authentication callback cannot leak its transport error through orchestration', async () => {
  seedArtifact();
  const callback = vi.fn();
  const failure = await initializeArtifactRunRegistryWithRecovery({ rootDirectory: root }, callback,
    async () => { throw privateTransportError(); }).catch(error => error);
  assertSafeFailure(failure);
  expect(callback).not.toHaveBeenCalled();
  expectDeadRecordKept();
});

test('drop transport failures discard the real outgoing synthetic CSRF header and call-log cookies', async () => {
  seedArtifact();
  const api = fakeApi({ e2e_recorded: { uid: 919 } });
  const originalGet = api.get.getMockImplementation()!;
  api.get.mockImplementation(async (url, options) => url === '/api/csrf-token'
    ? { ok: () => true, status: () => 200, json: async () => ({ csrf_token: MARKERS[1] }),
      text: async () => JSON.stringify({ csrf_token: MARKERS[1], private: MARKERS[2] }) }
    : originalGet(url, options));
  api.post.mockImplementation(async (_url, options) => {
    const headers = (options as unknown as { headers: { 'X-CSRF-Token': string } }).headers;
    expect(headers['X-CSRF-Token']).toBe(MARKERS[1]);
    throw new Error(`Cookie: ${MARKERS[0]} X-CSRF-Token: ${headers['X-CSRF-Token']} ${MARKERS[2]}`,
      { cause: privateTransportError() });
  });
  assertSafeFailure(await recover(api).catch(error => error), '/api/drop-dataset');
  expectDeadRecordKept();
});

test.each(['current-run.json', `${RUN_ID}/run.json`, 'artifact', 'startup lock'])
('malformed recovery record never retains JSON input through a parser cause: %s', async location => {
  seedArtifact();
  let file = path.join(root, location);
  if (location === 'artifact') {
    const directory = path.join(root, RUN_ID, 'artifacts', 'dataset');
    file = path.join(directory, fs.readdirSync(directory)[0]);
  } else if (location === 'startup lock') {
    fs.mkdirSync(`${root}.startup-lock`);
    file = path.join(`${root}.startup-lock`, 'owner-broken.json');
  }
  fs.writeFileSync(file, PRIVATE);
  const api = fakeApi();
  assertSafeFailure(await recover(api).catch(error => error));
  expect(api.get).not.toHaveBeenCalled();
  expect(fs.readFileSync(file, 'utf8')).toBe(PRIVATE);
});

test('malformed URL diagnostics never retain secret input on the TypeError', () => {
  let failure: unknown;
  try { normalizeE2EBaseURL(PRIVATE); } catch (error) { failure = error; }
  assertSafeFailure(failure);
});
