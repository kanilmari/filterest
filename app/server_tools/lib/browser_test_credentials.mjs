// browser_test_credentials.mjs
// Resolves protected browser-test credentials and the configured login OTP.
// Bridges app-level QA tools with standalone or embedded project/key boundaries.
// Exists so no maintained browser tool reads or writes credentials below immutable app/.

import fs from 'fs';
import path from 'path';

import {
  isPrivateEaselectSourceCheckout,
  resolveEaselectPrivatePaths,
  resolveFilterestProjectBoundary,
} from './easelect_private_paths.mjs';

function isPathInside(candidatePath, parentPath) {
  const relativePath = path.relative(parentPath, candidatePath);
  return (
    relativePath === ''
    || (
      relativePath !== '..'
      && !relativePath.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relativePath)
    )
  );
}

// Resolves symlinks in the longest existing prefix while retaining a missing file tail.
function resolvePathThroughExistingAncestor(candidatePath) {
  let existingCandidate = path.resolve(candidatePath);
  const missingComponents = [];
  while (true) {
    try {
      const resolvedPrefix = fs.realpathSync.native(existingCandidate);
      return path.resolve(resolvedPrefix, ...missingComponents);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      const parentPath = path.dirname(existingCandidate);
      if (parentPath === existingCandidate) {
        throw error;
      }
      missingComponents.unshift(path.basename(existingCandidate));
      existingCandidate = parentPath;
    }
  }
}

// Rejects lexical and symlink-resolved credential paths below immutable app source.
function assertCredentialPathOutsideApplication(credentialPath, applicationRoot) {
  const normalizedApplicationRoot = path.resolve(applicationRoot);
  const normalizedCredentialPath = path.resolve(credentialPath);
  const resolvedApplicationRoot = resolvePathThroughExistingAncestor(
    normalizedApplicationRoot,
  );
  const resolvedCredentialPath = resolvePathThroughExistingAncestor(
    normalizedCredentialPath,
  );
  if (
    isPathInside(normalizedCredentialPath, normalizedApplicationRoot)
    || isPathInside(resolvedCredentialPath, resolvedApplicationRoot)
  ) {
    throw new Error(
      'Browser-test credentials must remain outside the immutable Filterest app directory.',
    );
  }
}

// Refuses existing links and non-regular credential targets before reads or writes.
function assertCredentialFileTarget(credentialPath) {
  let targetStatus;
  try {
    targetStatus = fs.lstatSync(credentialPath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return;
    }
    throw error;
  }
  if (targetStatus.isSymbolicLink()) {
    throw new Error('Refusing browser-test credentials through a symbolic link.');
  }
  if (!targetStatus.isFile()) {
    throw new Error('Browser-test credential target must be a regular file.');
  }
}

/** Resolves the standalone sibling or embedded Easelect credential file safely. */
export function resolveBrowserTestCredentialFilePath({
  applicationRoot,
  environment = process.env,
} = {}) {
  if (!applicationRoot) {
    throw new Error('applicationRoot is required for browser-test credentials.');
  }
  const configuredPath = String(
    environment.FILTEREST_TEST_CREDENTIAL_FILE || '',
  ).trim();
  const projectBoundary = resolveFilterestProjectBoundary(
    applicationRoot,
    environment,
  );
  const defaultPath = isPrivateEaselectSourceCheckout(projectBoundary)
    ? path.join(projectBoundary, 'dev_env_test_creds.txt')
    : path.join(
      projectBoundary,
      'keys',
      'filterest_runtime',
      'dev_env_test_creds.txt',
    );
  const credentialPath = path.resolve(configuredPath || defaultPath);
  assertCredentialPathOutsideApplication(credentialPath, applicationRoot);
  assertCredentialFileTarget(credentialPath);
  return credentialPath;
}

