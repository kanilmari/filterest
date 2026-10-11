// @vitest-environment node
// table-csv-artifact.test.ts
// Verifies CSV path discovery and ownership-limited cleanup without a server.
// Bridges synthetic native installations and the U2 artifact lifecycle.
// Exists to catch wrong-root leaks and unsafe deletion on success or failure.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { withTableCSVArtifact } from './table-csv-artifact';

const datasetName = 'e2e_import_csv_owned';
const temporaryRoots: string[] = [];

function fixture(layout = 'standalone') {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'u2-csv-')));
  temporaryRoots.push(root);
  const applicationRoot = layout === 'embedded'
    ? path.join(root, 'filterest', 'app')
    : layout === 'legacy' ? root : path.join(root, 'app');
  fs.mkdirSync(applicationRoot, { recursive: true });
  fs.writeFileSync(path.join(applicationRoot, 'go.mod'), 'module filterest\n');
  fs.writeFileSync(path.join(applicationRoot, 'VERSION_APP'), 'test\n');
  if (layout === 'embedded') {
    fs.mkdirSync(path.join(root, '.git'));
    fs.writeFileSync(path.join(root, 'VERSION_EASELECT'), 'test\n');
  }
  const csvPath = path.join(
    root, ...(layout === 'standalone' ? ['data', 'runtime'] : []),
    'tables_data', `${datasetName}.csv`,
  );
  return { root, csvPath, options: { applicationRoot, environment: {} } };
}

