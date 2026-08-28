// test-runtime-contract-static.test.ts
// Verifies static contracts for installation-owned browser-test runtime state.
// Bridges Playwright configuration, lifecycle helpers, and immutable application boundaries.
// Exists so test artifacts cannot drift back into the maintained app source.
// @vitest-environment node

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, test } from 'vitest';

const applicationRoot = path.resolve(__dirname, '../../..');

function source(relativePath: string): string {
  return fs.readFileSync(path.join(applicationRoot, relativePath), 'utf8');
}

describe('immutable app test-output contract', () => {
  test('Playwright configs route output, traces, reports, and auth state through the shared root', () => {
    for (const relativePath of [
      'playwright.config.ts',
      'playwright.visual.config.ts',
      'testing/e2e/instance-cookie-isolation.playwright.config.ts',
    ]) {
      const configSource = source(relativePath);
      expect(configSource).toContain('resolveFilterestTestRuntimePaths');
      expect(configSource).not.toMatch(/outputDir:\s*['"]\.?\.?\/testing\//);
      expect(configSource).not.toMatch(/storageState:\s*['"]\.?\/?testing\//);
    }
    expect(source('playwright.config.ts')).not.toContain("outputFolder: 'testing/");
  });

  test('setup, teardown, registry, and Visual Guardian do not write below app/testing', () => {
    for (const relativePath of [
      'testing/e2e/global-setup.ts',
      'testing/e2e/global-teardown.ts',
      'testing/e2e/helpers/test-artifact-run-registry.ts',
      'testing/visual_guardian/visual_guardian_helpers.ts',
    ]) {
      expect(source(relativePath)).toContain('resolveFilterestTestRuntimePath');
      expect(source(relativePath)).not.toContain("path.join(__dirname, '.auth'");
    }

    const guardianSource = source('server_tools/scripts/guardian.sh');
    expect(guardianSource).toContain('FILTEREST_TEST_RUNTIME_ROOT');
    expect(guardianSource).not.toContain('$PROJECT_ROOT/testing/test-results');

    const analyzerSource = source('testing/visual_guardian/analyze_ui.py');
    expect(analyzerSource).toContain('FILTEREST_TEST_RUNTIME_ROOT');
    expect(analyzerSource).not.toContain(
      'REPORT_FILE = "testing/test-results/visual_guardian/report.json"',
    );
  });

  test('public browser and acceptance runners use the shared runtime-path helper', () => {
    for (const relativePath of [
      'server_tools/scripts/human_qa.mjs',
      'server_tools/scripts/ai_acceptance_test.mjs',
      'server_tools/scripts/computer_use_acceptance_test.mjs',
      'server_tools/scripts/browser_audit.mjs',
    ]) {
      const runnerSource = source(relativePath);
      expect(runnerSource).toContain('resolveFilterestTestRuntimePaths');
      expect(runnerSource).not.toContain('agent_tasks/_artifacts');
      expect(runnerSource).not.toContain('path.join(repoRoot, "testing/e2e/.auth/user.json")');
    }
  });

  test('browser tools resolve credentials and OTP outside immutable app source', () => {
    for (const relativePath of [
      'server_tools/scripts/ai_acceptance_runner.mjs',
      'server_tools/scripts/human_qa.mjs',
      'server_tools/scripts/computer_use_acceptance_runner.mjs',
    ]) {
      const runnerSource = source(relativePath);
      expect(runnerSource).toContain('browser_test_credentials.mjs');
      expect(runnerSource).not.toContain('dev_env_test_creds.txt');
      expect(runnerSource).not.toContain('334726');
    }

    const authSource = source('testing/e2e/helpers/auth.ts');
    expect(authSource).toContain('browser_test_credentials.mjs');
    expect(authSource).not.toContain("path.join(projectRoot, 'dev_env_test_creds.txt')");

    const computerUseSource = source(
      'server_tools/scripts/computer_use_acceptance_test.mjs',
    );
    expect(computerUseSource).toContain('resolveFilterestProjectBoundary');
    expect(computerUseSource).not.toContain('resolveEaselectPrivatePaths(repoRoot)');

    for (const relativePath of [
      'server_tools/scripts/safe_test.sh',
      'server_tools/scripts/guardian.sh',
    ]) {
      const shellSource = source(relativePath);
      expect(shellSource).toContain('--print-project-boundary "$APPLICATION_ROOT"');
      expect(shellSource).toContain('cd "$APPLICATION_ROOT"');
      expect(shellSource).not.toContain('source "$PROJECT_ROOT/server_tools/ctl/lib/resolve_env.sh"');
    }
  });

  test('public QA and browser tools resolve the standalone or embedded local origin structurally', () => {
    const targetSource = source('server_tools/scripts/local_filterest_target.cjs');
    expect(targetSource).toContain('.git');
    expect(targetSource).toContain('VERSION_EASELECT');
    expect(targetSource).toContain('https://localhost:8100');
    expect(targetSource).toContain('https://localhost:8082');

    for (const relativePath of [
      'playwright.config.ts',
      'playwright.visual.config.ts',
      'testing/e2e/global-setup.ts',
      'testing/e2e/global-teardown.ts',
    ]) {
      expect(source(relativePath)).toContain('resolveLocalFilterestBaseUrl');
      expect(source(relativePath)).not.toContain("'https://localhost:8082'");
    }

    for (const relativePath of [
      'server_tools/scripts/human_qa.mjs',
      'server_tools/scripts/ai_acceptance_test.mjs',
      'server_tools/scripts/computer_use_acceptance_test.mjs',
      'server_tools/scripts/computer_use_acceptance_runner.mjs',
      'server_tools/scripts/browser_audit.mjs',
    ]) {
      expect(source(relativePath)).toContain('resolveLocalFilterestBaseUrl');
    }

    const qaSource = source('server_tools/scripts/qa.sh');
    expect(qaSource).toContain('--print-base-url "$PROJECT_ROOT"');
    expect(qaSource).toContain('export FILTEREST_E2E_BASE_URL="$QA_BASE_URL"');
    expect(qaSource).not.toContain('curl -k -s -I https://localhost:8082');

    const browserAuditGuide = source(
      'docs/instructions_and_documentation/Browser_Audit_Agent.md',
    );
    expect(browserAuditGuide).toContain('https://localhost:8100');
    expect(browserAuditGuide).not.toContain('https://localhost:8082');
  });

  test('Vitest keeps both its cache and config-loader scratch work outside app', () => {
    const configSource = source('vitest.config.mjs');
    expect(configSource).toContain('resolveFilterestTestRuntimeRoot');
    expect(configSource).toContain('cacheDir:');

    const processConfigSource = source('server_tools/scripts/vitest_process_config.mjs');
    expect(processConfigSource).toContain('--configLoader=runner');
  });

  test('storage maintenance specs use the layout-aware mutable roots', () => {
    for (const relativePath of [
      'testing/e2e/T_admin/T11_storage_root_cleanup.spec.ts',
      'testing/e2e/T_admin/T12_storage_deleted_prune.spec.ts',
    ]) {
      const specSource = source(relativePath);
      expect(specSource).toContain('resolveFilterestStorageRuntimePaths');
      expect(specSource).not.toMatch(/path\.join\(['"]storage(?:_deleted)?['"]/);
    }
  });
});
