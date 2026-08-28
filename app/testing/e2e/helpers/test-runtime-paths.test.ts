// @vitest-environment node

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  FILTEREST_TEST_RUNTIME_ROOT_ENV,
  resolveFilterestStorageRuntimePaths,
  resolveFilterestTestRuntimePaths,
  resolveFilterestTestRuntimeRoot,
} from './test-runtime-paths';

const applicationRoot = path.resolve('/repo/filterest/app');
const temporaryRoots: string[] = [];

function temporaryRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filterest-storage-paths-'));
  temporaryRoots.push(root);
  return root;
}

function createApplication(applicationPath: string): void {
  fs.mkdirSync(applicationPath, { recursive: true });
  fs.writeFileSync(path.join(applicationPath, 'go.mod'), 'module filterest\n');
  fs.writeFileSync(path.join(applicationPath, 'VERSION_APP'), 'test\n');
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    const readOnlyApplicationRoot = path.join(root, 'filterest', 'app');
    if (fs.existsSync(readOnlyApplicationRoot)) {
      fs.chmodSync(readOnlyApplicationRoot, 0o755);
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

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

describe('server storage runtime roots', () => {
  test('writes nested standalone fixtures beside a read-only app directory', () => {
    const root = temporaryRoot();
    const installationRoot = path.join(root, 'filterest');
    const nestedApplicationRoot = path.join(installationRoot, 'app');
    createApplication(nestedApplicationRoot);
    const applicationEntriesBefore = fs.readdirSync(nestedApplicationRoot).sort();
    fs.chmodSync(nestedApplicationRoot, 0o555);

    const paths = resolveFilterestStorageRuntimePaths({
      applicationRoot: nestedApplicationRoot,
      environment: {},
    });
    expect(paths.storageRoot).toBe(path.join(installationRoot, 'data', 'storage'));
    expect(paths.storageDeletedRoot).toBe(
      path.join(installationRoot, 'data', 'storage_deleted'),
    );

    for (const mutableRoot of [paths.storageRoot, paths.storageDeletedRoot]) {
      fs.mkdirSync(mutableRoot, { recursive: true });
      fs.writeFileSync(path.join(mutableRoot, 'marker.txt'), 'marker\n');
    }
    expect(fs.readdirSync(nestedApplicationRoot).sort()).toEqual(applicationEntriesBefore);
  });

  test('keeps embedded Easelect storage at the outer repository root', () => {
    const root = temporaryRoot();
    const easelectRoot = path.join(root, 'easelect');
    const nestedApplicationRoot = path.join(easelectRoot, 'filterest', 'app');
    createApplication(nestedApplicationRoot);
    fs.mkdirSync(path.join(easelectRoot, '.git'));
    fs.writeFileSync(path.join(easelectRoot, 'VERSION_EASELECT'), 'test\n');

    const paths = resolveFilterestStorageRuntimePaths({
      applicationRoot: nestedApplicationRoot,
      environment: {},
    });
    expect(paths.storageRoot).toBe(path.join(easelectRoot, 'storage'));
    expect(paths.storageDeletedRoot).toBe(path.join(easelectRoot, 'storage_deleted'));
  });

  test('rejects an explicit nested project boundary inside immutable app', () => {
    const root = temporaryRoot();
    const installationRoot = path.join(root, 'filterest');
    const nestedApplicationRoot = path.join(installationRoot, 'app');
    createApplication(nestedApplicationRoot);

    expect(() => resolveFilterestStorageRuntimePaths({
      applicationRoot: nestedApplicationRoot,
      environment: { FILTEREST_PROJECT_ROOT_OVERRIDE: nestedApplicationRoot },
    })).toThrow(/must resolve outside the immutable app directory/);
  });

  test('preserves legacy flat-checkout storage paths', () => {
    const root = temporaryRoot();
    const flatApplicationRoot = path.join(root, 'legacy-filterest');
    createApplication(flatApplicationRoot);

    const paths = resolveFilterestStorageRuntimePaths({
      applicationRoot: flatApplicationRoot,
      environment: {},
    });
    expect(paths.storageRoot).toBe(path.join(flatApplicationRoot, 'storage'));
    expect(paths.storageDeletedRoot).toBe(
      path.join(flatApplicationRoot, 'storage_deleted'),
    );
  });
});
