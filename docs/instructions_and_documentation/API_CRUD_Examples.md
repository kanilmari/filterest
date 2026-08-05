<!--
API_CRUD_Examples.md
What: Practical command recipes for Easelect's API-backed CRUD CLI.
Between: Shell users, agent workflows, and the Easelect HTTP dataset APIs.
Why: Keeps row/table maintenance examples close to the canonical no-direct-SQL workflow.
-->

# API CRUD Examples

Use `./filterest data` when you need table, column, or row maintenance through the application API. It logs in to the native dev app, fetches CSRF, and calls the same backend routes as the UI/MCP tooling. Do not replace these commands with direct SQL writes.

## Basic Inspection

```bash
./filterest data list-datasets
./filterest data columns app_service_catalog
./filterest data rows app_service_catalog --row-count 5
./filterest data rows app_service_catalog --filter id=392 --row-count 1
```

`rows` prints the full `get-results` JSON payload. The row id to use with `update-row` is under `data[].id`.

## Language Table Workflow

For normal language-key updates, prefer the dedicated helper because it uses the language-key API and preserves the intended translation workflow:

```bash
./filterest language get view_card
LANG_KEY=replace_with_target_key
./filterest language upsert "$LANG_KEY" --fi "Kortit" --en "Cards"
```

Use `./filterest data` when you need to inspect the underlying `system_lang_keys` row, confirm its id, or make a generic row-level repair:

```bash
./filterest data columns system_lang_keys
./filterest data rows system_lang_keys --filter lang_key=view_card --row-count 1
ROW_ID=replace_with_data_id
./filterest data update-row system_lang_keys "$ROW_ID" --set 'fi=Kortit' --set 'en=Cards'
```

Use the id returned by `rows`; do not copy an id from an old example. If the key is missing, prefer `./filterest language upsert ...` first. Reach for generic `add-row` only when you intentionally need raw row creation through the dataset API:

```bash
./filterest data add-row system_lang_keys --row-json '{"lang_key":"new_example_key","fi":"Artikkeli","en":"Article"}'
```

## Row Maintenance Workflow

Start with a narrow read, then update only the fields you mean to change:

```bash
./filterest data rows app_service_catalog --filter header=Firefox --row-count 1
ROW_ID=replace_with_data_id
./filterest data update-row app_service_catalog "$ROW_ID" --set 'header=Firefox' --set published=true --set enabled=true
./filterest data rows app_service_catalog --filter id="$ROW_ID" --row-count 1
```

`--set` parses JSON-like values. That is useful for booleans and numbers, for example `published=true` or `association_type_id=-1`. Plain text with spaces should be quoted as one shell argument:

```bash
./filterest data update-row app_service_catalog "$ROW_ID" --set 'type_of_operation=web browser'
```

For text columns that intentionally store JSON-looking text, use an `@file` payload so the outer JSON keeps the stored value as a string:

```json
{
  "description": "{\"fi\":\"Avoimen lähdekoodin selain.\",\"en\":\"Open-source browser.\"}"
}
```

```bash
./filterest data update-row app_service_catalog "$ROW_ID" --updates-json @/tmp/service_catalog_updates.json
```

## Safer Creation And Deletion

For new rows, prefer `@file` payloads once the row has more than one or two fields:

```json
{
  "header": "Example service",
  "description": "Short description",
  "published": false,
  "enabled": true
}
```

```bash
./filterest data add-row app_service_catalog --row-json @/tmp/new_service_row.json
```

Destructive commands require explicit confirmation flags:

```bash
ROW_ID_TO_DELETE=replace_with_target_id
./filterest data delete-rows app_service_catalog --id "$ROW_ID_TO_DELETE" --confirm
./filterest data drop-dataset app_scratch_table --confirm-dataset-name app_scratch_table
./filterest data modify-columns app_scratch_table --remove old_column --allow-column-removal
```

Run a read command immediately before destructive operations and keep the output in the terminal scrollback. That makes the intended target visible without bypassing application validation.
