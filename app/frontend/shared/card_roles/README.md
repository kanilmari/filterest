# Card renderer role protocol

The single canonical definition is the JSON-shaped default export in
[catalog.js](catalog.js). Native Filterest serves ES modules directly from
/frontend, so this shared protocol lives under frontend/shared. The colocated
Go package embeds the same file and strictly decodes its JSON export; it never
evaluates JavaScript. Vite and standalone builds use the same source.

Role identifiers and supported numeric suffixes/modifiers are an immutable
renderer protocol. Adding a new role requires renderer code and validation
changes, not a mutable lookup-table row. Display labels have translation keys
and bootstrap Finnish, English, Chinese and Cantonese copy. Runtime translations
remain authoritative.

Each dataset column keeps its chosen assignment in
system_column_details.card_element (varchar(255), default details). Dataset
creation accepts an optional column_card_roles map, validates every key/value
before opening its transaction, and writes assignments in the same transaction
as the new dataset. Older callers keep the existing default. This adds no table,
migration, automatic role assignment, AI inference or translation-writing call.

Existing numbered description/details/details_link/hidden roles, comma-separated
combinations and +lang_key / +lang-key modifiers remain valid. The basic creation
picker offers existing base roles; advanced metadata remains compatible.

Field-label visibility inherits the current policy in
`public.resolve_card_label_visibility(override boolean, role text)`.
The catalog defines valid role syntax and authoring labels only. Assigning a role
never records an explicit label override. New metadata stores SQL NULL;
existing explicit booleans are preserved. The administrator API exposes the
stored nullable `show_key_on_card_override` separately from the effective
`show_key_on_card` boolean. Dataset-specific moderation overlays remain explicit
product behavior outside this general default policy.

Without an explicit override, additional-information and link roles show keys;
header, description and keyword roles hide keys and take precedence in mixed
roles. Empty and unknown roles hide keys. The database resolver recognizes the
existing numbered roles and language-key modifiers.
