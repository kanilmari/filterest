# Testing Fixture Bundle

This directory holds the canonical placeholder inputs and generator for local
and automated testing. Generated SQL is recreated output rather than
source-owned product behavior.

Important:
- Editing `test_variables.env` does **not** change the real project `.env`.
- The values here are test-only defaults and should stay obviously fake.
- Most values rarely need edits, but new env vars may be added when the codebase grows.

Contents:
- `test_variables.env` - the test-only environment template.
- `generate_dummy_test_database.py` - regenerates the curated schema and seed bundle.
- `generated/schema.sql` - a recreated, boot-focused schema skeleton derived from the live schema inventory.
- `generated/seed.sql` - recreated harmless filler rows that satisfy the bundle's fixture needs.

The generator writes disposable output under the installation-owned
`data/testing/essential/generated/` directory. An embedding product that
maintains a separate fixture bundle can pass explicit `--schema-out` and
`--seed-out` paths from its own adapter.

Regeneration:

```bash
python3 app/testing/essential/generate_dummy_test_database.py
```

By default, the generator reads the installation-owned
`data/db_backups/schema_info.csv`. Pass `--schema-info` whenever the inventory
lives elsewhere.
