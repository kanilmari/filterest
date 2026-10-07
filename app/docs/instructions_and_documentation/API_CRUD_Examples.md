<!--
API_CRUD_Examples.md
What: Practical command recipes for Filterest's API-backed CRUD CLI.
Between: Shell users, agent workflows, and the Filterest HTTP dataset APIs.
Why: Keeps row/table maintenance examples close to the canonical no-direct-SQL workflow.
-->

# API CRUD Examples

Use `./filterest data` when you need table, column, row, or supported administrator maintenance through the application API. It logs in to the native dev app, fetches CSRF, and calls the same backend routes as the UI/MCP tooling. Do not replace these commands with direct SQL writes.

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

## Administrator Accounts And Sign-in Verification

Administrators can inspect non-secret account state and provision another administrator directly through the protected application API. For a remote site such as Fintravel, keep credentials out of shell history by asking the command to prompt in the visible terminal:

```bash
./filterest data --base-url https://fintravel.fi --prompt-credentials \
  --credential-username EXISTING_ADMIN_USERNAME user-auth-list
```

The credential option `--credential-username` takes the private **login name**.
The list contains the user id, public **display name** (the compatibility JSON
field `username`), enabled state, admins-group membership,
administrator-access flag, and sign-in verification method. It never returns
login names, email addresses, passwords, PINs, PIN hashes, or authenticator secrets.

After copying the current user id from that fresh read, the following command enables the account, adds it to the admins group, allows administrator access, and selects password-only sign-in in one transaction:

```bash
USER_ID=replace_with_fresh_user_id
./filterest data --base-url https://fintravel.fi --prompt-credentials \
  --credential-username EXISTING_ADMIN_USERNAME \
  user-auth-set "$USER_ID" none \
  --confirm-user-id "$USER_ID" \
  --confirm-method none
```

Use `fixed_pin` instead of `none` to set a 4–8 digit fixed PIN. The command asks for the new PIN and its confirmation without echoing or placing either value in command history. The `email` method is accepted only when the installation has a working Postmark token and sender address. TOTP authenticator secrets are deliberately not managed by this command.

### Login Names, Display Names And Session Control

Inspect `system_users` for public account information; its `username` column is
the display name. An administrator's generic row edit can change that display
name, but cannot change the private login name stored in the restricted table.
Ordinary users use their Account profile for their own edits; granting generic
editor rights on an account dataset does not authorize them to write it.

These dedicated HTTP requests use the normal authenticated session and CSRF
proof (`X-CSRF-Token`). Keep password/name payloads in protected input files or
use the browser's Account profile; never place real credentials in examples or
shell history. The CRUD CLI's commands above manage authentication methods;
they do not provide a login-name-change subcommand.

| Request | JSON body | Result |
|---|---|---|
| `POST /api/update-profile` | `{"username":"Public Display","current_password":"<current password>"}` | Changes the current account's public display name. |
| `POST /api/update-profile` | `{"login_name":"<new private name>","current_password":"<current password>"}` | Changes the private name; keeps this sign-in and invalidates the account's other sign-ins. |
| `POST /api/sign-out-other-devices` | `{"current_password":"<current password>"}` | Keeps this sign-in and invalidates the others, without renaming. The profile also accepts `sign_out_other_devices:true`. |
| `POST /api/admin/user-login-name` | `{"user_id":42,"login_name":"<new private name>"}` | A current administrator changes another account's private name, ending all its sign-ins. Use a freshly read id; own-account changes use the profile. |

Registration accepts the login name in `username` and the display name in
`display_name`; sign-in still accepts its private name in `username`. Profile
readback and administrator lists return only the public name. A successful
name-change reply contains status and mail-delivery status, not the private
value; owner-directed mail may contain it. A failed delivery does not undo a
committed account change. Profile login-name changes allow three attempts in
five minutes; fixed program/development names refuse changes.

