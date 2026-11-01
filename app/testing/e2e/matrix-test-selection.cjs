// matrix-test-selection.cjs
// Owns complete matrix ignores and K549's per-project reduction.
// Connects normal/setup-enabled discovery to the manual and reduction manifests.
// Keeps repeated runs and native manual proofs out of ordinary matrix selection.
const manualSpecs = require('./manual-specs.json');
const reduction = require('./matrix-reduction.json');
const projects = new Set(['mobile', 'tablet', 'desktop'].flatMap(width =>
  [`${width}-card`, `${width}-bigcard`]));

exports.matrixTestIgnore = function matrixTestIgnore(includeSetupTests) {
  return [...manualSpecs, ...(includeSetupTests ? [] : ['**/setup/**']),
    '**/global-setup.*', '**/*.test.ts'];
};

// Project ignores replace Playwright's top-level ignores: carry the whole list.
// K549 removes repeated runs by default; full preserves the six-project baseline.
exports.matrixProjectTestIgnore = function matrixProjectTestIgnore(project, includeSetupTests,
  mode = process.env.FILTEREST_E2E_MATRIX) {
  if (mode !== undefined && mode !== 'reduced' && mode !== 'full') {
    throw new Error(`Invalid FILTEREST_E2E_MATRIX: ${JSON.stringify(mode)}; use reduced or full`);
  }
  if (!projects.has(project)) throw new Error(`Unknown matrix project: ${project}`);
  const ignores = exports.matrixTestIgnore(includeSetupTests);
  if (mode === 'full') return ignores;
  return [...ignores,
    ...Object.entries(reduction.one_project).filter(([, kept]) => kept !== project).map(([spec]) => spec),
    ...(project.endsWith('-bigcard') ? reduction.one_card_mode : [])];
};
