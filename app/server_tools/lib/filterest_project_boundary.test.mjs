// filterest_project_boundary.test.mjs
// Verifies the one project-folder rule shared by the browser target and path modules.
// Bridges standalone, Easelect-composed and linked checkouts with the boundary CLI.
// Exists so the Node tools decide standalone or Easelect as the shell and Python tools do.
// @vitest-environment node

import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, describe, expect, test } from 'vitest';
import projectBoundary from './filterest_project_boundary.cjs';

const {
  isEmbeddedEaselectApplication,
  isNestedFilterestInstallation,
  isPrivateEaselectSourceCheckout,
  resolveFilterestProjectBoundary,
} = projectBoundary;

const boundaryCli = fileURLToPath(new URL('./filterest_project_boundary_cli.mjs', import.meta.url));
const temporaryRoots = [];

function temporaryRoot() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'filterest-boundary-')));
  temporaryRoots.push(root);
  return root;
}

function markApplication(applicationRoot) {
  fs.mkdirSync(applicationRoot, { recursive: true });
  fs.writeFileSync(path.join(applicationRoot, 'go.mod'), 'module filterest\n');
  fs.writeFileSync(path.join(applicationRoot, 'VERSION_APP'), 'test\n');
}

function markEaselectWorkspace(workspaceRoot) {
  fs.mkdirSync(path.join(workspaceRoot, '.git'), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, 'VERSION_EASELECT'), 'test\n');
}

