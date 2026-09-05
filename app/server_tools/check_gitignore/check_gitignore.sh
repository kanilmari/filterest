#!/usr/bin/env bash
# check_gitignore.sh - list missing paths declared by the Filterest .gitignore.
# Prints warnings and refreshes the adjacent Markdown report.

set -uo pipefail        # ei -e, jotta varoitukset eivät pysäytä skriptiä

script_directory_absolute_path="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Filterest keeps maintained source below app/, while .gitignore belongs to the
# transferable installation root one level above it. Resolving from this
# script's stable app/server_tools/check_gitignore location keeps the audit
# correct in both the Easelect-owned source tree and a standalone checkout.
project_root_absolute_path="$(cd "${script_directory_absolute_path}/../../.." && pwd)"
gitignore_file_path="${project_root_absolute_path}/.gitignore"
output_markdown="${script_directory_absolute_path}/missing_gitignore_paths.md"

{
  echo "# Missing .gitignore paths"
  echo ""
} > "$output_markdown"

# macOS ships Bash 3.2, which has dotglob/nullglob but not globstar. Missing
# wildcard patterns are intentionally non-actionable below, so recursive **
# expansion is unnecessary for the literal-path audit this script enforces.
shopt -s dotglob nullglob

while IFS= read -r gitignore_line || [[ -n "$gitignore_line" ]]; do
  # Skip blank and comment lines.
  [[ -z "$gitignore_line" ]] && continue
  [[ "$gitignore_line" =~ ^# ]] && continue

  path_pattern="$gitignore_line"
  # A negated rule still names a path that belongs to the audit surface.
  if [[ "$path_pattern" == !* ]]; then
    path_pattern="${path_pattern:1}"
  fi

  matching_paths=("${project_root_absolute_path}/"$path_pattern)
  if [[ ${#matching_paths[@]} -eq 0 ]]; then
    # Globs often document future/generated/secret files that should not exist
    # in a clean checkout. Only literal missing paths are actionable here.
    case "$path_pattern" in
      *'*'*|*'?'*|*'['*) continue ;;
    esac
    printf '\033[33mWARNING: .gitignore path is not available: %s\033[0m\n' \
      "${project_root_absolute_path}/$path_pattern" >&2
    echo "- ${project_root_absolute_path}/$path_pattern" >> "$output_markdown"
  fi
done < "$gitignore_file_path"

if [[ $(wc -l < "$output_markdown") -eq 2 ]]; then
  echo "Kaikki .gitignore-polut löytyvät." >> "$output_markdown"
fi

exit 0
