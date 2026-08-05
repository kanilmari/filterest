// easelect_private_paths.mjs
// Resolves Easelect/Filterest env and TLS files from a dynamic protected key home.
// Bridges Node/Playwright tooling with the same contract used by shell and Go startup.
// Exists so source tooling works without secret-bearing files or symlinks in repo root.

import fs from 'fs';
import path from 'path';

export function isPrivateEaselectSourceCheckout(projectRoot) {
  return (
    fs.existsSync(path.join(projectRoot, '.git'))
    && fs.existsSync(path.join(projectRoot, 'VERSION_EASELECT'))
  );
}

const SUPPORTED_PATH_KEYS = new Set(['schema_version', 'projects_home', 'keys_home']);

function readPathsFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  if (
    path.basename(filePath) === 'filterest.paths.local'
    && (fs.statSync(filePath).mode & 0o022) !== 0
  ) {
    throw new Error(
      `${filePath}: local path locator must not be writable by group or others`,
    );
  }
  const values = {};
  fs.readFileSync(filePath, 'utf8').split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      return;
    }
    const separator = line.indexOf('=');
    if (separator < 0) {
      throw new Error(`${filePath}:${index + 1}: expected key=value`);
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!SUPPORTED_PATH_KEYS.has(key)) {
      throw new Error(`${filePath}:${index + 1}: unsupported key "${key}"`);
    }
    if (Object.hasOwn(values, key)) {
      throw new Error(`${filePath}:${index + 1}: duplicate key "${key}"`);
    }
    values[key] = value;
  });
  if (values.schema_version && values.schema_version !== '1') {
    throw new Error(`${filePath}: unsupported schema_version "${values.schema_version}"`);
  }
  return values;
}

function pathContainsPath(parentPath, childPath) {
  const relativePath = path.relative(parentPath, childPath);
  return (
    relativePath === ''
    || (relativePath !== '..' && !relativePath.startsWith(`..${path.sep}`))
  );
}

function resolveHome(projectRoot, rawValue, label) {
  const value = String(rawValue || '').trim();
  if (!value) {
    throw new Error(`${label} must not be empty`);
  }
  if (Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint < 32 || codePoint === 127;
  })) {
    throw new Error(`${label} must not contain control characters`);
  }
  if (['*', '?', '[', ']', '\\'].some((character) => value.includes(character))) {
    throw new Error(
      `${label} must not contain pattern characters (*, ?, [, ], or backslash)`,
    );
  }
  const resolved = fs.realpathSync.native(
    closestExistingPath(path.isAbsolute(value) ? value : path.join(projectRoot, value)),
  );
  const unresolvedSuffix = path.relative(
    closestExistingPath(path.isAbsolute(value) ? value : path.join(projectRoot, value)),
    path.resolve(path.isAbsolute(value) ? value : path.join(projectRoot, value)),
  );
  const normalized = path.resolve(resolved, unresolvedSuffix);
  if (normalized === path.parse(normalized).root) {
    throw new Error(`${label} must not resolve to the filesystem root`);
  }
  if (normalized === projectRoot) {
    throw new Error(`${label} must not resolve to the checkout root`);
  }
  if (pathContainsPath(path.join(projectRoot, '.git'), normalized)) {
    throw new Error(`${label} must not resolve inside .git`);
  }
  return normalized;
}

function closestExistingPath(candidatePath) {
  let current = path.resolve(candidatePath);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return current;
}