// Runs the shell launchers' boundary CLI without an inherited wrapper boundary.
function printedBoundary(applicationRoot, environment = {}) {
  const childEnvironment = { ...process.env };
  delete childEnvironment.FILTEREST_PROJECT_ROOT_OVERRIDE;
  const completed = spawnSync(
    process.execPath,
    [boundaryCli, '--print-project-boundary', applicationRoot],
    { encoding: 'utf8', env: { ...childEnvironment, ...environment } },
  );
  expect(completed.stderr).toBe('');
  expect(completed.status).toBe(0);
  return completed.stdout.trim();
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('project boundary in each layout', () => {
  test('a standalone installation is its own boundary', () => {
    const installationRoot = path.join(temporaryRoot(), 'filterest');
    const applicationRoot = path.join(installationRoot, 'app');
    markApplication(applicationRoot);

    expect(isNestedFilterestInstallation(installationRoot)).toBe(true);
    expect(resolveFilterestProjectBoundary(applicationRoot, {})).toBe(installationRoot);
    expect(isEmbeddedEaselectApplication(applicationRoot, {})).toBe(false);
    expect(printedBoundary(applicationRoot)).toBe(installationRoot);
  });

  test('an application nested in an Easelect workspace belongs to that workspace', () => {
    const easelectRoot = path.join(temporaryRoot(), 'easelect');
    const applicationRoot = path.join(easelectRoot, 'filterest', 'app');
    markEaselectWorkspace(easelectRoot);
    markApplication(applicationRoot);

    expect(isPrivateEaselectSourceCheckout(easelectRoot)).toBe(true);
    expect(resolveFilterestProjectBoundary(applicationRoot, {})).toBe(easelectRoot);
    expect(isEmbeddedEaselectApplication(applicationRoot, {})).toBe(true);
    expect(printedBoundary(applicationRoot)).toBe(easelectRoot);
  });

  test('a sibling checkout is composed only through the wrapper boundary', () => {
    const workspace = temporaryRoot();
    const easelectRoot = path.join(workspace, 'easelect');
    const installationRoot = path.join(workspace, 'filterest');
    const applicationRoot = path.join(installationRoot, 'app');
    markEaselectWorkspace(easelectRoot);
    markApplication(applicationRoot);
    const composed = { FILTEREST_PROJECT_ROOT_OVERRIDE: easelectRoot };

    expect(resolveFilterestProjectBoundary(applicationRoot, {})).toBe(installationRoot);
    expect(isEmbeddedEaselectApplication(applicationRoot, {})).toBe(false);
    expect(resolveFilterestProjectBoundary(applicationRoot, composed)).toBe(easelectRoot);
    expect(isEmbeddedEaselectApplication(applicationRoot, composed)).toBe(true);
    expect(printedBoundary(applicationRoot, composed)).toBe(easelectRoot);
  });

  test('a checkout reached through a link is judged where it really lies', () => {
    // Easelect links filterest -> ../filterest. The path through that link names
    // the sibling checkout, which stays standalone unless a wrapper binds it.
    const workspace = temporaryRoot();
    const easelectRoot = path.join(workspace, 'easelect');
    const installationRoot = path.join(workspace, 'filterest');
    markEaselectWorkspace(easelectRoot);
    markApplication(path.join(installationRoot, 'app'));
    fs.symlinkSync(path.join('..', 'filterest'), path.join(easelectRoot, 'filterest'));
    const linkedApplication = path.join(easelectRoot, 'filterest', 'app');

    expect(resolveFilterestProjectBoundary(linkedApplication, {})).toBe(installationRoot);
    expect(isEmbeddedEaselectApplication(linkedApplication, {})).toBe(false);
    expect(printedBoundary(linkedApplication)).toBe(installationRoot);
  });

  test('a workspace reached through a link resolves to the real workspace', () => {
    const workspace = temporaryRoot();
    const easelectRoot = path.join(workspace, 'easelect');
    markEaselectWorkspace(easelectRoot);
    markApplication(path.join(easelectRoot, 'filterest', 'app'));
    fs.symlinkSync(easelectRoot, path.join(workspace, 'workspace-link'));
    const linkedApplication = path.join(workspace, 'workspace-link', 'filterest', 'app');

    expect(resolveFilterestProjectBoundary(linkedApplication, {})).toBe(easelectRoot);
    expect(isEmbeddedEaselectApplication(linkedApplication, {})).toBe(true);
    expect(printedBoundary(linkedApplication)).toBe(easelectRoot);
  });
});

describe('checkout markers', () => {
  test('marker files must be regular files, while .git may be a worktree file', () => {
    const workspace = temporaryRoot();
    const directoryMarker = path.join(workspace, 'directory-marker');
    fs.mkdirSync(path.join(directoryMarker, '.git'), { recursive: true });
    fs.mkdirSync(path.join(directoryMarker, 'VERSION_EASELECT'));
    const worktree = path.join(workspace, 'worktree');
    fs.mkdirSync(worktree);
    fs.writeFileSync(path.join(worktree, '.git'), 'gitdir: /elsewhere\n');
    fs.writeFileSync(path.join(worktree, 'VERSION_EASELECT'), 'test\n');
    const versionOnly = path.join(workspace, 'version-only');
    fs.mkdirSync(versionOnly);
    fs.writeFileSync(path.join(versionOnly, 'VERSION_EASELECT'), 'test\n');
    const directoryApplication = path.join(workspace, 'directory-app');
    fs.mkdirSync(path.join(directoryApplication, 'app', 'go.mod'), { recursive: true });
    fs.writeFileSync(path.join(directoryApplication, 'app', 'VERSION_APP'), 'test\n');

    expect(isPrivateEaselectSourceCheckout(directoryMarker)).toBe(false);
    expect(isPrivateEaselectSourceCheckout(worktree)).toBe(true);
    expect(isPrivateEaselectSourceCheckout(versionOnly)).toBe(false);
    expect(isNestedFilterestInstallation(directoryApplication)).toBe(false);
  });

  test('a directory without the application markers is its own boundary', () => {
    const easelectRoot = path.join(temporaryRoot(), 'easelect');
    const applicationRoot = path.join(easelectRoot, 'filterest', 'app');
    markEaselectWorkspace(easelectRoot);
    fs.mkdirSync(applicationRoot, { recursive: true });

    expect(resolveFilterestProjectBoundary(applicationRoot, {})).toBe(applicationRoot);
    expect(isEmbeddedEaselectApplication(applicationRoot, {})).toBe(false);
  });

  test('a path that does not exist yet is its own boundary, as in Python', () => {
    const missingApplication = path.join(temporaryRoot(), 'missing', 'filterest', 'app');

    expect(resolveFilterestProjectBoundary(missingApplication, {})).toBe(missingApplication);
    expect(isEmbeddedEaselectApplication(missingApplication, {})).toBe(false);
  });
});
