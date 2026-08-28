/** Canonical mutable-test-root resolver for Playwright's TypeScript loader. */
import * as path from 'node:path';

export const FILTEREST_TEST_RUNTIME_ROOT_ENV = 'FILTEREST_TEST_RUNTIME_ROOT';

export type FilterestTestRuntimePaths = Readonly<{
  root: string;
  authDirectory: string;
  authStorageState: string;
  artifactRunRegistry: string;
  playwrightReport: string;
  playwrightResults: string;
  visualResults: string;
  visualGuardian: string;
  humanQa: string;
  aiAcceptance: string;
  computerUseAcceptance: string;
  browserAudits: string;
}>;

export type FilterestTestRuntimeOptions = {
  applicationRoot?: string;
  environment?: NodeJS.ProcessEnv | Record<string, string | undefined>;
};

const defaultApplicationRoot = path.resolve(__dirname, '../../..');

function isWithin(candidatePath: string, parentPath: string): boolean {
  const relative = path.relative(parentPath, candidatePath);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..');
}

export function resolveFilterestTestRuntimeRoot(
  {
    applicationRoot = defaultApplicationRoot,
    environment = process.env,
  }: FilterestTestRuntimeOptions = {},
): string {
  const resolvedApplicationRoot = path.resolve(applicationRoot);
  const productRoot = path.basename(resolvedApplicationRoot) === 'app'
    ? path.dirname(resolvedApplicationRoot)
    : resolvedApplicationRoot;
  const configuredRoot = String(environment[FILTEREST_TEST_RUNTIME_ROOT_ENV] || '').trim();
  const runtimeRoot = configuredRoot
    ? path.resolve(productRoot, configuredRoot)
    : path.join(productRoot, 'data', 'testing');

  if (isWithin(runtimeRoot, resolvedApplicationRoot)) {
    throw new Error(
      `${FILTEREST_TEST_RUNTIME_ROOT_ENV} must resolve outside the immutable app directory: `
      + resolvedApplicationRoot,
    );
  }
  return runtimeRoot;
}

export function resolveFilterestTestRuntimePaths(
  options: FilterestTestRuntimeOptions = {},
): FilterestTestRuntimePaths {
  const root = resolveFilterestTestRuntimeRoot(options);
  const authDirectory = path.join(root, 'e2e', '.auth');
  return Object.freeze({
    root,
    authDirectory,
    authStorageState: path.join(authDirectory, 'user.json'),
    artifactRunRegistry: path.join(authDirectory, 'artifact-runs'),
    playwrightReport: path.join(root, 'playwright-report'),
    playwrightResults: path.join(root, 'test-results'),
    visualResults: path.join(root, 'test-results-visual'),
    visualGuardian: path.join(root, 'test-results', 'visual_guardian'),
    humanQa: path.join(root, 'human_qa'),
    aiAcceptance: path.join(root, 'human_qa', 'ai_acceptance'),
    computerUseAcceptance: path.join(root, 'human_qa', 'computer_use'),
    browserAudits: path.join(root, 'browser_audits'),
  });
}
