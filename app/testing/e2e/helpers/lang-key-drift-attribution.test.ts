/**
 * lang-key-drift-attribution.test.ts
 * Proves only keys a migration file seeds are excused, and removals never are.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, expect, test } from 'vitest';
import {
  attributeLangKeyDrift,
  describeMigrationSeededKeys,
  EXTRA_MIGRATION_DIRECTORIES_ENV,
  resolveMigrationDirectories,
} from './lang-key-drift-attribution';

const temporaryRoots: string[] = [];

function migrationDirectory(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lang-key-drift-'));
  temporaryRoots.push(root);
  for (const [name, sql] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, name), sql);
  }
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('keys seeded as exact literals are attributed to their migrations', () => {
  const directory = migrationDirectory({
    '20260922000001_seed.sql': "INSERT INTO system_lang_keys (lang_key) VALUES ('server_error_notice');",
    '20260922000002_more.sql': "VALUES ('server_error_notice'), ('network_error_notice');",
    'notes.txt': "'e2e_leaked_column'",
  });

  const attribution = attributeLangKeyDrift(
    ['network_error_notice', 'server_error_notice', 'e2e_leaked_column', 'server_error'],
    [],
    [directory, path.join(directory, 'missing')],
  );

  expect(attribution.migrationSeeded).toEqual([
    { key: 'network_error_notice', migrations: ['20260922000002_more.sql'] },
    { key: 'server_error_notice', migrations: ['20260922000001_seed.sql', '20260922000002_more.sql'] },
  ]);
  // A .txt file is not a migration, and a key prefix is not the key's literal.
  expect(attribution.unexplainedAdded).toEqual(['e2e_leaked_column', 'server_error']);
  expect(describeMigrationSeededKeys(attribution.migrationSeeded)).toBe(
    'network_error_notice (20260922000002_more.sql); '
    + 'server_error_notice (20260922000001_seed.sql, 20260922000002_more.sql)',
  );
});

test('removed keys are never attributed, even when a migration names them', () => {
  const directory = migrationDirectory({ 'a.sql': "DELETE FROM system_lang_keys WHERE lang_key = 'old_key';" });
  const attribution = attributeLangKeyDrift([], ['old_key'], [directory]);
  expect(attribution).toEqual({ migrationSeeded: [], unexplainedAdded: [], removed: ['old_key'] });
});

test('the product folder comes first and the shell may add its own folders', () => {
  const environment = {
    [EXTRA_MIGRATION_DIRECTORIES_ENV]: ['/shell/migrations', ' ', 'relative/private'].join(path.delimiter),
  };
  expect(resolveMigrationDirectories('/product/app', environment)).toEqual([
    path.join('/product/app', 'server_tools', 'migrations'),
    '/shell/migrations',
    path.resolve('relative/private'),
  ]);
  expect(resolveMigrationDirectories('/product/app', {})).toEqual([
    path.join('/product/app', 'server_tools', 'migrations'),
  ]);
});
