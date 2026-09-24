#!/bin/bash
# qa.sh
# Runs the bounded Quality Assurance suite for the selected product workspace.
# Bridges shell orchestration with frontend, backend, import, and policy checks.
# Exists so standalone Filterest and embedded Easelect share repeatable local verification.
set -e

FIX_MODE=0
for argument in "$@"; do
    case "$argument" in
        --fix) FIX_MODE=1 ;;
        --help|-h)
            echo "Usage: qa.sh [--fix]"
            echo "Check source without repairs; --fix enables ESLint/import repairs and the gitignore report."
            echo "E2E requires local test credentials and a healthy server; skipped E2E is reported as PARTIAL."
            exit 0
            ;;
        *) echo "Unknown QA argument: $argument (use --help)" >&2; exit 2 ;;
    esac
done
IMPORT_OPTIONS=()
ESLINT_OPTIONS=()
GITIGNORE_OPTIONS=()
if [[ "$FIX_MODE" -eq 1 ]]; then
    IMPORT_OPTIONS+=(--fix-imports)
    ESLINT_OPTIONS+=(--fix)
    GITIGNORE_OPTIONS+=(--write-report)
fi
# Build and coverage outputs belong to a disposable directory outside source.
QA_TEMP_DIR="$(mktemp -d /tmp/filterest-qa.XXXXXX)"
trap 'rm -rf -- "$QA_TEMP_DIR"' EXIT

CALLER_ROOT="$(pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ADDITIONAL_QA_SCRIPT="${FILTEREST_ADDITIONAL_QA_SCRIPT:-}"
# shellcheck source=../lib/python_bytecode_cache.sh
source "$PROJECT_ROOT/server_tools/lib/python_bytecode_cache.sh"
filterest_configure_python_bytecode_cache "$PROJECT_ROOT"
cd "$PROJECT_ROOT"
QA_BASE_URL="$(
    node ./server_tools/scripts/local_easelect_target.mjs \
        --print-base-url "$PROJECT_ROOT"
)"
QA_CREDENTIAL_FILE="${FILTEREST_TEST_CREDENTIAL_FILE:-$(cd "$PROJECT_ROOT/.." && pwd -P)/keys/filterest_runtime/dev_env_test_creds.txt}"
export FILTEREST_TEST_CREDENTIAL_FILE="$QA_CREDENTIAL_FILE"
export FILTEREST_E2E_BASE_URL="$QA_BASE_URL"

echo "🔍 Running QA Checks (repair mode: $FIX_MODE)..."

# 1. Lint CSS
echo "🎨 Linting CSS..."
npm run lint:css
node ./frontend/styles/check_css_imports.js ./frontend/styles/imports.css "${IMPORT_OPTIONS[@]}"

# 2. Lint JS (ESLint)
echo "🧠 Linting JS..."
ESLINT_CONFIG_PATH="eslint.config.mjs"
eslint --config "$ESLINT_CONFIG_PATH" . "${ESLINT_OPTIONS[@]}"

# 3. Check JS Imports
echo "🔗 Checking JS Imports..."
node ./frontend/check_js_imports.js ./frontend/main.js --exclude=others/**,frontend/styles/**,node_modules/**,favefox/**,frontend/check_js_imports*.js "${IMPORT_OPTIONS[@]}"

# 4. Check generated Go→TS contract drift
echo "🧬 Checking generated Go contract types..."
python3 ./server_tools/scripts/generate_go_contract_types.py --check

# 5. Check generated backend route manifest drift
echo "🗺️  Checking generated backend route manifest..."
go run ./server_tools/scripts/generate_route_manifest.go --check

# 6. Check generated stable API client drift
echo "🧭 Checking generated stable API client..."
python3 ./server_tools/scripts/generate_stable_api_client.py --check

# 7. Check Gitignore
echo "🙈 Checking .gitignore..."
./server_tools/check_gitignore/check_gitignore.sh "${GITIGNORE_OPTIONS[@]}"

# 8. Run an optional checkout-specific QA extension
echo "🧩 Checking checkout-specific QA extension..."
if [[ -n "$ADDITIONAL_QA_SCRIPT" ]]; then
    case "$ADDITIONAL_QA_SCRIPT" in
        /*) additional_qa_path="$ADDITIONAL_QA_SCRIPT" ;;
        *) additional_qa_path="$CALLER_ROOT/$ADDITIONAL_QA_SCRIPT" ;;
    esac
    if [[ ! -x "$additional_qa_path" ]]; then
        echo "  ❌ Configured QA extension is not executable: $additional_qa_path" >&2
        exit 1
    fi
    (
        cd "$CALLER_ROOT"
        "$additional_qa_path"
    )
else
    echo "  ℹ️  No checkout-specific QA extension configured."
fi

# 9. Check File Length (DEV_GUIDE §3: max 700 lines)
echo "📏 Checking file lengths..."
./server_tools/scripts/check_file_length.sh --strict

# 10. Check bare console.log (DEV_GUIDE §6 — bare console.log is forbidden)
echo "🔇 Checking bare console.log..."
BARE_LOGS=$(grep -rn 'console\.log(' \
    frontend/core_components frontend/reusable_components \
    --include='*.js' \
    | grep -v 'IS_DEV_MODE' \
    | grep -v ':[[:space:]]*//' \
    || true)
