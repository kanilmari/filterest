// check_js_imports.js
// Checks and optionally fixes JavaScript import statements across the frontend.
// Between the developer CLI and the frontend module graph.
// Exists to keep import paths consistent and catch broken references.
//
// Usage: node check_js_imports.js [path/to/entry.js] [--fix-imports] [--show-orphans] [--exclude=dir/**,file.js]
// Default entry point: "main.js" if no path is given.
// Builds a symbol map, recursively parses imports, verifies paths, and auto-fixes
// when exactly one match is found.

const fs = require("fs");
const path = require("path");
const glob = require("glob");

let global_ignore_patterns = [];

const processed_files = new Set();

let total_imports = 0;
let error_count = 0;
let ok_count = 0;

// Map: { symbol: Set([file_path, ...]) }
const symbol_map = new Map();

/**
 * Returns a list of [start, end] pairs where code is inside comments.
 * Scans both single-line (//) and multi-line block comments.
 */
function find_comment_regions(content) {
    const regions = [];

    // Single-line comments
    const single_line_re = /\/\/[^\n]*/g;
    let match_result;
    while ((match_result = single_line_re.exec(content)) !== null) {
        regions.push([match_result.index, match_result.index + match_result[0].length]);
    }

    // Multi-line comments
    const multi_line_re = /\/\*[\s\S]*?\*\//g;
    while ((match_result = multi_line_re.exec(content)) !== null) {
        regions.push([match_result.index, match_result.index + match_result[0].length]);
    }

    return regions;
}

/**
 * Is the given index inside a comment region?
 */
function is_index_in_comment(index, comment_regions) {
    for (const [start, end] of comment_regions) {
        if (index >= start && index < end) {
            return true;
        }
    }
    return false;
}

function is_local_import_without_dots(import_path) {
    return !import_path.startsWith(".") && import_path.includes("/");
}

/**
 * Builds a symbol map:
 * Scans all JS files for function definitions:
 *   function foo(...),
 *   export function foo(...),
 *   export { foo, bar } ...
 *
 * Stores into symbol_map: symbol -> Set[file_paths]
 */
function build_symbol_map(ignore_list) {
    const all_js = glob.sync("**/*.js", { nodir: true, ignore: ignore_list });

    for (const file of all_js) {
        let content = "";
        try {
            content = fs.readFileSync(file, "utf8");
        } catch (err) {
            console.log(`\x1b[31merror: %s\x1b[0m`, err.message);
            continue;
        }

        // 1) Find "function foo(":
        //    also handles export function foo(
        const function_regex = /\b(export\s+)?function\s+(\w+)/g;
        let m;
        while ((m = function_regex.exec(content)) !== null) {
            const function_name = m[2];
            if (!symbol_map.has(function_name)) {
                symbol_map.set(function_name, new Set());
            }
            symbol_map.get(function_name).add(path.resolve(file));
        }

        // 2) Find export { foo, bar }
        //    extract all symbols from the {foo, bar} section
        const export_braces_regex = /export\s*\{\s*([^}]+)\}/g;
        while ((m = export_braces_regex.exec(content)) !== null) {
            // e.g. "foo, bar as b2, baz"
            const inner = m[1].split(",").map((s) => s.trim());
            inner.forEach((s) => {
                // e.g. "bar as b2" -> [bar, b2]
                const parts = s.split(/\s+as\s+/);
                const name = parts[0].trim();
                if (name) {
                    if (!symbol_map.has(name)) {
                        symbol_map.set(name, new Set());
                    }
                    symbol_map.get(name).add(path.resolve(file));
                }
            });
        }
    }
}

/**
 * Extracts named symbols from an import statement, e.g.:
 *   import { load_table, do_stuff as ds } from '...';
 * Returns an array: ['load_table', 'do_stuff']
 * (skips "as" aliases).
 */
