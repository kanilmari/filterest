// matrix-test-selection.cjs
// Owns matrix ignores, including manual proofs that mutate operator files.
// Connects normal/setup-enabled Playwright discovery with the shared manual manifest.
// Keeps nightly and relevant-check selection from opting into native manual work.
const manualSpecs = require('./manual-specs.json');

exports.matrixTestIgnore = function matrixTestIgnore(includeSetupTests) {
  return [...manualSpecs, ...(includeSetupTests ? [] : ['**/setup/**']),
    '**/global-setup.*', '**/*.test.ts'];
};