The site setting **Display name may equal login name** defaults to yes for
ordinary accounts. When no, new accounts and actual name edits must leave
different names; existing equal pairs and sign-in are preserved. Administrator
names always differ. Name conflicts return HTTP 409 with a translated reason.
The upgrade keeps existing login names unchanged and allocates `admin_<n>`
display names for existing administrators (`auto_<n>` for API-only ones).
See [Permission Model](Permission_Model.md#account-names-and-account-maintenance)
for the complete rule and [Program Accounts](Program_Accounts.md) for fixed
automation identities, provisioning and password rotation.

## Dataset And Field Symbols

The Symbols administrator API stores only a reviewed filesystem symbol key in
dataset or field metadata. Start with a fresh read so the terminal shows the
current positive dataset UID and available keys:

```bash
./filterest data --base-url https://fintravel.fi --prompt-credentials \
  --credential-username EXISTING_ADMIN_USERNAME symbols
```

After copying the UIDs from that response, assign one exact key with matching
confirmations. The command reads the target before the write and verifies the
authoritative API state afterwards:

```bash
TRAVEL_INFO_UID=replace_with_fresh_table_uid
./filterest data --base-url https://fintravel.fi --prompt-credentials \
  --credential-username EXISTING_ADMIN_USERNAME \
  assign-symbol dataset "$TRAVEL_INFO_UID" map \
  --confirm-target-uid "$TRAVEL_INFO_UID" --confirm-icon-key map

TRAVEL_DEALS_UID=replace_with_fresh_table_uid
./filterest data --base-url https://fintravel.fi --prompt-credentials \
  --credential-username EXISTING_ADMIN_USERNAME \
  assign-symbol dataset "$TRAVEL_DEALS_UID" payments \
  --confirm-target-uid "$TRAVEL_DEALS_UID" --confirm-icon-key payments

USERS_UID=replace_with_fresh_table_uid
./filterest data --base-url https://fintravel.fi --prompt-credentials \
  --credential-username EXISTING_ADMIN_USERNAME \
  assign-symbol dataset "$USERS_UID" group_center_filled \
  --confirm-target-uid "$USERS_UID" --confirm-icon-key group_center_filled
```

Use `./filterest language upsert` for corresponding dataset-language keys; keep those
writes separate so names and icons have independent readback evidence.

## Optional Home Page API

The front page is disabled by default. `GET /api/front-page` returns 404 while
`separate_front_page` is off. When enabled, it returns `{viewer_id, site_name, background,
blocks, partial}`. Each block contains `{dataset, result_limit, columns, types,
data}` from the ordinary results handler, capped to its requested row count.
Denied, hidden and failing datasets leave no name or placeholder. Delegates keep
the request actor and transaction, request text summaries with `__newest DESC`,
skip the count, and never request card or image enrichment. `viewer_id` binds the
response to the actual session viewer. No new block starts after the three-second budget.

Only administrators write front page configuration. `GET /api/admin/front-page`
reads the common scope; `?user_id=42` reads that account's scope, and
`?user_query=text` searches at most twenty public display names. The scope read
returns `{settings, background, background_error, scope, saved, inherits_common,
source, version, blocks, datasets}`. Dataset candidates carry `newest_capable`
and `can_read`; blocks carry `dataset`, `result_limit`, `sort_order`, `enabled`
and `can_read`. Never use generic row writes for `system_front_page_blocks`.

POST exactly one operation to `/api/admin/front-page`:

- `{settings:{separate_front_page:false,front_page_button_shows_site_name:false}}`
- `{user_id:42,version:"opaque value from GET",blocks:[{dataset:"tiketit",result_limit:5,sort_order:1,enabled:true}]}`
- `{user_id:42,version:"opaque value from GET",reset:true}`
- `{user_id:42,version:"opaque value from GET",copy_from_common:true}`

Omit `user_id` or use null for common. Lists contain at most twenty distinct
content datasets with a newest column; positions are unique from 1 to 100 and
limits are 1 to 20. Any saved account row, even disabled, replaces common wholly.
An empty list resets the scope: accounts inherit common, common uses the computed
readable project-menu default (at most twelve blocks of five rows). Copy uses the
saved common list, or that account's readable default. A successful scope write
returns `{version}`; a stale version returns 409. Versions survive resets in
protected `system_front_page_revisions` metadata, so a previously empty editor
cannot silently overwrite newer work. This metadata is excluded from dataset
registration and settings, refuses generic writes, and cascades with account
deletion. Saves lock account existence until commit. Treat versions
as opaque; `"none"` identifies only a scope that has never been written.

POST multipart to `/api/admin/front-page/background` with `background_image`
and optional `focal_x`/`focal_y` from 0 to 1. With an existing image, omit the file
to change its focal point. The complete multipart body is capped at 10 MB;
PNG, JPEG and WebP are accepted. DELETE removes it. Both return `{background}`.
The background object is `{storage_key,original_name,mime_type,focal_x,focal_y}`;
null means none. Use `/storage/<storage_key>` or replace its `original` segment
with `1000` or `2160`. Storage serves only the configured file when the feature
is on and the current visitor can browse. Replaced files are removed after
commit; newly saved files are removed on rollback.

Authentication bootstrap adds `separate_front_page` and
`front_page_button_site_name` on every response. An empty button name means the
translated `front_page` key; unavailable optional configuration leaves it off.