function extract_named_symbols(import_statement) {
    const re = /import\s*\{\s*([\s\S]*?)\}\s*from\s*['"]/;
    const mm = re.exec(import_statement);
    if (!mm) {
        return [];
    }

    // Remove multi-line comments /* ... */ and single-line comments // ...
    let inner = mm[1];
    inner = inner.replace(/\/\*[\s\S]*?\*\//g, "");
    inner = inner.replace(/\/\/[^\n]*/g, "");

    return inner
        .split(",")
        .map((s) => s.trim())
        .map((s) => {
            const as_match = s.split(/\s+as\s+/);
            return as_match[0].trim();
        })
        .filter(Boolean);
}

/**
 * Tries to find exactly one file from the symbol map
 * that contains all the given symbols.
 * Returns null if 0 or more than 1 match,
 * or returns the single path if exactly 1 match.
 */
function find_file_by_symbols(symbols) {
    if (symbols.length === 0) {
        return null;
    }

    let common_set = null;
    for (const sym of symbols) {
        if (!symbol_map.has(sym)) {
            return null;
        }
        const possible_files = symbol_map.get(sym);
        if (common_set === null) {
            common_set = new Set(possible_files);
        } else {
            common_set = new Set([...common_set].filter((x) => possible_files.has(x)));
        }
        if (common_set.size === 0) {
            return null;
        }
    }

    if (common_set.size === 1) {
        return [...common_set][0];
    }
    return null;
}

function process_file(file_path, fix_imports) {
    if (processed_files.has(file_path)) {
        return;
    }
    processed_files.add(file_path);

    let content;
    try {
        content = fs.readFileSync(file_path, "utf8");
    } catch (err) {
        console.error(`\x1b[31merror: %s\x1b[0m`, err.message);
        return;
    }

    const comment_regions = find_comment_regions(content);

    // Regex allowing comments and newlines inside braces
    const import_pattern_named = /import\s+([\s\S]+?)\s+from\s+['"]([^'"]+)['"]/g;
    const import_pattern_side_effect = /import\s+['"]([^'"]+)['"]/g;
    const export_pattern_star = /export\s+\*\s+from\s+['"]([^'"]+)['"]/g;
    const export_pattern_named = /export\s*\{[\s\S]*?\}\s*from\s+['"]([^'"]+)['"]/g;

    let match;
    const imports = [];

    // Named imports
    while ((match = import_pattern_named.exec(content)) !== null) {
        if (is_index_in_comment(match.index, comment_regions)) {
            continue;
        }
        imports.push({
            match_index: match.index,
            statement: match[0],
            import_path: match[2],
            type: "named",
        });
    }

    // Side-effect imports
    while ((match = import_pattern_side_effect.exec(content)) !== null) {
        if (is_index_in_comment(match.index, comment_regions)) {
            continue;
        }
        imports.push({
            match_index: match.index,
            statement: match[0],
            import_path: match[1],
            type: "side_effect",
        });
    }

    // Re-exports: export * from '...'
    while ((match = export_pattern_star.exec(content)) !== null) {
        if (is_index_in_comment(match.index, comment_regions)) {
            continue;
        }
        imports.push({
            match_index: match.index,
            statement: match[0],
            import_path: match[1],
            type: "re_export_star",
        });
    }

    // Re-exports: export { foo, bar } from '...'
    while ((match = export_pattern_named.exec(content)) !== null) {
        if (is_index_in_comment(match.index, comment_regions)) {
            continue;
        }
        imports.push({
            match_index: match.index,
            statement: match[0],
            import_path: match[1],
            type: "named",
        });
    }

    if (imports.length === 0) {
        return;
    }

    let new_content = content;
    let has_changes = false;

    for (const imp of imports) {
        total_imports++;
        const original_path = imp.import_path;

        // 1) Relative imports
        if (
            original_path.startsWith("./") ||
            original_path.startsWith("../")
        ) {
            const absolute_path = path.resolve(
                path.dirname(file_path),
                original_path
            );

            if (fs.existsSync(absolute_path)) {
                ok_count++;
                process_file(absolute_path, fix_imports);
            } else {
                if (fix_imports) {
                    const file_name = path.basename(original_path);
                    const matches = glob.sync(`**/${file_name}`, {
                        nodir: true,
                        ignore: global_ignore_patterns,
                    });
                    if (matches.length === 1) {
                        const found_file = path.resolve(matches[0]);
                        let new_rel = path
                            .relative(path.dirname(file_path), found_file)
                            .replace(/\\/g, "/");

                        if (!new_rel.startsWith(".")) {
                            new_rel = "./" + new_rel;
                        }
                        console.log(
                            `\x1b[33mfixing:\x1b[0m '${original_path}' -> '${new_rel}' (${file_path})`
                        );

                        const old_statement = imp.statement;
                        const fixed_statement = old_statement.replace(
                            original_path,
                            new_rel
                        );

                        new_content = new_content.replace(
                            old_statement,
                            fixed_statement
                        );
                        has_changes = true;
                        ok_count++;

                        process_file(found_file, fix_imports);
                    } else if (matches.length === 0) {
                        if (imp.type === "named") {
                            const symbols = extract_named_symbols(imp.statement);
                            const found_file =
                                find_file_by_symbols(symbols);
                            if (found_file) {
                                let new_rel = path
                                    .relative(
                                        path.dirname(file_path),
                                        found_file
                                    )
                                    .replace(/\\/g, "/");
                                if (!new_rel.startsWith(".")) {
                                    new_rel = "./" + new_rel;
                                }

                                console.log(
                                    `\x1b[33mfixing:\x1b[0m '${original_path}' -> '${new_rel}' via symbol lookup (${file_path})`
                                );

                                const old_statement = imp.statement;
                                const fixed_statement = old_statement.replace(
                                    original_path,
                                    new_rel
                                );

                                new_content = new_content.replace(
                                    old_statement,
                                    fixed_statement
                                );
                                has_changes = true;
                                ok_count++;

                                process_file(
                                    found_file,
                                    fix_imports
                                );
                            } else {
                                error_count++;
                                console.error(
                                    `\x1b[31merror: file '${absolute_path}' not found, ` +
                                        `no name match in project, no symbol match (import { ${symbols.join(
                                            ", "
                                        )} }). (ref: '${file_path}')`
                                );
                            }
                        } else {
                            error_count++;
                            console.error(
                                `\x1b[31merror: file '${absolute_path}' not found, ` +
                                    `no name match in project. (original import: '${original_path}', ` +
                                    `ref: '${file_path}')`
                            );
                        }
                    } else {
                        error_count++;
                        console.error(
                            `\x1b[31merror: file '${absolute_path}' not found. Multiple name matches: ${matches} ` +
                                `(original: '${original_path}', ref: '${file_path}')`
                        );
                    }
                } else {
                    error_count++;
                    console.error(
                        `\x1b[31merror: file '${absolute_path}' not found ` +
                            `(original import: '${original_path}', ref: '${file_path}')`
                    );
                }
            }
        }

        // 2) Local path without dots (assumed ./)
        else if (is_local_import_without_dots(original_path)) {
            const path_with_prefix = "./" + original_path;
            const absolute_path = path.resolve(
                path.dirname(file_path),
                path_with_prefix
            );

            if (fs.existsSync(absolute_path)) {
                if (fix_imports) {
                    console.log(
                        `\x1b[33mfixing:\x1b[0m '${original_path}' -> '${path_with_prefix}' (${file_path})`
                    );

                    const old_statement = imp.statement;
                    const fixed_statement = old_statement.replace(
                        original_path,
                        path_with_prefix
                    );

                    new_content = new_content.replace(
                        old_statement,
                        fixed_statement
                    );
                    has_changes = true;
                    ok_count++;

                    process_file(absolute_path, fix_imports);
                } else {
                    error_count++;
                    console.error(
                        `\x1b[31merror: import '${original_path}' looks like a local file, ` +
                            `but does not start with './' or '../'. (ref: '${file_path}')`
                    );
                }
            } else {
                error_count++;
                console.error(
                    `\x1b[31merror: import '${original_path}' does not start with './' or '../', ` +
                        `and file '${absolute_path}' was not found. (ref: '${file_path}')`
                );
            }
        }

        // 3) Assumed npm package
        else {
            ok_count++;
        }
    }

    if (has_changes) {
        fs.writeFileSync(file_path, new_content, "utf8");
        console.log(`\x1b[32mFile "${file_path}" updated.\x1b[0m`);
    }
}

function main() {
    const args = process.argv.slice(2);
    let entry_point = "main.js";
    let fix_imports = false;
    let show_orphans = false;
    let exclude_patterns = [];

    for (const arg of args) {
        if (arg.startsWith("--exclude=")) {
            const excl_str = arg.replace("--exclude=", "");
            exclude_patterns = excl_str
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
        } else if (arg === "--fix-imports") {
            fix_imports = true;
        } else if (arg === "--show-orphans") {
            show_orphans = true;
        } else {
            entry_point = arg;
        }
    }

    if (!fs.existsSync(entry_point)) {
        console.error(
            `\x1b[31merror: file '${entry_point}' does not exist.\x1b[0m`
        );
        process.exit(1);
    }

    const default_ignore = [
        "node_modules/**",
        "**/node_modules/**",
        "frontend/dist/**",
        "**/dist/**",
        "dist-public/**",
        "**/dist-public/**",
        "**/.wrangler/**",
        "**/*.test.js",
    ];
    const ignore_for_all = default_ignore.concat(exclude_patterns);
    global_ignore_patterns = ignore_for_all;

    // 0) Build symbol map
    build_symbol_map(ignore_for_all);

    // 1) Process entry point
    process_file(path.resolve(entry_point), fix_imports);

    // 2) Find all JS files except ignored ones
    const all_js_files = glob.sync("**/*.js", {
        nodir: true,
        ignore: ignore_for_all,
    });

    // 3) List excluded files
    const excluded_glob = glob.sync("**/*.js", {
        nodir: true,
        ignore: default_ignore,
    });
    const included_abs = new Set(
        all_js_files.map((f) => path.resolve(f))
    );
    const excluded_abs = excluded_glob
        .map((f) => path.resolve(f))
        .filter((f) => !included_abs.has(f) && f !== path.resolve(entry_point));

    // 4) Find orphan files
    const orphans = all_js_files
        .map((t) => path.resolve(t))
        .filter((t) => !processed_files.has(t));

    if (orphans.length > 0) {
        if (show_orphans) {
            console.log("\x1b[33mOrphan files:\x1b[0m");
            orphans.forEach((o) => console.log("  " + o));
        } else {
            console.log(
                `\x1b[33mOrphan files hidden:\x1b[0m ${orphans.length} file(s). ` +
                    "Pass --show-orphans to list them."
            );
        }
    } else {
        console.log("No orphan files!");
    }

    if (excluded_abs.length > 0) {
        console.log("\n\x1b[33mExcluded files (not processed):\x1b[0m");
        excluded_abs.forEach((e) => console.log("  " + e));
    }

    console.log("");
    if (total_imports === 0) {
        console.log("\x1b[33mNo import statements found.\x1b[0m");
        console.log(
            `Checked ${processed_files.size} files.`
        );
    } else {
        console.log(
            `Checked ${processed_files.size} files. ` +
                `${error_count} errors, ${ok_count} OK, ${total_imports} total imports.`
        );
    }
}

main();
console.log("********************************");
