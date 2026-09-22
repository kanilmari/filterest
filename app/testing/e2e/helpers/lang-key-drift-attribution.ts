/**
 * lang-key-drift-attribution.ts
 *
 * Separates language keys a database migration seeded during an E2E run from
 * keys the tests themselves left behind.
 * Bridges the global teardown's language-key comparison with the migration SQL
 * files on disk, which the test identity can read even where the migration
 * ledger in the database is closed to it.
 * Exists so a migration another session applies mid-run does not fail a run
 * whose own artifacts were all removed, while a genuine test leak still fails.
 */

import * as fs from 'fs';
import * as path from 'path';

/** Extra migration folders (path-delimiter separated) an embedding shell adds. */
export const EXTRA_MIGRATION_DIRECTORIES_ENV = 'FILTEREST_E2E_EXTRA_MIGRATION_DIRS';

export type MigrationSeededKey = { key: string; migrations: string[] };

export type LangKeyDriftAttribution = {
  /** Added keys whose exact SQL literal a migration file contains. */
  migrationSeeded: MigrationSeededKey[];
  /** Added keys no migration file names: a possible test leak. */
  unexplainedAdded: string[];
  /** Removed keys are never attributed: tests must not delete existing keys. */
  removed: string[];
};

/** The product's own migration folder plus any folders the environment names. */
export function resolveMigrationDirectories(
  applicationRoot: string,
  environment: Record<string, string | undefined> = process.env,
): string[] {
  const directories = [path.join(applicationRoot, 'server_tools', 'migrations')];
  for (const entry of String(environment[EXTRA_MIGRATION_DIRECTORIES_ENV] || '').split(path.delimiter)) {
    const trimmed = entry.trim();
    if (trimmed !== '') {
      directories.push(path.resolve(trimmed));
    }
  }
  return directories;
}

function readMigrationSources(directories: string[]): Array<{ name: string; sql: string }> {
  const sources: Array<{ name: string; sql: string }> = [];
  for (const directory of directories) {
    if (!fs.existsSync(directory)) {
      continue;
    }
    for (const name of fs.readdirSync(directory).sort()) {
      if (name.endsWith('.sql')) {
        sources.push({ name, sql: fs.readFileSync(path.join(directory, name), 'utf8') });
      }
    }
  }
  return sources;
}

/**
 * Attributes each added key to the migrations that seed it as an exact quoted
 * SQL literal. Synthetic test names never appear in migration files, so a key a
 * test left behind stays unexplained and still fails the run.
 */
export function attributeLangKeyDrift(
  added: string[],
  removed: string[],
  directories: string[],
): LangKeyDriftAttribution {
  const sources = added.length > 0 ? readMigrationSources(directories) : [];
  const migrationSeeded: MigrationSeededKey[] = [];
  const unexplainedAdded: string[] = [];
  for (const key of added) {
    const literal = `'${key.replace(/'/g, "''")}'`;
    const migrations = sources.filter((source) => source.sql.includes(literal)).map((source) => source.name);
    if (migrations.length > 0) {
      migrationSeeded.push({ key, migrations });
    } else {
      unexplainedAdded.push(key);
    }
  }
  return { migrationSeeded, unexplainedAdded, removed: [...removed] };
}

/** One readable line per attributed key, for teardown logs and errors. */
export function describeMigrationSeededKeys(keys: MigrationSeededKey[]): string {
  return keys.map((entry) => `${entry.key} (${entry.migrations.join(', ')})`).join('; ') || 'none';
}
