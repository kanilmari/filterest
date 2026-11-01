// matrix-test-selection.test.ts
// Proves K549 project selection, explicit full mode and fail-closed configuration.
// Connects the reduction/manual manifests to each project's complete ignore list.
// Keeps collection changes independently testable without starting Playwright.
import { afterEach, expect, test, vi } from 'vitest';
import { matrixTestIgnore, matrixProjectTestIgnore } from '../matrix-test-selection.cjs';
import reduction from '../matrix-reduction.json';
import manual from '../manual-specs.json';

const projects = ['mobile-card', 'mobile-bigcard', 'tablet-card', 'tablet-bigcard', 'desktop-card', 'desktop-bigcard'];
afterEach(() => vi.unstubAllEnvs());

test.each(projects)('%s keeps the complete manual/setup ignores in every mode', project => {
  for (const setup of [false, true]) {
    const base = matrixTestIgnore(setup);
    expect(base).toEqual([...manual, ...(setup ? [] : ['**/setup/**']), '**/global-setup.*', '**/*.test.ts']);
    expect(matrixProjectTestIgnore(project, setup, 'full')).toEqual(base);
    const dropped = Object.entries(reduction.one_project).filter(([, kept]) => kept !== project).map(([spec]) => spec);
    const expected = [...base, ...dropped, ...(project.endsWith('-bigcard') ? reduction.one_card_mode : [])];
    expect(matrixProjectTestIgnore(project, setup, 'reduced')).toEqual(expected);
    vi.stubEnv('FILTEREST_E2E_MATRIX', undefined);
    expect(matrixProjectTestIgnore(project, setup)).toEqual(expected);
    vi.stubEnv('FILTEREST_E2E_MATRIX', 'full');
    expect(matrixProjectTestIgnore(project, setup)).toEqual(base);
    expect(matrixProjectTestIgnore(project, setup, 'reduced')).toEqual(expected);
    for (const [spec, kept] of Object.entries(reduction.one_project)) {
      expect(expected.includes(spec)).toBe(project !== kept);
    }
  }
});

test.each(['ful', '', 'FULL', ' reduced '])('refuses the matrix mode %j', mode => {
  vi.stubEnv('FILTEREST_E2E_MATRIX', mode);
  expect(() => matrixProjectTestIgnore('desktop-card', false)).toThrow('Invalid FILTEREST_E2E_MATRIX');
});

test.each(['reduced', 'full'])('refuses unknown projects in %s mode', mode => {
  expect(() => matrixProjectTestIgnore('desktop-typo', false, mode)).toThrow('Unknown matrix project');
});