if [ -n "$BARE_LOGS" ]; then
    echo "$BARE_LOGS" | head -20
    BARE_COUNT=$(echo "$BARE_LOGS" | wc -l)
    echo "  ⚠️  Found $BARE_COUNT bare console.log call(s) without IS_DEV_MODE guard."
    echo "  ℹ️  Wrap with: if (IS_DEV_MODE) console.log(...)"
else
    echo "  ✅ No bare console.log calls found."
fi

# 11. Check import boundaries (reusable_components must not import from core_components)
echo "🚧 Checking import boundaries..."
./server_tools/scripts/check_import_boundaries.sh

# 12. Go Backend Tests (with coverage floor)
echo "🧪 Running Go backend tests..."
COVERAGE_FLOOR=7
go test ./backend/... -count=1 -coverprofile="$QA_TEMP_DIR/coverage.out"
COVERAGE_REPORT="$(go tool cover -func="$QA_TEMP_DIR/coverage.out")"
COVERAGE=$(printf '%s\n' "$COVERAGE_REPORT" | tail -1 | awk '{print $3}' | tr -d '%')
echo "  📊 Total coverage: ${COVERAGE}%  (floor: ${COVERAGE_FLOOR}%)"
if [ "$(echo "$COVERAGE < $COVERAGE_FLOOR" | bc -l)" = "1" ]; then
    echo "  ❌ Coverage ${COVERAGE}% is below the required floor of ${COVERAGE_FLOOR}%."
    exit 1
fi
echo "  ✅ Coverage check passed."

# 13. Additional Go Workspace Tests
# Backend packages already ran above with coverage, so do not run them twice.
echo "🧪 Running additional Go workspace tests..."
GO_TEST_PACKAGES=()
GO_PACKAGE_LIST="$(go list ./...)"
while IFS= read -r package; do
    [[ -n "$package" ]] || continue
    [[ "$package" =~ /(backend|node_modules|dist-public|public-slice|open-source-export)(/|$) ]] && continue
    GO_TEST_PACKAGES[${#GO_TEST_PACKAGES[@]}]="$package"
done <<< "$GO_PACKAGE_LIST"
if [ "${#GO_TEST_PACKAGES[@]}" -eq 0 ]; then
    echo "  ℹ️  No additional non-backend Go packages found."
else
    go test "${GO_TEST_PACKAGES[@]}" -count=1
fi

# 14. Vite build (catches broken imports that static checks miss)
# This only proves the frontend still compiles; the result is discarded.
# Whether the tracked bundle in app/frontend/dist matches its source is a
# release question, checked by audit_browser_bundle.py in release verify.
echo "🏗️  Building frontend..."
npm run build -- --outDir "$QA_TEMP_DIR/frontend-dist"

# 15. Run E2E Smoke Tests (if credentials exist and the server is healthy)
E2E_STATUS="SKIPPED"
E2E_REASON=""
if [ ! -f "$QA_CREDENTIAL_FILE" ]; then
    E2E_REASON="test credential file is absent"
    echo "⚠️  E2E SKIPPED: $E2E_REASON."
    echo "   (Provide test credentials and a Filterest-owned runtime before running Playwright smoke.)"
elif curl --fail --silent --show-error --insecure --head --connect-timeout 3 --max-time 10 "$QA_BASE_URL" >/dev/null; then
    if [ "${QA_PLAYWRIGHT_FULL:-0}" = "1" ]; then
        echo "🎭 Running full E2E matrix..."
        PLAYWRIGHT_HTML_OPEN=never npm run test:e2e
        E2E_STATUS="PASS (full matrix)"
    else
        QA_PLAYWRIGHT_PROJECT="${QA_PLAYWRIGHT_PROJECT:-desktop-card}"
        QA_PLAYWRIGHT_SPECS=(
            "testing/e2e/smoke.spec.ts"
            "testing/e2e/L_auth/L1_login.spec.ts"
        )

        echo "🎭 Running E2E smoke tests (${QA_PLAYWRIGHT_PROJECT})..."
        PLAYWRIGHT_HTML_OPEN=never playwright test --project="${QA_PLAYWRIGHT_PROJECT}" "${QA_PLAYWRIGHT_SPECS[@]}"
        E2E_STATUS="PASS (smoke: $QA_PLAYWRIGHT_PROJECT; full matrix not run)"
        echo "   (Run QA_PLAYWRIGHT_FULL=1 npm run qa for the full Playwright matrix.)"
    fi
else
    E2E_REASON="local server health check failed at $QA_BASE_URL"
    echo "⚠️  E2E SKIPPED: $E2E_REASON."
    echo "   (Run '../ctl' from the application root to start the server.)"
fi

if [[ "$E2E_STATUS" == "SKIPPED" ]]; then
    echo "⚠️  QA PARTIAL: source checks passed; E2E SKIPPED ($E2E_REASON)."
else
    echo "✅ QA PASS: source checks passed; E2E $E2E_STATUS."
fi
