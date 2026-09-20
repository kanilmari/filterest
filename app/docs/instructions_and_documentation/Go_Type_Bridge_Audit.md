# Go-TypeScript Type Bridge Audit

Ticket scope: `#769 Epic: Go-TypeScript Type Bridge`, limited to Phase A plus the decision checkpoint.

Audit date: 2026-04-02

## What Was Audited

The current backend was checked for:

- Go structs with `json:` tags that could be mirrored into frontend types
- Non-test files that still use `map[string]interface{}` or `map[string]any`
- Existing frontend consumers that already rely on stable request/response contracts

## Findings

### Structural counts

- `104` non-test Go structs currently carry `json:` tags
- Those structs are spread across `51` backend files
- `54` of the structs are exported
- `53` non-test backend files still use `map[string]interface{}` or `map[string]any`

### What is actually stable enough to mirror now

The valuable Phase A contracts are the small fixed surfaces that already behave like explicit APIs:

- `ErrorBody` in `filterest/app/backend/core_components/httpresponse/httpresponse.go`
- FK cache admin contracts in `filterest/app/backend/core_components/system_table_tools/fk_cache_triggers_admin.go`
- Dataset header config contracts in `filterest/app/backend/core_components/system_table_tools/dataset_header_config.go`
- Child-tab config contracts in `filterest/app/backend/core_components/system_table_tools/child_tab_config.go`
- Card visibility column contracts in `filterest/app/backend/core_components/system_table_tools/card_visibility.go`

These are useful because the frontend already consumes them as named, fixed-shape admin or infrastructure responses.

### What is not worth typing broadly yet

Large parts of the API still intentionally move through dynamic maps:

- Dynamic CRUD and dataset-read flows under `filterest/app/backend/core_components/dynamic_table_tools/**`
- Tree/view wrapper responses that mix stable node arrays with dynamic column/detail maps
- Auth/login and several admin helpers that still return ad-hoc `map[...]` envelopes
- Query/result endpoints whose payload shape depends on database-defined schema rather than source-defined structs

This means a broad Go-to-TypeScript bridge would still stop short of the highest-traffic dynamic surfaces, while adding maintenance overhead across a JS-first frontend.

## Decision Checkpoint

### Phase A decision

Proceed with a small allowlisted mirror only.

That means:

- keep generation limited to stable contracts that already exist as fixed Go structs
- let the generated output feed JSDoc/editor typing in selected JS files
- avoid router-wide scans, client generation, or dynamic CRUD typing

### Phase B decision

Do not proceed into Phase B from this audit alone.

Phase B is not yet clearly justified because:

- the frontend is still plain JS with no TypeScript build/check step
- many important endpoints still return dynamic map-based envelopes
- the endpoint map is much wider than the stable-struct subset
- broad typing would create a misleading sense of coverage over a system whose central value proposition is dynamic schema handling

## Phase A Deliverable Shape

The intentionally narrow implementation is:

1. an allowlisted generator script for stable Go JSON structs
2. one generated frontend `.d.ts` mirror file
3. limited JSDoc integration in the JS modules that already consume those stable contracts

Regenerate with:

```bash
python3 filterest/app/server_tools/scripts/generate_go_contract_types.py
```

Verify drift with:

```bash
python3 filterest/app/server_tools/scripts/generate_go_contract_types.py --check
```

## Phase B Foundation (2026-04-03)

The next useful slice is now in place as backend infrastructure, not yet as a generated client:

- runtime route inventory is generated from `RegisterRoutes(...)` plus `RouteProfiles`, not from the older `registerRoute(...)` AST assumption
- the checked-in manifest lives at `filterest/app/frontend/generated/backend_route_manifest.json`
- the generator script is `go run ./filterest/app/server_tools/scripts/generate_route_manifest.go`
- drift is enforced in `filterest/app/server_tools/scripts/qa.sh` via `--check`
- the manifest covers three scenarios: `production`, `development`, and `api_language` (`production` / `development` here are manifest scenario labels, not the operator-facing `ENVIRONMENT_TYPE` literals `prod` / `dev`)
- each manifest route now records:
  - `path_pattern`
  - `match_type`
  - `handler_name`
  - optional `conditional_source`
  - per-scenario `profile_name`, `skip_stages`, and `admin_only`

### Registration-owned method metadata

Every public route now declares its allowed methods in the runtime registration call. The router enforces that declaration before the handler runs, `GET` declarations include `HEAD`, and the generated manifest records the same `methods` with the `route_registration` source label. Manifest generation fails if a registered route lacks a declaration.

This removes the earlier curated subset and makes the method inventory trustworthy across the public backend. Stable frontend wrappers continue to select their callable method from the same manifest, ignoring `HEAD` as the transport-level companion to `GET`.

### Frontend pilot status

The frontend now consumes this manifest in three narrow layers instead of trying to jump straight to a generated full client:

- `filterest/app/frontend/core_components/endpoints/stable_api_inventory.js` joins frontend route names to backend manifest data (`path`, `profile`, `scenarios`, curated `methods`)
- `filterest/app/frontend/core_components/endpoints/stable_endpoint_router.js` uses that manifest-backed method metadata for stable wrappers and rejects explicit method mismatches before they hit the generic pipeline
- the first stable-candidate consumer pilot is `dataset_header_config_view.js`, which now uses manifest-backed wrappers for:
  - `getDatasetHeaderConfig`
  - `saveDatasetHeaderConfig`
- the second stable-candidate consumer pilot is `card_visibility_view.js`, which now uses manifest-backed wrappers for:
  - `getCardVisibility`
  - `updateCardVisibility`

The dataset-header pilot was chosen because it exercises both a simple `GET` and a multipart `POST` without touching the broader dynamic dataset CRUD surface. The adjacent `datasetNames` bootstrap call intentionally stays on the generic `endpoint_router`, since dataset discovery is still part of the dynamic route world rather than the explicit stable-contract island.

The card-visibility pilot extends the same pattern to a second real admin consumer with tree selection plus JSON save semantics. That helps confirm that manifest-backed wrappers are practical not only for simple load/save forms, but also for matrix-style configuration tools that keep local dirty state and save batched column arrays.

Regenerate with:

```bash
go run ./filterest/app/server_tools/scripts/generate_route_manifest.go
```

Verify drift with:

```bash
go run ./filterest/app/server_tools/scripts/generate_route_manifest.go --check
```

## Environment Note

Live `./db_task` ticket updates were blocked during this audit. The local environment reported:

- `./db_task show 769` -> `Cannot reach server at https://localhost:8082`
- `./ctl` could not start because its local DB check failed
- direct local DB reads also failed with empty client errors (`psycopg2.OperationalError('')` / `psql: error:`) even while `pg_isready -h localhost -p 5433` reported the port as accepting connections

Because of that, the Phase A decision was captured here in repo docs instead of in the live DB ticket.
