# Testing Fixture Bundle

This directory holds the canonical placeholder bundle for local and automated testing.

Important:
- Editing `test_variables.env` does **not** change the real project `.env`.
- The values here are test-only defaults and should stay obviously fake.
- Most values rarely need edits, but new env vars may be added when the codebase grows.

Contents:
- `test_variables.env` - the test-only environment template.
- `generate_dummy_test_database.py` - regenerates the curated schema and seed bundle.
- `generated/schema.sql` - a small, boot-focused schema skeleton derived from the live schema inventory.
- `generated/seed.sql` - harmless filler rows that satisfy the bundle's fixture needs.

Regeneration:

```bash
python3 testing/essential/generate_dummy_test_database.py
```

The generator reads `data/db_backups/schema_info.csv` by default so the checked-in
schema stays aligned with the current live schema inventory.

