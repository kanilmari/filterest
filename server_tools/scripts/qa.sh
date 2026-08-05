#!/bin/bash
# qa.sh
# Runs the full Quality Assurance suite for the project.
# Includes CSS linting, import checks, and other validation steps.
set -e

echo "🔍 Running QA Checks..."

# 1. Lint CSS
echo "🎨 Linting CSS..."
npm run lint:css
node ./frontend/styles/check_css_imports.js ./frontend/styles/imports.css --fix-imports

# 2. Lint JS (ESLint)
echo "🧠 Linting JS..."
npx eslint . --fix

# 3. Check JS Imports
echo "🔗 Checking JS Imports..."
node ./frontend/check_js_imports.js ./frontend/main.js --exclude=others/**,frontend/styles/**,node_modules/**,favefox/**,frontend/check_js_imports*.js --fix-imports

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
./server_tools/check_gitignore/check_gitignore.sh

# 8. Public export omits private DB-ticket epic convention checks
echo "📜 Skipping private epic convention checks in public Filterest."
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
go test ./backend/... -count=1 -coverprofile=coverage.out
COVERAGE=$(go tool cover -func=coverage.out | tail -1 | awk '{print $3}' | tr -d '%')
echo "  📊 Total coverage: ${COVERAGE}%  (floor: ${COVERAGE_FLOOR}%)"
rm -f coverage.out
if [ "$(echo "$COVERAGE < $COVERAGE_FLOOR" | bc -l)" = "1" ]; then
    echo "  ❌ Coverage ${COVERAGE}% is below the required floor of ${COVERAGE_FLOOR}%."
    exit 1
fi
echo "  ✅ Coverage check passed."

# 13. Go Workspace Tests
echo "🧪 Running full Go test suite..."
GO_TEST_PACKAGES=()
while IFS= read -r package; do
    [[ -n "$package" ]] || continue
    GO_TEST_PACKAGES[${#GO_TEST_PACKAGES[@]}]="$package"
done < <(go list ./... | grep -Ev '/(dist-public|public-slice|open-source-export)(/|$)')
if [ "${#GO_TEST_PACKAGES[@]}" -eq 0 ]; then
    echo "  ❌ No Go packages found for workspace test suite."
    exit 1
fi
go test "${GO_TEST_PACKAGES[@]}" -count=1

# 14. Vite build (catches broken imports that static checks miss)
echo "🏗️  Building frontend..."
npm run build

# 15. Run E2E Smoke Tests (if server is running on port 8082)
if [ ! -f dev_env_test_creds.txt ]; then
    echo "⚠️  Skipping E2E tests because dev_env_test_creds.txt is not present in this public Filterest checkout."
    echo "   (Provide public test credentials and a Filterest-owned runtime before running Playwright smoke.)"
elif curl -k -s -I https://localhost:8082 >/dev/null; then
    if [ "${QA_PLAYWRIGHT_FULL:-0}" = "1" ]; then
        echo "🎭 Running full E2E matrix..."
        PLAYWRIGHT_HTML_OPEN=never npm run test:e2e
    else
        QA_PLAYWRIGHT_PROJECT="${QA_PLAYWRIGHT_PROJECT:-desktop-card}"
        QA_PLAYWRIGHT_SPECS=(
            "testing/e2e/smoke.spec.ts"
            "testing/e2e/L_auth/L1_login.spec.ts"
        )

        echo "🎭 Running E2E smoke tests (${QA_PLAYWRIGHT_PROJECT})..."
        PLAYWRIGHT_HTML_OPEN=never npx playwright test --project="${QA_PLAYWRIGHT_PROJECT}" "${QA_PLAYWRIGHT_SPECS[@]}"
        echo "   (Run QA_PLAYWRIGHT_FULL=1 npm run qa for the full Playwright matrix.)"
    fi
else
    echo "⚠️  Skipping E2E tests because server is not running on port 8082."
    echo "   (Run './ctl' to start the server)"
fi

echo "✅ All QA checks passed!"
