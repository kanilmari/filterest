# Visual Guardian - Technical Documentation

## Overview
Visual Guardian is the automated Quality Assurance system for Easelect. It combines:
1.  **The Constitution**: Design rules defined in `docs/constitution/design/technical_definitions.md`.
2.  **The Engine**: Playwright tests in `testing/visual_guardian/*.spec.ts` that capture screenshots.
3.  **The Guardian**: An AI-powered analysis script (`analyze_ui.py`) that verifies screenshots against the Constitution.

## Scope Boundary
Visual Guardian is intentionally scoped to **visual** QA:
- It analyzes screenshots for layout, styling, responsive presentation, and other constitution-level UI issues.
- It does **not** triage ordinary Playwright assertion failures from `testing/e2e/`.

Ordinary Playwright failures are currently expected to be debugged using the standard runner artifacts:
- console output from `./safe_test` / `npx playwright test`
- the HTML report in `testing/playwright-report`
- retry traces in `testing/test-results`
- Visual Guardian screenshots in `testing/test-results/visual_guardian`
- Visual Guardian failure-page artifacts in `testing/test-results-visual/<test-output-dir>/` including `page-source.html`

This means AI-assisted triage is currently a specialized capability for visual regressions, not a general requirement for every Playwright failure.

## AI Configuration
The analysis is performed using OpenAI's Vision API.

-   **Script**: `testing/visual_guardian/analyze_ui.py`
-   **Model**: `gpt-5.2` (default)
    -   **Config**: Override via `VISUAL_GUARDIAN_MODEL` (or `OPENAI_VISION_MODEL` / `OPENAI_API_MODEL`).
-   **Input**:
    -   Screenshots captured by Playwright (base64 encoded).
    -   Context from `technical_definitions.md` (Rules) and `README.md` (Principles).
-   **Output**: JSON report indicating PASS/FAIL status, detected device, and list of issues.

Notes:
- The analysis script currently uses OpenAI's Chat Completions vision path when `OPENAI_API_KEY` is set, and falls back to Anthropic when only a valid Anthropic key is available.

## Running the Guardian
To execute the full suite (Tests + Analysis):
```bash
npm run guardian
```

The Visual Guardian Playwright config reuses the authenticated E2E storage state from `testing/e2e/global-setup.ts`, so captures default to a logged-in, app-ready browser context instead of relying on anonymous `/` loads.

## Directory Structure
-   `analyze_ui.py`: Main analysis script.
-   `*.spec.ts`: Playwright test files for capturing screenshots.
-   `requirements.txt`: Python dependencies (openai, python-dotenv).
