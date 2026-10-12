/**
 * test-artifact-csrf-reader.ts
 * Reads session CSRF for request-scoped E2E cleanup and dead-run recovery.
 * Bridges authenticated Playwright requests and the existing CSRF endpoint.
 * Keeps tokens, response bodies and transport call logs out of every failure.
 */
import type { APIRequestContext } from '@playwright/test';
import {
  requestTestArtifactResponse, readTestArtifactText, parseTestArtifactJson,
  testArtifactFailure, type ArtifactDiagnosticContext,
} from './test-artifact-diagnostics';

/** Token contents are returned only to the caller; diagnostics retain no response data. */
export async function fetchCsrfTokenForRequest(
  request: APIRequestContext, context: ArtifactDiagnosticContext = {},
): Promise<string> {
  const operation = 'GET /api/csrf-token';
  const response = await requestTestArtifactResponse(operation, () => request.get('/api/csrf-token'), context);
  const body = await readTestArtifactText(response, operation, context);
  const data = parseTestArtifactJson<{ csrf_token?: unknown }>(body, operation, context, response.status());
  if (typeof data?.csrf_token !== 'string' || data.csrf_token.trim() === '') {
    throw testArtifactFailure(operation,
      'Missing csrf_token in /api/csrf-token response for request-scoped temp dataset cleanup.', context, response.status());
  }
  return data.csrf_token;
}
