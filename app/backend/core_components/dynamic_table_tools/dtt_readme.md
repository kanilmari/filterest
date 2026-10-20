<!-- dtt_readme.md: dynamic table tools overview -->
This folder contains dynamic packages for working with database tables, columns and rows. It hosts both table-specific tools and general-purpose utilities.

Table-specific functions usually live in packages whose names start with `dtt_`. When a new route is registered it defaults to inserting `specific_table_related = true`; adjust that route metadata in router registration code or a dedicated application API, never by direct SQL. Non-table-specific tools typically keep the flag false.

`dtt_system_table_folders` is one intentional mixed package: folder-management routes stay tableless, but `/api/update-table-folder` is explicitly registered as table-specific in `router/routing_builder.go` because moving a dataset between folders must be authorized against one concrete table.


## Page pilot and Home article delegates

`GetResults` normalizes `view_key` before choosing a field set. Only
`image_first_page_view` adds a canonical permission check for
`/ui/view/image_first_page_view` in its catalogue scope
(`permissions.CheckDatasetRoutePermission`: the route is tableless, so a global
grant counts; the get-results check keeps the dataset boundary), before
visibility, projection, row queries and row data logs. Missing rights use the existing get-results 403 JSON error.
The existing development administrator recovery applies only when explicitly
enabled, the function remains enabled/registered and the canonical check did not error; Home links still need real grants.
All other view keys keep their previous boundary and projection.

Home's schema-version-1 article items optionally carry `view` (`article_view` or
`image_first_page_view`); absence keeps Article. The strict POST and stored-reader
validator rejects any other value. Public Home omits denied items; the title
read delegates with the chosen `view_key` and builds the matching query in the
preferred-name href. Admin save validates Page through the saving actor's Page
right and Page delegate, including disabled items. A missing setting returns no
public buttons, and admin version `none`; a first POST with `none` creates it.

The existing migration `20261015000012` materializes missing Page projections
from IFAV, and IFAV from Article (metadata when Article was absent). An unassigned
runtime Page projection retains the metadata fallback; readable columns still
bound the delivered fields. No new migration or database version is needed.
See [article presentation storage](../../../docs/instructions_and_documentation/Article_Section_Defaults.md)
and [Home buttons](../../../docs/instructions_and_documentation/Frontend_Home_Page.md).
