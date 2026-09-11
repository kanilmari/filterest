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

Explicit new-column roles also initialize show_key_on_card: additional information
and links show their keys; title, description and keywords hide them. Other roles
keep the database default. In mixed role combinations a primary role's hidden
label takes priority. This initialization never rewrites existing datasets and
does not change older API callers that omit column_card_roles.
