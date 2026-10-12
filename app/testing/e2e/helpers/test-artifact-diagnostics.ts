/**
 * test-artifact-diagnostics.ts
 * Builds content-free failures for authenticated E2E artifact operations.
 * Bridges shared request helpers, registry recovery and printable test errors.
 * Discards transport/parser errors rather than attempting to redact their secrets.
 */
import type { APIResponse } from '@playwright/test';

const safeFailures = new WeakSet<Error>();
export type ArtifactDiagnosticContext = { name?: string; serverId?: number | null };

/** Only fixed local copy and validated identity fields may enter this factory. */
export function safeTestArtifactError(message: string): Error {
  const failure = new Error(message);
  safeFailures.add(failure);
  return failure;
}

/** Never copy an arbitrary message, cause, stack, headers or body into a new error. */
export function testArtifactFailure(
  operation: string, reason: string, context: ArtifactDiagnosticContext = {}, status?: number,
): Error {
  return safeTestArtifactError(`operation=${operation}`
    + (context.name === undefined ? '' : ` dataset=${JSON.stringify(context.name)}`)
    + ` serverId=${context.serverId ?? 'unknown'}`
    + (status === undefined ? '' : ` status=${status}`) + ` reason=${reason}`);
}

/** Retains safe local diagnostics, with no original error object or cause chain. */
export function safeTestArtifactFailure(
  error: unknown, operation: string, context: ArtifactDiagnosticContext = {}, status?: number,
): Error {
  if (!(error instanceof Error) || !safeFailures.has(error)) {
    return testArtifactFailure(operation, 'operation failed', context, status);
  }
  if (error.message.startsWith('operation=')
    && (context.name === undefined || error.message.includes(` dataset=${JSON.stringify(context.name)}`))
    && (status === undefined || error.message.includes(` status=${status}`))) return error;
  return testArtifactFailure(operation, error.message, context, status);
}

/** Bounds the Playwright call itself; its transport errors can contain session headers. */
export async function requestTestArtifactResponse(
  operation: string, send: () => Promise<APIResponse>, context: ArtifactDiagnosticContext = {},
): Promise<APIResponse> {
  let response: APIResponse;
  try {
    response = await send();
  } catch {
    throw testArtifactFailure(operation, 'request transport failed', context);
  }
  if (!response.ok()) {
    throw testArtifactFailure(operation, 'HTTP request failed', context, response.status());
  }
  return response;
}

/** A body-read failure and invalid JSON are fixed diagnostics, never parser causes. */
export async function readTestArtifactText(
  response: APIResponse, operation: string, context: ArtifactDiagnosticContext = {},
): Promise<string> {
  try {
    return await response.text();
  } catch {
    throw testArtifactFailure(operation, 'response read failed', context, response.status());
  }
}

/** Discards JSON errors even when Playwright includes the response contents in them. */
export async function readTestArtifactJson<T>(
  response: APIResponse, operation: string, context: ArtifactDiagnosticContext = {},
): Promise<T> {
  try {
    return await response.json() as T;
  } catch {
    throw testArtifactFailure(operation, 'Malformed JSON response', context, response.status());
  }
}

/** Parses the text-based shared helpers' responses without retaining body excerpts. */
export function parseTestArtifactJson<T>(
  body: string, operation: string, context: ArtifactDiagnosticContext = {}, status?: number,
): T {
  try {
    return JSON.parse(body) as T;
  } catch {
    throw testArtifactFailure(operation, 'Malformed JSON response', context, status);
  }
}
