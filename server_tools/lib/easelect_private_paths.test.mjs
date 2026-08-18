// easelect_private_paths.test.mjs
// Verifies the Node resolver for native Easelect and independent runtime paths.
// Bridges temporary checkout markers with the one EASELECT_KEY_ROOT override contract.
// Exists to prevent tooling from recreating or depending on root compatibility links.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  resolveEaselectPrivatePaths,
  resolveFilterestHomes,
} from './easelect_private_paths.mjs';

const temporaryRoots = [];

function temporaryRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'easelect-private-paths-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('resolveEaselectPrivatePaths', () => {
  test('resolves a private source checkout outside the repo', () => {
    const root = temporaryRoot();
    const projectRoot = path.join(root, 'easelect');
    const keyRoot = path.join(root, 'protected-keys');
    fs.mkdirSync(path.join(projectRoot, '.git'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'VERSION_EASELECT'), 'test\n');

    const resolved = resolveEaselectPrivatePaths(projectRoot, {
      EASELECT_KEY_ROOT: keyRoot,
    });

    expect(resolved).toEqual({
      runtimeEnvFile: path.join(
        keyRoot,
        'easelect_development',
        'runtime_environment.env',
      ),
      developmentEnvFile: path.join(
        keyRoot,
        'easelect_development',
        'development_environment.env',
      ),
      tlsCertificateFile: path.join(
        keyRoot,
        'easelect_development',
        'local_tls_certificate',
        'localhost_certificate.crt',
      ),
      tlsPrivateKeyFile: path.join(
        keyRoot,
        'easelect_development',
        'local_tls_certificate',
        'localhost_private_key.key',
      ),
    });
    for (const legacyName of ['.env', 'dev_env.txt', 'dev-cert.crt', 'dev-cert.key']) {
      expect(fs.existsSync(path.join(projectRoot, legacyName))).toBe(false);
    }
  });

  test('keeps generated and deployed runtimes local', () => {
    for (const versionFile of ['VERSION_APP', 'VERSION_EASELECT']) {
      const projectRoot = path.join(temporaryRoot(), versionFile);
      fs.mkdirSync(projectRoot);
      fs.writeFileSync(path.join(projectRoot, versionFile), 'test\n');

      expect(resolveEaselectPrivatePaths(projectRoot, {})).toEqual({
        runtimeEnvFile: path.join(projectRoot, '.env'),
        developmentEnvFile: path.join(projectRoot, 'dev_env.txt'),
        tlsCertificateFile: path.join(projectRoot, 'dev-cert.crt'),
        tlsPrivateKeyFile: path.join(projectRoot, 'dev-cert.key'),
      });
    }
  });

  test('keeps the Easelect sibling and portable Filterest subfolder defaults distinct', () => {
    const root = temporaryRoot();
    const privateRoot = path.join(root, 'easelect');
    fs.mkdirSync(path.join(privateRoot, '.git'), { recursive: true });
    fs.writeFileSync(path.join(privateRoot, 'VERSION_EASELECT'), 'test\n');

    const privateHomes = resolveFilterestHomes(privateRoot, {});
    expect(privateHomes.projectsHome).toBe(path.join(root, 'filterest-projects'));
    expect(privateHomes.projectsAppsHome).toBe(path.join(root, 'filterest-projects', 'apps'));
    expect(privateHomes.runtimeDataHome).toBe(path.join(root, 'filterest-runtime-data'));
    expect(privateHomes.maintainerToolsHome).toBe(
      path.join(root, 'filterest-maintainer-tools'),
    );
    expect(privateHomes.operationsHome).toBe(path.join(root, 'filterest-operations'));

    const publicRoot = path.join(root, 'filterest');
    fs.mkdirSync(publicRoot);
    fs.writeFileSync(path.join(publicRoot, 'VERSION_APP'), 'test\n');
    const publicHomes = resolveFilterestHomes(publicRoot, {});
    expect(publicHomes.projectsHome).toBe(path.join(publicRoot, 'filterest_projects'));
    expect(publicHomes.runtimeDataHome).toBe(path.join(publicRoot, 'filterest_runtime_data'));
    expect(publicHomes.maintainerToolsHome).toBe(
      path.join(publicRoot, 'filterest_maintainer_tools'),
    );
    expect(publicHomes.operationsHome).toBe(
      path.join(publicRoot, 'filterest_operations'),
    );
  });

  test('does not reinterpret calculated shell exports as explicit overrides', () => {
    const projectRoot = path.join(temporaryRoot(), 'filterest');
    fs.mkdirSync(projectRoot);
    fs.writeFileSync(path.join(projectRoot, 'VERSION_APP'), 'test\n');

    const homes = resolveFilterestHomes(projectRoot, {
      FILTEREST_PROJECTS_HOME: path.join(projectRoot, 'filterest_projects'),
      FILTEREST_KEYS_HOME: path.join(projectRoot, 'filterest_keys'),
      FILTEREST_RUNTIME_DATA_HOME: path.join(projectRoot, 'filterest_runtime_data'),
      FILTEREST_MAINTAINER_TOOLS_HOME: path.join(
        projectRoot,
        'filterest_maintainer_tools',
      ),
      FILTEREST_OPERATIONS_HOME: path.join(projectRoot, 'filterest_operations'),
      FILTEREST_PROJECTS_HOME_CONFIGURED: '0',
      FILTEREST_KEYS_HOME_CONFIGURED: '0',
      FILTEREST_RUNTIME_DATA_HOME_CONFIGURED: '0',
      FILTEREST_MAINTAINER_TOOLS_HOME_CONFIGURED: '0',
      FILTEREST_OPERATIONS_HOME_CONFIGURED: '0',
    });

    expect(homes.projectsHomeConfigured).toBe(false);
    expect(homes.keysHomeConfigured).toBe(false);
    expect(homes.runtimeDataHomeConfigured).toBe(false);
    expect(homes.maintainerToolsHomeConfigured).toBe(false);
    expect(homes.operationsHomeConfigured).toBe(false);
  });

  test('accepts dynamic relative and absolute homes', () => {
    const root = temporaryRoot();
    const projectRoot = path.join(root, 'filterest');
    const keysHome = path.join(root, 'operator data', 'keys');
    const runtimeDataHome = path.join(root, 'operator data', 'runtime');
    const maintainerToolsHome = path.join(root, 'operator data', 'maintainer');
    const operationsHome = path.join(root, 'operator data', 'operations');
    fs.mkdirSync(projectRoot);
    fs.writeFileSync(path.join(projectRoot, 'VERSION_APP'), 'test\n');
    const locator = path.join(projectRoot, 'filterest.paths.local');
    fs.writeFileSync(
      locator,
      `schema_version=1\nprojects_home=../customer projects\nkeys_home=${keysHome}\nruntime_data_home=${runtimeDataHome}\nmaintainer_tools_home=${maintainerToolsHome}\noperations_home=${operationsHome}\n`,
    );
    fs.chmodSync(locator, 0o600);

    expect(resolveFilterestHomes(projectRoot, {})).toEqual({
      projectRoot,
      projectsHome: path.join(root, 'customer projects'),
      projectsAppsHome: path.join(root, 'customer projects', 'apps'),
      keysHome,
      runtimeDataHome,
      maintainerToolsHome,
      operationsHome,
      projectsHomeConfigured: true,
      keysHomeConfigured: true,
      runtimeDataHomeConfigured: true,
      maintainerToolsHomeConfigured: true,
      operationsHomeConfigured: true,
    });
    expect(resolveEaselectPrivatePaths(projectRoot, {})).toEqual({
      runtimeEnvFile: path.join(keysHome, 'filterest_runtime', 'runtime_environment.env'),
      developmentEnvFile: path.join(
        keysHome,
        'filterest_runtime',
        'development_environment.env',
      ),
      tlsCertificateFile: path.join(
        keysHome,
        'filterest_runtime',
        'local_tls_certificate',
        'localhost_certificate.crt',
      ),
      tlsPrivateKeyFile: path.join(
        keysHome,
        'filterest_runtime',
        'local_tls_certificate',
        'localhost_private_key.key',
      ),
    });
  });

  test('rejects dangerous and overlapping dynamic homes', () => {
    const projectRoot = path.join(temporaryRoot(), 'filterest');
    fs.mkdirSync(projectRoot);
    fs.writeFileSync(path.join(projectRoot, 'VERSION_APP'), 'test\n');

    expect(() => resolveFilterestHomes(projectRoot, {
      FILTEREST_PROJECTS_HOME: '.',
      FILTEREST_KEYS_HOME: '../keys',
    })).toThrow(/checkout root/);
    expect(() => resolveFilterestHomes(projectRoot, {
      FILTEREST_PROJECTS_HOME: '../shared/projects',
      FILTEREST_KEYS_HOME: '../shared',
    })).toThrow(/equal or nested/);
    expect(() => resolveFilterestHomes(projectRoot, {
      FILTEREST_PROJECTS_HOME: '../projects',
      FILTEREST_KEYS_HOME: '../keys',
      FILTEREST_RUNTIME_DATA_HOME: '.',
    })).toThrow(/checkout root/);
    expect(() => resolveFilterestHomes(projectRoot, {
      FILTEREST_PROJECTS_HOME: '../projects',
      FILTEREST_KEYS_HOME: '../keys',
      FILTEREST_RUNTIME_DATA_HOME: '.git/runtime',
    })).toThrow(/inside \.git/);
    expect(() => resolveFilterestHomes(projectRoot, {
      FILTEREST_PROJECTS_HOME: '../projects',
      FILTEREST_KEYS_HOME: '../keys',
      FILTEREST_RUNTIME_DATA_HOME: '../projects/runtime',
    })).toThrow(/equal or nested/);
    expect(() => resolveFilterestHomes(projectRoot, {
      FILTEREST_PROJECTS_HOME: '../projects',
      FILTEREST_KEYS_HOME: '../keys',
      FILTEREST_RUNTIME_DATA_HOME: '../runtime',
      FILTEREST_MAINTAINER_TOOLS_HOME: '../projects/maintainer',
    })).toThrow(/equal or nested/);
    expect(() => resolveFilterestHomes(projectRoot, {
      FILTEREST_PROJECTS_HOME: '../projects',
      FILTEREST_KEYS_HOME: '../keys',
      FILTEREST_RUNTIME_DATA_HOME: '../runtime',
      FILTEREST_MAINTAINER_TOOLS_HOME: '../maintainer',
      FILTEREST_OPERATIONS_HOME: '../maintainer/operations',
    })).toThrow(/equal or nested/);
    expect(() => resolveFilterestHomes(projectRoot, {
      FILTEREST_PROJECTS_HOME: 'projects[prod]',
      FILTEREST_KEYS_HOME: '../keys',
    })).toThrow(/pattern characters/);
    expect(() => resolveFilterestHomes(projectRoot, {
      FILTEREST_PROJECTS_HOME: 'projects\nprod',
      FILTEREST_KEYS_HOME: '../keys',
    })).toThrow(/control characters/);
  });

  test('rejects a local path locator writable by group or others', () => {
    const projectRoot = path.join(temporaryRoot(), 'filterest');
    const locator = path.join(projectRoot, 'filterest.paths.local');
    fs.mkdirSync(projectRoot);
    fs.writeFileSync(path.join(projectRoot, 'VERSION_APP'), 'test\n');
    fs.writeFileSync(locator, 'projects_home=projects\nkeys_home=keys\n');
    fs.chmodSync(locator, 0o666);

    expect(() => resolveFilterestHomes(projectRoot, {})).toThrow(
      /writable by group or others/,
    );
  });

  test('rejects relative and repo-internal overrides', () => {
    const projectRoot = path.join(temporaryRoot(), 'easelect');
    fs.mkdirSync(path.join(projectRoot, '.git'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'VERSION_EASELECT'), 'test\n');

    expect(() => resolveEaselectPrivatePaths(projectRoot, {
      EASELECT_KEY_ROOT: 'relative/keys',
    })).toThrow(/EASELECT_KEY_ROOT/);
    expect(() => resolveEaselectPrivatePaths(projectRoot, {
      EASELECT_KEY_ROOT: path.join(projectRoot, 'private'),
    })).toThrow(/EASELECT_KEY_ROOT/);
  });
});
