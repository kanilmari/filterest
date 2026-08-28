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

  test('Vitest keeps both its cache and config-loader scratch work outside app', () => {
    const configSource = source('vitest.config.mjs');
    expect(configSource).toContain('resolveFilterestTestRuntimeRoot');
    expect(configSource).toContain('cacheDir:');

    const processConfigSource = source('server_tools/scripts/vitest_process_config.mjs');
    expect(processConfigSource).toContain('--configLoader=runner');
  });
});
