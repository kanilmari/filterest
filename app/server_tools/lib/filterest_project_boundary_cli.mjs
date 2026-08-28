// filterest_project_boundary_cli.mjs
// Prints the mutable project boundary resolved from immutable Filterest app source.
// Bridges shell QA launchers with the shared Node project-boundary implementation.
// Exists separately so Playwright can import the library without CLI module side effects.

import { resolveFilterestProjectBoundary } from './easelect_private_paths.mjs';

if (process.argv[2] !== '--print-project-boundary' || !process.argv[3]) {
  process.stderr.write(
    'usage: filterest_project_boundary_cli.mjs --print-project-boundary APP_ROOT\n',
  );
  process.exitCode = 2;
} else {
  process.stdout.write(
    `${resolveFilterestProjectBoundary(process.argv[3], process.env)}\n`,
  );
}
