// vite.config.test.js
// Verifies dev-server routing decisions that run before the SPA bootstraps.
// Bridges Vite root requests, backend auth-mode state, and forced-login redirects.
// Exists so localhost:5173/ mirrors the backend root login-to-browse contract.
// @vitest-environment node

import { afterEach, describe, expect, test } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import viteConfig, {
  isRootDocumentRequest,
  renderGoTemplateForDev,
  resolveViteProjectLayout,
  shouldRedirectDevRootToStandaloneLogin,
} from './vite.config.mjs';
import { resolveRuntimeTestAliases } from '../vitest.config.mjs';

const temporaryRoots = [];

function temporaryRoot() {
  const root = mkdtempSync(resolve(tmpdir(), 'filterest-vite-layout-'));
  temporaryRoots.push(root);
  return root;
}

function markNestedApplication(applicationRoot) {
  mkdirSync(applicationRoot, { recursive: true });
  writeFileSync(resolve(applicationRoot, 'go.mod'), 'module filterest\n');
  writeFileSync(resolve(applicationRoot, 'VERSION_APP'), 'test\n');
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function request(method, url) {
  return { method, url };
}

describe('vite forced-login root redirect helpers', () => {
  test('matches plain root document GET and HEAD requests only', () => {
    expect(isRootDocumentRequest(request('GET', '/'))).toBe(true);
    expect(isRootDocumentRequest(request('HEAD', '/'))).toBe(true);
    expect(isRootDocumentRequest(request('POST', '/'))).toBe(false);
    expect(isRootDocumentRequest(request('GET', '/login'))).toBe(false);
    expect(isRootDocumentRequest(request('GET', '/service_catalog'))).toBe(false);
  });

  test('keeps explicit SPA auth-entry roots out of the standalone redirect', () => {
    expect(isRootDocumentRequest(request('GET', '/?login-entry=1'))).toBe(false);
    expect(isRootDocumentRequest(request('GET', '/?register-entry=1'))).toBe(false);
  });

  test('redirects only unauthenticated forced-login auth modes', () => {
    expect(shouldRedirectDevRootToStandaloneLogin({
      login_required_for_browse: true,
      needs_button: 'login',
    })).toBe(true);
    expect(shouldRedirectDevRootToStandaloneLogin({
      login_required_for_browse: true,
      needs_button: 'logout',
    })).toBe(false);
    expect(shouldRedirectDevRootToStandaloneLogin({
      login_required_for_browse: false,
      needs_button: 'login',
    })).toBe(false);
    expect(shouldRedirectDevRootToStandaloneLogin(null)).toBe(false);
  });
});

describe('vite Go-template development rendering', () => {
  test('selects only matching equality-conditional defaults', () => {
    const html = [
      '<input value="dev" {{if eq .Environment "dev"}}checked{{end}}>',
      '<input value="test" {{if eq .Environment "test"}}checked{{end}}>',
      '<input value="none" {{if eq .VerificationMethod "none"}}checked{{end}}>',
      '<input value="email" {{if eq .VerificationMethod "email"}}checked{{end}}>',
    ].join('');

    expect(renderGoTemplateForDev(html)).toBe([
      '<input value="dev" checked>',
      '<input value="test" >',
      '<input value="none" checked>',
      '<input value="email" >',
    ].join(''));
  });
});

describe('vite backend-owned asset routing', () => {
  test('proxies metadata symbols through the Go backend in development', () => {
    const config = viteConfig({ command: 'serve' });

    expect(config.server.proxy).toHaveProperty('/symbol-assets');
  });

  test('uses the selected installation layout for production bundle output', () => {
    const config = viteConfig({ command: 'build' });
    const frontendRoot = fileURLToPath(new URL('.', import.meta.url));

    const layout = resolveViteProjectLayout(resolve(frontendRoot, '..'));
    expect(config.build.outDir).toBe(layout.buildOutDir);
  });
});

describe('vite project layout resolution', () => {
  test('uses outer Easelect backend and legacy storage for a private composition', () => {
    const easelectRoot = resolve(temporaryRoot(), 'easelect');
    const applicationRoot = resolve(easelectRoot, 'filterest', 'app');
    mkdirSync(resolve(easelectRoot, '.git'), { recursive: true });
    writeFileSync(resolve(easelectRoot, 'VERSION_EASELECT'), 'test\n');
    markNestedApplication(applicationRoot);

    expect(resolveViteProjectLayout(applicationRoot, {})).toEqual({
      projectRoot: easelectRoot,
      privateEaselect: true,
      nestedStandalone: false,
      backendPort: 8082,
      defaultSiteName: 'Easelect',
      viteCacheDir: resolve(easelectRoot, 'node_modules', '.vite'),
      buildOutDir: resolve(applicationRoot, 'frontend', 'dist'),
    });
  });

  test('uses installation backend and data storage for nested standalone Filterest', () => {
    const installationRoot = resolve(temporaryRoot(), 'filterest');
    const applicationRoot = resolve(installationRoot, 'app');
    markNestedApplication(applicationRoot);

    expect(resolveViteProjectLayout(applicationRoot, {})).toEqual({
      projectRoot: installationRoot,
      privateEaselect: false,
      nestedStandalone: true,
      backendPort: 8100,
      defaultSiteName: 'Filterest',
      viteCacheDir: resolve(
        installationRoot,
        'data',
        'runtime',
        'node',
        'vite-cache',
      ),
      buildOutDir: resolve(
        installationRoot,
        'data',
        'runtime',
        'node',
        'frontend-dist',
      ),
    });
  });

  test('keeps legacy flat public roots on their root-local storage contract', () => {
    const publicRoot = resolve(temporaryRoot(), 'legacy-filterest');
    mkdirSync(publicRoot, { recursive: true });
    writeFileSync(resolve(publicRoot, 'VERSION_APP'), 'test\n');

    expect(resolveViteProjectLayout(publicRoot, {})).toEqual({
      projectRoot: publicRoot,
      privateEaselect: false,
      nestedStandalone: false,
      backendPort: 8100,
      defaultSiteName: 'Filterest',
      viteCacheDir: resolve(publicRoot, 'node_modules', '.vite'),
      buildOutDir: resolve(publicRoot, 'frontend', 'dist'),
    });
  });

  test('honors an explicit public installation boundary inside Easelect source', () => {
    const easelectRoot = resolve(temporaryRoot(), 'easelect');
    const installationRoot = resolve(easelectRoot, 'filterest');
    const applicationRoot = resolve(installationRoot, 'app');
    mkdirSync(resolve(easelectRoot, '.git'), { recursive: true });
    writeFileSync(resolve(easelectRoot, 'VERSION_EASELECT'), 'test\n');
    markNestedApplication(applicationRoot);

    const layout = resolveViteProjectLayout(applicationRoot, {
      FILTEREST_PROJECT_ROOT_OVERRIDE: installationRoot,
    });

    expect(layout.projectRoot).toBe(installationRoot);
    expect(layout.backendPort).toBe(8100);
    expect(layout.viteCacheDir).toBe(
      resolve(installationRoot, 'data/runtime/node/vite-cache'),
    );
    expect(layout.buildOutDir).toBe(
      resolve(installationRoot, 'data/runtime/node/frontend-dist'),
    );
  });

  test('lets reviewed release builders explicitly write the staged app bundle', () => {
    const installationRoot = resolve(temporaryRoot(), 'filterest');
    const applicationRoot = resolve(installationRoot, 'app');
    markNestedApplication(applicationRoot);

    const layout = resolveViteProjectLayout(applicationRoot, {
      FILTEREST_PROJECT_ROOT_OVERRIDE: applicationRoot,
    });

    expect(layout.projectRoot).toBe(applicationRoot);
    expect(layout.nestedStandalone).toBe(false);
    expect(layout.buildOutDir).toBe(resolve(applicationRoot, 'frontend/dist'));
    expect(layout.viteCacheDir).toBe(resolve(applicationRoot, 'node_modules/.vite'));
  });

  test('resolves the checked-out source structure without mutable app paths', () => {
    const frontendRoot = fileURLToPath(new URL('.', import.meta.url));
    const applicationRoot = resolve(frontendRoot, '..');
    const installationRoot = resolve(applicationRoot, '..');
    const possibleEaselectRoot = resolve(installationRoot, '..');
    const embedded = (
      existsSync(resolve(possibleEaselectRoot, '.git'))
      && existsSync(resolve(possibleEaselectRoot, 'VERSION_EASELECT'))
    );
    const layout = resolveViteProjectLayout(applicationRoot, {});

    expect(layout.projectRoot).toBe(
      embedded ? possibleEaselectRoot : installationRoot,
    );
    expect(layout.backendPort).toBe(embedded ? 8082 : 8100);
    expect(layout.viteCacheDir.startsWith(`${applicationRoot}/`)).toBe(false);
    expect(layout.buildOutDir).toBe(
      embedded
        ? resolve(applicationRoot, 'frontend', 'dist')
        : resolve(installationRoot, 'data/runtime/node/frontend-dist'),
    );
  });
});


describe('Vitest installation-owned Node dependencies', () => {
  test('resolves the bare test imports from an explicit external runtime', () => {
    const runtime = temporaryRoot();
    const modules = resolve(runtime, 'node_modules');
    for (const name of ['glob', '@playwright/test']) {
      const packageRoot = resolve(modules, name);
      mkdirSync(packageRoot, { recursive: true });
      writeFileSync(resolve(packageRoot, 'package.json'), JSON.stringify({
        name, main: 'fixture.cjs',
      }));
      writeFileSync(resolve(packageRoot, 'fixture.cjs'), 'module.exports = {};');
    }
    const aliases = resolveRuntimeTestAliases({ FILTEREST_NODE_MODULES_ROOT: modules });
    expect(aliases).toEqual([
      { find: 'glob', replacement: resolve(modules, 'glob/fixture.cjs') },
      { find: '@playwright/test', replacement: resolve(modules, '@playwright/test/fixture.cjs') },
    ]);
    expect(existsSync(resolve(runtime, 'app/node_modules'))).toBe(false);
  });

  test('keeps ordinary lookup without an override and rejects relative runtime roots', () => {
    expect(resolveRuntimeTestAliases({})).toEqual([]);
    expect(() => resolveRuntimeTestAliases({
      FILTEREST_NODE_MODULES_ROOT: 'data/runtime/node/node_modules',
    })).toThrow('must be an absolute path');
  });
});
