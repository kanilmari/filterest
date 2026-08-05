<!-- dtt_readme.md: dynamic table tools overview -->
This folder contains dynamic packages for working with database tables, columns and rows. It hosts both table-specific tools and general-purpose utilities.

Table-specific functions usually live in packages whose names start with `dtt_`. When a new route is registered it defaults to inserting `specific_table_related = true`; adjust that route metadata in router registration code or a dedicated application API, never by direct SQL. Non-table-specific tools typically keep the flag false.

`dtt_system_table_folders` is one intentional mixed package: folder-management routes stay tableless, but `/api/update-table-folder` is explicitly registered as table-specific in `router/routing_builder.go` because moving a dataset between folders must be authorized against one concrete table.