/** Writes E2E identities owner-only without following a credential-file symlink. */
export function writeBrowserTestCredentialsFile({
  applicationRoot,
  contents,
  environment = process.env,
}) {
  const credentialPath = resolveBrowserTestCredentialFilePath({
    applicationRoot,
    environment,
  });
  const projectBoundary = resolveFilterestProjectBoundary(
    applicationRoot,
    environment,
  );
  const standaloneDefault = (
    !isPrivateEaselectSourceCheckout(projectBoundary)
    && credentialPath === path.join(
      projectBoundary,
      'keys',
      'filterest_runtime',
      'dev_env_test_creds.txt',
    )
  );
  const credentialParent = path.dirname(credentialPath);
  const parentAlreadyExisted = fs.existsSync(credentialParent);
  if (!parentAlreadyExisted) {
    fs.mkdirSync(credentialParent, { recursive: true, mode: 0o700 });
    fs.chmodSync(credentialParent, 0o700);
  }
  const credentialParentMode = fs.statSync(credentialParent).mode & 0o777;
  if (parentAlreadyExisted && (credentialParentMode & 0o002) !== 0) {
    throw new Error(
      'Browser-test credential parent is writable by other users; choose a protected directory.',
    );
  }
  if (standaloneDefault && credentialParentMode !== 0o700) {
    throw new Error(
      'The standalone browser-test credential directory must have mode 0700; fix it explicitly before retrying.',
    );
  }
  if (!parentAlreadyExisted && credentialParentMode !== 0o700) {
    throw new Error('New browser-test credential directory must have mode 0700.');
  }

  assertCredentialPathOutsideApplication(credentialPath, applicationRoot);
  assertCredentialFileTarget(credentialPath);
  const noFollowFlag = fs.constants.O_NOFOLLOW;
  if (!Number.isInteger(noFollowFlag)) {
    throw new Error('This platform cannot safely create a no-follow credential file.');
  }
  const fileDescriptor = fs.openSync(
    credentialPath,
    fs.constants.O_WRONLY
      | fs.constants.O_CREAT
      | noFollowFlag,
    0o600,
  );
  try {
    if (!fs.fstatSync(fileDescriptor).isFile()) {
      throw new Error('Browser-test credential target must be a regular file.');
    }
    fs.fchmodSync(fileDescriptor, 0o600);
    fs.ftruncateSync(fileDescriptor, 0);
    fs.writeFileSync(fileDescriptor, contents, { encoding: 'utf8' });
    fs.fsyncSync(fileDescriptor);
  } finally {
    fs.closeSync(fileDescriptor);
  }
  const writtenStatus = fs.lstatSync(credentialPath);
  if (writtenStatus.isSymbolicLink() || !writtenStatus.isFile()) {
    throw new Error('Browser-test credential target changed during its protected write.');
  }
  return credentialPath;
}

/** Reads the reserved browser-test administrator without logging secret values. */
export function loadBrowserTestCredentials({
  applicationRoot,
  environment = process.env,
} = {}) {
  const credentialPath = resolveBrowserTestCredentialFilePath({
    applicationRoot,
    environment,
  });
  const values = new Map();
  for (const line of fs.readFileSync(credentialPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([^=#]+)=(.*)$/);
    if (match) {
      values.set(match[1].trim(), match[2].trim());
    }
  }
  const username = (
    values.get('TEST_ADMIN_USER')
    || values.get('FILTEREST_API_USERNAME')
    || ''
  );
  const password = (
    values.get('TEST_ADMIN_PASS')
    || values.get('FILTEREST_API_PASSWORD')
    || ''
  );
  if (!username || !password) {
    throw new Error(
      'Missing browser-test username or password in the configured credential file.',
    );
  }
  return { username, password };
}

/** Resolves the explicit browser-test OTP from process or protected runtime env files. */
export function resolveBrowserTestOtpCode({
  applicationRoot,
  developmentEnvFile,
  environment = process.env,
  runtimeEnvFile,
} = {}) {
  if (!applicationRoot) {
    throw new Error('applicationRoot is required for browser-test OTP resolution.');
  }
  const processOtp = String(environment.LOGIN_OTP_CODE || '').trim();
  if (processOtp) {
    return processOtp;
  }
  const projectBoundary = resolveFilterestProjectBoundary(
    applicationRoot,
    environment,
  );
  const resolvedPaths = resolveEaselectPrivatePaths(projectBoundary, environment);
  const candidateFiles = [developmentEnvFile || resolvedPaths.developmentEnvFile];
  if (runtimeEnvFile || !developmentEnvFile) {
    candidateFiles.push(runtimeEnvFile || resolvedPaths.runtimeEnvFile);
  }
  for (const candidateFile of candidateFiles) {
    if (!fs.existsSync(candidateFile)) {
      continue;
    }
    const otpLine = fs.readFileSync(candidateFile, 'utf8')
      .split(/\r?\n/)
      .find((line) => line.trimStart().startsWith('LOGIN_OTP_CODE='));
    const fileOtp = otpLine
      ? otpLine.slice(otpLine.indexOf('=') + 1).trim()
      : '';
    if (fileOtp) {
      return fileOtp;
    }
  }
  throw new Error(
    'Missing LOGIN_OTP_CODE in the process or resolved protected runtime environment.',
  );
}