function writeCSV(csvPath: string): void {
  fs.mkdirSync(path.dirname(csvPath), { recursive: true });
  fs.writeFileSync(csvPath, 'id,title\n1,Import me again\n');
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('U2 server CSV artifacts', () => {
  test('preserves a foreign file created at the unused candidate after preflight', async () => {
    const { root, csvPath, options } = fixture();
    const unusedPath = path.join(root, 'tables_data', `${datasetName}.csv`);
    await withTableCSVArtifact(datasetName, async (resolveExportPath) => {
      writeCSV(csvPath);
      resolveExportPath(`exported ${datasetName} to ${csvPath}`);
      writeCSV(unusedPath);
    }, options);
    expect(fs.existsSync(csvPath)).toBe(false);
    expect(fs.existsSync(unusedPath)).toBe(true);
    expect(fs.readFileSync(unusedPath, 'utf8')).toContain('Import me again');
  });

  test('preserves and reports an exported file replaced by a new inode', async () => {
    const { csvPath, options } = fixture();
    const replacementPath = `${csvPath}.replacement`;
    const error = await withTableCSVArtifact(datasetName, async (resolveExportPath) => {
      writeCSV(csvPath);
      const original = fs.lstatSync(csvPath);
      resolveExportPath(`exported ${datasetName} to ${csvPath}`);
      fs.writeFileSync(replacementPath, 'foreign replacement\n');
      // Allocate the replacement before removing the export to prevent inode reuse.
      fs.renameSync(replacementPath, csvPath);
      expect(fs.lstatSync(csvPath).ino).not.toBe(original.ino);
    }, options).catch((caught: unknown) => caught);
    expect(fs.existsSync(csvPath)).toBe(true);
    expect(fs.readFileSync(csvPath, 'utf8')).toBe('foreign replacement\n');
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors[0].message).toContain('identity changed');
    expect((error as AggregateError).errors[0].message).toContain(csvPath);
  });

  test('rejects a leaf symlink in the resolver before any read', async () => {
    const { csvPath, options } = fixture();
    const outside = fixture('legacy');
    writeCSV(outside.csvPath);
    let resolutionError: unknown;
    let readAttempted = false;
    await withTableCSVArtifact(datasetName, async (resolveExportPath) => {
      fs.mkdirSync(path.dirname(csvPath), { recursive: true });
      fs.symlinkSync(outside.csvPath, csvPath);
      try {
        const resolved = resolveExportPath(`exported ${datasetName} to ${csvPath}`);
        readAttempted = true;
        fs.readFileSync(resolved);
      } catch (error) {
        resolutionError = error;
        throw error;
      }
    }, options).catch(() => {});
    expect(readAttempted).toBe(false);
    expect(resolutionError).toBeInstanceOf(Error);
    expect((resolutionError as Error).message).toContain('not a regular file');
    expect(fs.lstatSync(csvPath).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(outside.csvPath, 'utf8')).toContain('Import me again');
  });

  test.each(['standalone', 'embedded', 'legacy'])(
    'uses the reply and removes only its new export in a %s installation',
    async (layout) => {
      const { csvPath, options } = fixture(layout);
      const foreignPath = path.join(path.dirname(csvPath), 'e2e_import_csv_other_run.csv');
      writeCSV(foreignPath);
      const result = await withTableCSVArtifact(datasetName, async (resolveExportPath, readExportCSV) => {
        writeCSV(csvPath);
        const resolved = resolveExportPath(`exported ${datasetName} to ${csvPath}`);
        expect(resolved).toBe(csvPath);
        const exportedCSV = readExportCSV();
        expect(exportedCSV.toString('utf8')).toContain('Import me again');
        expect(readExportCSV()).toEqual(exportedCSV);
        return 'import verified';
      }, options);
      expect(result).toBe('import verified');
      expect(fs.existsSync(csvPath)).toBe(false);
      expect(fs.readFileSync(foreignPath, 'utf8')).toContain('Import me again');
    },
  );

  test('anchors a legacy relative reply to the server boundary, not the test cwd', async () => {
    const { csvPath, options } = fixture('legacy');
    await withTableCSVArtifact(datasetName, async (resolveExportPath) => {
      writeCSV(csvPath);
      expect(resolveExportPath(`exported ${datasetName} to tables_data/${datasetName}.csv`))
        .toBe(csvPath);
    }, options);
    expect(fs.existsSync(csvPath)).toBe(false);
  });

  test('honors the native wrapper boundary when application source is in another checkout', async () => {
    const source = fixture();
    const native = fixture('embedded');
    await withTableCSVArtifact(datasetName, async (resolveExportPath) => {
      writeCSV(native.csvPath);
      expect(resolveExportPath(`exported ${datasetName} to ${native.csvPath}`)).toBe(native.csvPath);
    }, {
      applicationRoot: source.options.applicationRoot,
      environment: { FILTEREST_PROJECT_ROOT_OVERRIDE: native.root },
    });
    expect(fs.existsSync(native.csvPath)).toBe(false);
    expect(fs.existsSync(source.csvPath)).toBe(false);
  });

  test.each(['standalone', 'embedded'])(
    'leaves an unreported partial %s export when no success reply reaches the test',
    async (layout) => {
      const { csvPath, options } = fixture(layout);
      await expect(withTableCSVArtifact(datasetName, async () => {
        writeCSV(csvPath);
        throw new Error('export request failed');
      }, options)).rejects.toThrow('export request failed');
      expect(fs.existsSync(csvPath)).toBe(true);
    },
  );

  test('finishes CSV cleanup before a failing dataset teardown', async () => {
    const { csvPath, options } = fixture();
    const failDatasetTeardown = () => {
      expect(fs.existsSync(csvPath)).toBe(false);
      throw new Error('dataset teardown failed');
    };
    await expect((async () => {
      try {
        await withTableCSVArtifact(datasetName, async (resolveExportPath) => {
          writeCSV(csvPath);
          resolveExportPath(`exported ${datasetName} to ${csvPath}`);
          throw new Error('import assertion failed');
        }, options);
      } finally {
        failDatasetTeardown();
      }
    })()).rejects.toThrow('dataset teardown failed');
    expect(fs.existsSync(csvPath)).toBe(false);
  });

  test('refuses a pre-existing CSV before calling export and preserves it', async () => {
    const { csvPath, options } = fixture();
    writeCSV(csvPath);
    let called = false;
    await expect(withTableCSVArtifact(datasetName, async () => {
      called = true;
    }, options)).rejects.toThrow('pre-existing CSV');
    expect(called).toBe(false);
    expect(fs.readFileSync(csvPath, 'utf8')).toContain('Import me again');
  });

  test('rejects an unchecked reply path without deleting that file', async () => {
    const { root, csvPath, options } = fixture();
    const foreignPath = path.join(root, 'outside-tables-data', `${datasetName}.csv`);
    writeCSV(foreignPath);
    await expect(withTableCSVArtifact(datasetName, async (resolveExportPath) => {
      writeCSV(csvPath);
      resolveExportPath(`exported ${datasetName} to ${foreignPath}`);
    }, options)).rejects.toThrow('outside the expected runtime locations');
    expect(fs.existsSync(csvPath)).toBe(true);
    expect(fs.existsSync(foreignPath)).toBe(true);
  });

  test('rejects a reply for a different dataset without claiming a partial export', async () => {
    const { csvPath, options } = fixture();
    await expect(withTableCSVArtifact(datasetName, async (resolveExportPath) => {
      writeCSV(csvPath);
      resolveExportPath(`exported e2e_import_csv_other to ${csvPath}`);
    }, options)).rejects.toThrow('Unexpected CSV export reply');
    expect(fs.existsSync(csvPath)).toBe(true);
  });

  test.each([false, true])('refuses symlinked directories (introduced during export: %s)', async (duringExport) => {
    const { csvPath, options } = fixture();
    const outside = fixture('legacy');
    writeCSV(outside.csvPath);
    const linkDirectory = () => {
      fs.mkdirSync(path.dirname(path.dirname(csvPath)), { recursive: true });
      fs.symlinkSync(path.dirname(outside.csvPath), path.dirname(csvPath));
    };
    if (!duringExport) linkDirectory();
    await expect(withTableCSVArtifact(datasetName, async (resolveExportPath) => {
      if (duringExport) linkDirectory();
      resolveExportPath(`exported ${datasetName} to ${csvPath}`);
    }, options)).rejects.toThrow('symbolic link');
    expect(fs.existsSync(outside.csvPath)).toBe(true);
  });

  test('preserves the original failure and never follows a symlink substituted for the CSV', async () => {
    const { csvPath, options } = fixture();
    const outside = fixture('legacy');
    writeCSV(outside.csvPath);
    const primaryError = new Error('import failed');
    const error = await withTableCSVArtifact(datasetName, async (resolveExportPath) => {
      writeCSV(csvPath);
      resolveExportPath(`exported ${datasetName} to ${csvPath}`);
      fs.unlinkSync(csvPath);
      fs.symlinkSync(outside.csvPath, csvPath);
      throw primaryError;
    }, options).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors[0]).toBe(primaryError);
    expect((error as AggregateError).errors[1].message).toContain('not a regular file');
    expect(fs.readFileSync(outside.csvPath, 'utf8')).toContain('Import me again');
    expect(fs.lstatSync(csvPath).isSymbolicLink()).toBe(true);
  });

  test.each(['regular file', 'symlink'])(
    'rejects a %s substituted after resolution before reading its bytes',
    async (replacementType) => {
      const { csvPath, options } = fixture();
      const foreign = fixture('legacy');
      writeCSV(foreign.csvPath);
      const error = await withTableCSVArtifact(datasetName, async (resolveExportPath, readExportCSV) => {
        writeCSV(csvPath);
        resolveExportPath(`exported ${datasetName} to ${csvPath}`);
        if (replacementType === 'regular file') {
          fs.renameSync(foreign.csvPath, csvPath);
        } else {
          fs.unlinkSync(csvPath);
          fs.symlinkSync(foreign.csvPath, csvPath);
        }
        readExportCSV();
      }, options).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(AggregateError);
      const expectedMessage = replacementType === 'regular file' ? 'identity changed' : 'not a regular file';
      expect((error as AggregateError).errors).toHaveLength(2);
      for (const failure of (error as AggregateError).errors) {
        expect(failure.message).toContain(expectedMessage);
      }
      expect(fs.lstatSync(csvPath).isSymbolicLink()).toBe(replacementType === 'symlink');
    },
  );

  test('refuses reads before a valid export reply', async () => {
    const { options } = fixture();
    await withTableCSVArtifact(datasetName, async (_resolveExportPath, readExportCSV) => {
      expect(() => readExportCSV()).toThrow('Resolve the CSV export reply');
    }, options);
  });

  test('never records a replacement identity from a second reply', async () => {
    const { csvPath, options } = fixture();
    const error = await withTableCSVArtifact(datasetName, async (resolveExportPath) => {
      writeCSV(csvPath);
      resolveExportPath(`exported ${datasetName} to ${csvPath}`);
      const replacementPath = `${csvPath}.replacement`;
      fs.writeFileSync(replacementPath, 'foreign replacement\n');
      fs.renameSync(replacementPath, csvPath);
      resolveExportPath(`exported ${datasetName} to ${csvPath}`);
    }, options).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors[0].message).toContain('already been recorded');
    expect((error as AggregateError).errors[1].message).toContain('identity changed');
    expect(fs.readFileSync(csvPath, 'utf8')).toBe('foreign replacement\n');
  });

  test('refuses cleanup through a parent symlink substituted after resolution', async () => {
    const { csvPath, options } = fixture();
    const outside = fixture('legacy');
    writeCSV(outside.csvPath);
    const originalDirectory = `${path.dirname(csvPath)}.original`;
    const error = await withTableCSVArtifact(datasetName, async (resolveExportPath) => {
      writeCSV(csvPath);
      resolveExportPath(`exported ${datasetName} to ${csvPath}`);
      fs.renameSync(path.dirname(csvPath), originalDirectory);
      fs.symlinkSync(path.dirname(outside.csvPath), path.dirname(csvPath));
    }, options).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors[0].message).toContain('symbolic link');
    expect(fs.existsSync(path.join(originalDirectory, path.basename(csvPath)))).toBe(true);
    expect(fs.existsSync(outside.csvPath)).toBe(true);
  });

  test('rejects dataset names outside U2 before claiming any files', async () => {
    const { options } = fixture();
    await expect(withTableCSVArtifact('../unowned', async () => {}, options))
      .rejects.toThrow('U2-generated dataset name');
  });
});
