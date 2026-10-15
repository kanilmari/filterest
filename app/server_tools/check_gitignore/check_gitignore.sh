#!/usr/bin/env bash
# check_gitignore.sh
# Lists missing literal paths declared by the Filterest .gitignore.
# Connects the installation ignore policy to QA warnings and a printed report.
# Keeps checks read-only so generated reports never alter maintained source.
set -euo pipefail

for argument in "$@"; do
  case "$argument" in
    --help|-h) echo "Usage: check_gitignore.sh (prints report; writes no files)"; exit 0 ;;
    *) echo "Unknown gitignore check argument: $argument" >&2; exit 2 ;;
  esac
done

script_directory_absolute_path="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Source lives below app/; the transferable installation owns .gitignore.
project_root_absolute_path="$(cd "${script_directory_absolute_path}/../../.." && pwd)"
gitignore_file_path="${project_root_absolute_path}/.gitignore"
report_lines=("# Missing .gitignore paths" "")

while IFS= read -r gitignore_line || [[ -n "$gitignore_line" ]]; do
  [[ -z "$gitignore_line" || "$gitignore_line" == \#* ]] && continue
  path_pattern="$gitignore_line"
  # A negated rule still names a path in this audit.
  [[ "$path_pattern" != !* ]] || path_pattern="${path_pattern:1}"
  # Wildcards may name future/generated/secret files; absence is non-actionable.
  case "$path_pattern" in
    *'*'*|*'?'*|*'['*) continue ;;
  esac
  declared_path="${project_root_absolute_path}/$path_pattern"
  if [[ ! -e "$declared_path" && ! -L "$declared_path" ]]; then
    printf '\033[33mWARNING: .gitignore path is not available: %s\033[0m\n' \
      "$declared_path" >&2
    report_lines+=("- $declared_path")
  fi
done < "$gitignore_file_path"

if [[ ${#report_lines[@]} -eq 2 ]]; then
  report_lines+=("Kaikki .gitignore-polut löytyvät.")
fi
printf '%s\n' "${report_lines[@]}"