export function resolveFilterestHomes(projectRoot, environment = process.env) {
  const normalizedProjectRoot = fs.realpathSync.native(path.resolve(projectRoot));
  const privateSource = isPrivateEaselectSourceCheckout(normalizedProjectRoot);
  const values = {
    projects_home: privateSource
      ? path.resolve(normalizedProjectRoot, '..', 'filterest-projects')
      : 'filterest_projects',
    keys_home: privateSource
      ? path.resolve(normalizedProjectRoot, '..', 'filterest_keys')
      : 'filterest_keys',
  };
  const configured = new Set();
  for (const configName of ['filterest.paths', 'filterest.paths.local']) {
    const fileValues = readPathsFile(path.join(normalizedProjectRoot, configName));
    for (const key of ['projects_home', 'keys_home']) {
      if (Object.hasOwn(fileValues, key)) {
        values[key] = fileValues[key];
        configured.add(key);
      }
    }
  }
  const projectsOverride = String(environment.FILTEREST_PROJECTS_HOME || '').trim();
  const keysOverride = String(environment.FILTEREST_KEYS_HOME || '').trim();
  if (projectsOverride) {
    values.projects_home = projectsOverride;
    configured.add('projects_home');
  }
  if (keysOverride) {
    values.keys_home = keysOverride;
    configured.add('keys_home');
  }

  const legacyKeyRoot = String(environment.EASELECT_KEY_ROOT || '').trim();
  if (privateSource && legacyKeyRoot) {
    if (!path.isAbsolute(legacyKeyRoot)) {
      throw new Error('invalid EASELECT_KEY_ROOT: path must be absolute');
    }
    const legacyResolved = resolveHome(
      normalizedProjectRoot,
      legacyKeyRoot,
      'EASELECT_KEY_ROOT',
    );
    if (pathContainsPath(normalizedProjectRoot, legacyResolved)) {
      throw new Error('invalid EASELECT_KEY_ROOT: path must stay outside the Easelect repository');
    }
    if (
      configured.has('keys_home')
      && resolveHome(normalizedProjectRoot, values.keys_home, 'keys_home') !== legacyResolved
    ) {
      throw new Error('EASELECT_KEY_ROOT conflicts with the configured keys_home');
    }
    values.keys_home = legacyResolved;
    configured.add('keys_home');
  }

  const projectsHome = resolveHome(
    normalizedProjectRoot,
    values.projects_home,
    'projects_home',
  );
  const keysHome = resolveHome(normalizedProjectRoot, values.keys_home, 'keys_home');
  if (
    pathContainsPath(projectsHome, keysHome)
    || pathContainsPath(keysHome, projectsHome)
  ) {
    throw new Error('projects_home and keys_home must not be equal or nested');
  }
  return {
    projectRoot: normalizedProjectRoot,
    projectsHome,
    keysHome,
    projectsHomeConfigured: configured.has('projects_home'),
    keysHomeConfigured: configured.has('keys_home'),
  };
}

// Returns derived internal paths while retaining root-local runtime compatibility.
export function resolveEaselectPrivatePaths(
  projectRoot,
  environment = process.env,
) {
  const homes = resolveFilterestHomes(projectRoot, environment);
  const privateSource = isPrivateEaselectSourceCheckout(homes.projectRoot);
  if (!privateSource && !homes.keysHomeConfigured) {
    return {
      runtimeEnvFile: path.join(homes.projectRoot, '.env'),
      developmentEnvFile: path.join(homes.projectRoot, 'dev_env.txt'),
      tlsCertificateFile: path.join(homes.projectRoot, 'dev-cert.crt'),
      tlsPrivateKeyFile: path.join(homes.projectRoot, 'dev-cert.key'),
    };
  }

  const profileName = privateSource ? 'easelect_development' : 'filterest_runtime';
  const developmentRoot = path.join(homes.keysHome, profileName);

  return {
    runtimeEnvFile: path.join(developmentRoot, 'runtime_environment.env'),
    developmentEnvFile: path.join(developmentRoot, 'development_environment.env'),
    tlsCertificateFile: path.join(
      developmentRoot,
      'local_tls_certificate',
      'localhost_certificate.crt',
    ),
    tlsPrivateKeyFile: path.join(
      developmentRoot,
      'local_tls_certificate',
      'localhost_private_key.key',
    ),
  };
}
