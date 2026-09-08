// easelect_private_paths.test.mjs
// Verifies the canonical Node resolver for embedded Easelect and standalone Filterest paths.
// Bridges temporary checkout markers with local defaults and optional legacy overrides.
// Exists to prevent tooling from recreating or depending on root compatibility links.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  resolveEaselectPrivatePaths,
  resolveFilterestProjectBoundary,
  resolveFilterestHomes,
} from './easelect_private_paths.mjs';

const temporaryRoots = [];

function temporaryRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'easelect-private-paths-'));
  temporaryRoots.push(root);
  return root;
}

function writeSourceRoots(root) {
  fs.writeFileSync(path.join(root, 'filterest.source-roots'),
    'filterest\nfilterest_private\nfilterest_candidates\n', { mode: 0o644 });
}

function privateMetadataRoot() {
  const root = temporaryRoot();
  fs.mkdirSync(path.join(root, '.git'));
  fs.writeFileSync(path.join(root, 'VERSION_EASELECT'), 'test\n');
  writeSourceRoots(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('resolveFilterestProjectBoundary', () => {
  test('maps app to its installation unless a true Easelect source parent exists', () => {
    const root = temporaryRoot();
    const easelectRoot = path.join(root, 'easelect');
    const installationRoot = path.join(easelectRoot, 'filterest');
    const applicationRoot = path.join(installationRoot, 'app');
    fs.mkdirSync(applicationRoot, { recursive: true });
    fs.writeFileSync(path.join(easelectRoot, 'VERSION_EASELECT'), 'test\n');
    writeSourceRoots(easelectRoot);

    expect(resolveFilterestProjectBoundary(applicationRoot, {})).toBe(
      installationRoot,
    );

    fs.mkdirSync(path.join(easelectRoot, '.git'));
    expect(resolveFilterestProjectBoundary(applicationRoot, {})).toBe(
      installationRoot,
    );
    fs.writeFileSync(path.join(applicationRoot, 'go.mod'), 'module filterest\n');
    fs.writeFileSync(path.join(applicationRoot, 'VERSION_APP'), 'test\n');
    expect(resolveFilterestProjectBoundary(applicationRoot, {})).toBe(easelectRoot);

    const explicitRoot = path.join(root, 'explicit-boundary');
    expect(resolveFilterestProjectBoundary(applicationRoot, {
      FILTEREST_PROJECT_ROOT_OVERRIDE: explicitRoot,
    })).toBe(explicitRoot);
  });
});

describe('resolveEaselectPrivatePaths', () => {
  test('derives internal private keys after moving the complete root', () => {
    const root = temporaryRoot();
    const original = path.join(root, 'original');
    const moved = path.join(root, 'moved workspace');
    fs.mkdirSync(path.join(original, '.git'), { recursive: true });
    fs.writeFileSync(path.join(original, 'VERSION_EASELECT'), 'test\n');
    writeSourceRoots(original);
    fs.renameSync(original, moved);
    const resolved = resolveEaselectPrivatePaths(moved, {});
    expect(resolved.runtimeEnvFile).toBe(path.join(moved, 'keys/easelect_development/runtime_environment.env'));
    expect(resolved.tlsPrivateKeyFile).toBe(path.join(moved, 'keys/easelect_development/local_tls_certificate/localhost_private_key.key'));
    expect(fs.existsSync(path.join(moved, 'keys'))).toBe(false);
  });

  test('rejects mutable homes inside each private source owner, including links', () => {
    const root = temporaryRoot();
    fs.mkdirSync(path.join(root, '.git'));
    fs.writeFileSync(path.join(root, 'VERSION_EASELECT'), 'test\n');
    writeSourceRoots(root);
    for (const owner of ['filterest', 'filterest_private', 'filterest_candidates']) {
      fs.mkdirSync(path.join(root, owner));
      fs.symlinkSync(path.join(root, owner), path.join(root, `${owner}-link`), 'dir');
      for (const candidate of [owner, `${owner}-link`]) {
        for (const setting of ['PROJECTS', 'KEYS', 'RUNTIME_DATA', 'MAINTAINER_TOOLS', 'OPERATIONS']) {
          expect(() => resolveFilterestHomes(root, {
            [`FILTEREST_${setting}_HOME`]: `${candidate}/local-data`,
          })).toThrow(/outside Easelect source owners/);
        }
      }
    }
  });

  test('resolves a private source checkout outside the repo', () => {
    const root = temporaryRoot();
    const projectRoot = path.join(root, 'easelect');
    const keyRoot = path.join(root, 'protected-keys');
    fs.mkdirSync(path.join(projectRoot, '.git'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'VERSION_EASELECT'), 'test\n');
    writeSourceRoots(projectRoot);

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

  test('keeps private local homes and legacy flat public defaults distinct', () => {
    const root = temporaryRoot();
    const privateRoot = path.join(root, 'easelect');
    fs.mkdirSync(path.join(privateRoot, '.git'), { recursive: true });
    fs.writeFileSync(path.join(privateRoot, 'VERSION_EASELECT'), 'test\n');
    writeSourceRoots(privateRoot);

    const privateHomes = resolveFilterestHomes(privateRoot, {});
    expect(privateHomes.projectsHome).toBe(path.join(privateRoot, 'projects'));
    expect(privateHomes.projectsAppsHome).toBe(path.join(privateRoot, 'projects', 'apps'));
    expect(privateHomes.runtimeDataHome).toBe(path.join(privateRoot, 'data', 'runtime-data'));
    expect(privateHomes.maintainerToolsHome).toBe(
      path.join(privateRoot, 'data', 'maintainer-tools'),
    );
    expect(privateHomes.operationsHome).toBe(path.join(privateRoot, 'data', 'operations'));

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

  test('uses installation-root homes for the nested immutable app layout', () => {
    const projectRoot = path.join(temporaryRoot(), 'filterest');
    const appRoot = path.join(projectRoot, 'app');
    fs.mkdirSync(appRoot, { recursive: true });
    fs.writeFileSync(path.join(appRoot, 'go.mod'), 'module easelect\n');
    fs.writeFileSync(path.join(appRoot, 'VERSION_APP'), '8.42.2\n');

    const homes = resolveFilterestHomes(projectRoot, {});
    expect(homes.projectsHome).toBe(path.join(projectRoot, 'projects'));
    expect(homes.keysHome).toBe(path.join(projectRoot, 'keys'));
    expect(homes.runtimeDataHome).toBe(path.join(projectRoot, 'data', 'runtime'));
    expect(homes.maintainerToolsHome).toBe(
      path.join(projectRoot, 'data', 'maintainer_tools'),
    );
    expect(homes.operationsHome).toBe(path.join(projectRoot, 'data', 'operations'));
    expect(resolveEaselectPrivatePaths(projectRoot, {}).runtimeEnvFile).toBe(
      path.join(projectRoot, 'keys', 'filterest_runtime', 'runtime_environment.env'),
    );
  });

  test('rejects configured mutable homes inside nested app', () => {
    const projectRoot = path.join(temporaryRoot(), 'filterest');
    const appRoot = path.join(projectRoot, 'app');
    const configRoot = path.join(projectRoot, 'config');
    fs.mkdirSync(appRoot, { recursive: true });
    fs.mkdirSync(configRoot);
    fs.writeFileSync(path.join(appRoot, 'go.mod'), 'module easelect\n');
    fs.writeFileSync(path.join(appRoot, 'VERSION_APP'), '8.42.2\n');
    fs.writeFileSync(
      path.join(configRoot, 'filterest.paths'),
      `projects_home=${path.join(appRoot, 'projects')}\n`,
    );

    expect(() => resolveFilterestHomes(projectRoot, {})).toThrow(
      'outside the immutable app directory',
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
    writeSourceRoots(projectRoot);

    expect(() => resolveEaselectPrivatePaths(projectRoot, {
      EASELECT_KEY_ROOT: 'relative/keys',
    })).toThrow(/EASELECT_KEY_ROOT/);
    expect(() => resolveEaselectPrivatePaths(projectRoot, {
      EASELECT_KEY_ROOT: path.join(projectRoot, 'private'),
    })).toThrow(/EASELECT_KEY_ROOT/);
  });
});

describe('immutable composition source metadata', () => {
  test.each(['', '# empty\n', 'private/child\n', '../private\n', '/private\n',
    'private\nprivate\n', 'private;run\n'])('rejects unsafe list %j', (content) => {
    const root = privateMetadataRoot();
    fs.writeFileSync(path.join(root, 'filterest.source-roots'), content);
    expect(() => resolveFilterestHomes(root, { FILTEREST_SOURCE_ROOTS: 'safe' }))
      .toThrow(/filterest.source-roots/);
  });

  test.each(['missing', 'symlink', 'writable', 'directory'])(
    'cannot disable or redirect metadata: %s', (kind) => {
      const root = privateMetadataRoot();
      const metadata = path.join(root, 'filterest.source-roots');
      fs.unlinkSync(metadata);
      if (kind === 'symlink') {
        const target = path.join(root, 'operator-copy');
        fs.writeFileSync(target, 'safe\n');
        fs.symlinkSync(target, metadata);
      } else if (kind === 'writable') {
        fs.writeFileSync(metadata, 'safe\n');
        fs.chmodSync(metadata, 0o666);
      } else if (kind === 'directory') {
        fs.mkdirSync(metadata);
      }
      expect(() => resolveFilterestHomes(root, {})).toThrow(/filterest.source-roots/);
    },
  );

  test('uses generic composition names and retains ordinary homes', () => {
    const root = privateMetadataRoot();
    fs.writeFileSync(path.join(root, 'filterest.source-roots'),
      '# Source-owned names\nproduct\ncompanion\nincubator\n');
    for (const owner of ['product', 'companion', 'incubator']) {
      expect(() => resolveFilterestHomes(root, { FILTEREST_KEYS_HOME: owner + '/keys' }))
        .toThrow(/outside Easelect source owners/);
    }
    expect(resolveFilterestHomes(root, {}).keysHome).toBe(path.join(root, 'keys'));
  });

  test('standalone public roots do not read private composition metadata', () => {
    const root = temporaryRoot();
    fs.writeFileSync(path.join(root, 'filterest.source-roots'), '../invalid\n');
    expect(resolveFilterestHomes(root, {}).keysHome).toBe(path.join(root, 'filterest_keys'));
  });
});
