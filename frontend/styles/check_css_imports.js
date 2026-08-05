// check_css_imports.js
// Checks and optionally fixes CSS @import path resolution across the frontend.
// Between the developer CLI and CSS import statements in stylesheet files.
// Exists to catch broken @import paths and auto-fix them when a unique match exists.
//
// Usage: node check_css_imports.js [path/to/imports.css] [--fix-imports]

const fs = require('fs');
const path = require('path');
const glob = require('glob');

function check_and_fix_css_imports() {
  const default_css_file_path = path.join(__dirname, 'imports.css');
  const css_file_path = process.argv[2] && !process.argv[2].startsWith('--')
    ? process.argv[2]
    : default_css_file_path;

  const fix_imports = process.argv.includes('--fix-imports');

  let content;
  try {
    content = fs.readFileSync(css_file_path, 'utf8');
  } catch (err) {
    console.warn(`\x1b[31merror:\x1b[0m failed to read file: ${err.message}`);
    return;
  }

  const import_pattern = /@import\s*(?:url\(\s*(['"])([^'"]+)\1\s*\)|(['"])([^'"]+)\3)/g;

  let match;
  let total = 0;
  let error_count = 0;
  let updated_lines = 0;
  let ok_count = 0;

  const lines = content.split('\n');

  while ((match = import_pattern.exec(content)) !== null) {
    total++;

    const css_path = match[2] || match[4];
    if (!css_path) {
      continue;
    }

    const absolute_path = path.resolve(path.dirname(css_file_path), css_path);

    if (fs.existsSync(absolute_path)) {
      ok_count++;
    } else {
      if (fix_imports) {
        const file_name = path.basename(css_path);
        const matches = glob.sync(`**/${file_name}`, { nodir: true });

        if (matches.length === 1) {
          const found_full_path = path.resolve(matches[0]);
          const new_relative_path = path.relative(
            path.dirname(css_file_path),
            found_full_path
          );
          const path_with_slashes = new_relative_path.replace(/\\/g, '/');

          console.log(`\x1b[33mfixing:\x1b[0m "${css_path}" -> "${path_with_slashes}"`);

          for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(css_path)) {
              lines[i] = lines[i].replace(css_path, path_with_slashes);
              updated_lines++;
              break;
            }
          }
          ok_count++;
        } else if (matches.length === 0) {
          error_count++;
          console.warn(
            `\x1b[31merror:\x1b[0m file not found at "${css_path}" and no matching name found in project.`
          );
        } else {
          error_count++;
          console.warn(
            `\x1b[31merror:\x1b[0m file not found at "${css_path}". Multiple name matches: ${matches}`
          );
        }
      } else {
        error_count++;
        console.warn(`\x1b[31merror:\x1b[0m file not found at "${css_path}" (resolved: ${absolute_path})`);
      }
    }
  }

  if (updated_lines > 0) {
    const new_content = lines.join('\n');
    try {
      fs.writeFileSync(css_file_path, new_content, 'utf8');
      console.log(`\x1b[32mFile "${css_file_path}" updated (${updated_lines} line(s) changed).\x1b[0m`);
    } catch (err) {
      console.warn(`\x1b[31merror:\x1b[0m failed to write file: ${err.message}`);
    }
  }

  if (total === 0) {
    console.log('\x1b[33mNo @import lines found.\x1b[0m');
  } else {
    console.log(`${error_count} errors, ${ok_count} OK, ${total} total imports.`);
  }
}

// Run main function
check_and_fix_css_imports();
