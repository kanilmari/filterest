// frontend_import_lexer.mjs
// Extracts JS/TS module references from a JSON batch of file names and source text.
// Connects Python boundary guards and reverse-import planning to es-module-lexer.
// Keeps parsing offline and fails the whole batch when discovery is unavailable.

import { readFileSync } from 'node:fs';
import { requireNodeDependency } from '../lib/node_dependency_loader.mjs';

// CommonJS calls remain part of the existing boundary contract. Project require
// spellings into a same-width copy; the real lexer decides which are calls,
// excluding methods, comments, regexes and template text. Never execute source.
const REQUIRE_CALL = /(?<![$\p{ID_Continue}])require(?=\s*(?:(?:\/\*[\s\S]*?\*\/|\/\/[^\r\n]*(?:\r?\n|$))\s*)*\()/gu;

function parseImports(parse, source, filename) {
  try {
    return parse(source, filename)[0];
  } catch (error) {
    // Lexer 2.3.1 misreads division after `value. /* comment */ in`.
    // ESLint is already a direct development dependency. Its real parser can
    // identify keyword property names without interpreting comments/regexes by
    // hand. Neutralize only those names, at identical UTF-16 offsets, and retry
    // es-module-lexer; it remains the sole provider of import records.
    const { Linter } = requireNodeDependency('eslint');
    const linter = new Linter();
    linter.verify(source, { languageOptions: { ecmaVersion: 'latest', sourceType: 'module' } });
    const tokens = linter.getSourceCode()?.ast.tokens;
    if (!tokens) throw error;
    let normalized = source;
    for (let index = tokens.length - 1; index > 0; index--) {
      const current = tokens[index];
      if (current.type === 'Identifier' && current.value === 'in'
          && ['.', '?.'].includes(tokens[index - 1].value)) {
        normalized = normalized.slice(0, current.range[0])
          + '_'.repeat(current.range[1] - current.range[0])
          + normalized.slice(current.range[1]);
      }
    }
    if (normalized === source) throw error;
    return parse(normalized, filename)[0];
  }
}

function importsForFile(parse, source, filename) {
  const entries = parseImports(parse, source, filename).filter((entry) => entry.d !== -2);
  const commonJS = source.replace(REQUIRE_CALL, 'import ');
  if (commonJS !== source) {
    for (const entry of parseImports(parse, commonJS, filename)) {
      if (entry.d < 0 || source.slice(entry.ss, entry.ss + 7) !== 'require') continue;
      // A renamed spelling inside a literal argument is still data. Decode its
      // original spelling through the lexer too, preserving paths like
      // require('./require(example).js') without evaluating any argument.
      if (entry.n !== undefined) {
        entry.n = parse(`import(${source.slice(entry.s, entry.e)})`, filename)[0][0].n;
      }
      entries.push(entry);
    }
  }
  return entries.sort((left, right) => left.ss - right.ss).map((entry) => ({
    specifier: entry.n ?? null,
    computed: entry.d > -1 && entry.n === undefined,
    kind: entry.d > -1 ? 'dynamic' : 'static',
    line: source.slice(0, entry.ss).split(/\r\n|[\n\r\u2028\u2029]/u).length,
  }));
}

try {
  const { init, parse } = requireNodeDependency('es-module-lexer');
  await init;
  const sources = JSON.parse(readFileSync(0, 'utf8'));
  const result = Object.fromEntries(Object.entries(sources).map(([filename, source]) =>
    [filename, importsForFile(parse, source, filename)]));
  process.stdout.write(JSON.stringify(result));
} catch (error) {
  console.error(`JavaScript import discovery failed (Node/es-module-lexer): ${error.message}`);
  process.exitCode = 1;
}
