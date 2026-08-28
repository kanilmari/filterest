// @vitest-environment node

import * as path from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  FILTEREST_TEST_RUNTIME_ROOT_ENV,
  resolveFilterestTestRuntimePaths,
  resolveFilterestTestRuntimeRoot,
} from './test-runtime-paths';

const applicationRoot = path.resolve('/repo/filterest/app');

describe('public test runtime root', () => {
  test('defaults the nested product to data/testing outside app', () => {
    const paths = resolveFilterestTestRuntimePaths({ applicationRoot, environment: {} });

    expect(paths.root).toBe(path.resolve('/repo/filterest/data/testing'));
    expect(paths.authStorageState).toBe(
      path.resolve('/repo/filterest/data/testing/e2e/.auth/user.json'),
    );
    expect(paths.playwrightResults).toBe(path.resolve('/repo/filterest/data/testing/test-results'));
    expect(paths.visualGuardian).toBe(
      path.resolve('/repo/filterest/data/testing/test-results/visual_guardian'),
    );
  });

  test('normalizes the explicit shared override against the product root', () => {
    expect(resolveFilterestTestRuntimeRoot({
      applicationRoot,
      environment: { [FILTEREST_TEST_RUNTIME_ROOT_ENV]: '../easelect-private-testing' },
    })).toBe(path.resolve('/repo/easelect-private-testing'));
  });

  test('rejects an override that points back into immutable source', () => {
    expect(() => resolveFilterestTestRuntimeRoot({
      applicationRoot,
      environment: { [FILTEREST_TEST_RUNTIME_ROOT_ENV]: 'app/testing-output' },
    })).toThrow(/must resolve outside the immutable app directory/);
  });
});
