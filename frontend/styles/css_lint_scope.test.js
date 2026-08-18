// css_lint_scope.test.js
// Verifies the production stylesheet roots covered by the repository CSS lint command.
// Bridges package.json's lint entry point and the browser frontend owned by this repository.
// Prevents a focused lint edit from silently narrowing the repository-wide safety net.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, test } from 'vitest';

const packageJsonPath = resolve(process.cwd(), 'package.json');

describe('CSS lint scope', () => {
    test('covers every maintained production stylesheet root and excludes generated bundles', () => {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
        const lintCommand = packageJson.scripts['lint:css'];

        expect(lintCommand).toContain('"frontend/**/*.css"');
        expect(lintCommand).not.toContain('apps/instance_control_panel');
        expect(lintCommand).not.toContain('apps/site-template');
        expect(lintCommand).toContain('--ignore-pattern "frontend/dist/**"');
    });
});
