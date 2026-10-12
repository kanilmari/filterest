<!-- Describes a living, read-only overview of a site's tables for administrators. -->
<!-- Connects table profiles, current metadata, schema history and permitted dataset views. -->
<!-- Makes the site's structure and activity understandable without a separate registry. -->
<!-- Keeps confidential data outside inspection and sample disclosure under server control. -->

# Live Schema Workbench

## What it makes possible

The live schema workbench is available only to administrators. It gives them a
living, read-only overview of the whole site's data: what tables exist, what
they contain, how they relate and where activity is taking place. The site has
"come alive" through current facts about its tables, rather than a schema
document that must be regenerated to reflect each change.

This is an administrator tool for understanding the site. It goes beyond
listing the dataset registry by opening each table's structure, metadata and
safe examples. It is not another dataset presentation alongside table and card
views. Those existing views remain the place to work with a permitted dataset's
rows; the workbench offers a route into them without granting additional rights.

An alphabetical table of contents leads to **table profiles** in the same order
and form as the printed schema document. Each profile presents basic facts,
columns, constraints, outgoing and incoming relations, and masked sample rows.
It also identifies differences from the fresh-installation reference schema
and offers an action to open the table's rows in its permitted views. The
restricted schema is excluded from the overview and is never read.

## Concepts

### Table profile

A **table profile** brings together the current facts about one physical table
and its relationship to a registered dataset, where one exists. The table's
schema and name identify the inspected object; the dataset's stable identity
connects it to application metadata and navigation. Equal table names in
different schemas do not become one profile.

The system registry supplies application meaning, while the database catalogue
supplies the actual structure. A profile can expose an unregistered table's
permitted structure without pretending that it has a dataset or usable data
views. Profiles are derived from these authorities, not maintained as a second
inventory.

### Basic facts and activity

Each profile gives the administrator these facts together:

- **Column count:** the number of columns in the current table.
- **Management description:** a short explanation of the table's purpose,
  drawn from table comments and the product's language keys where available.
- **Introduction:** when the table was introduced, supported by schema history.
  The database does not itself record table creation times; missing history
  leaves this fact unknown rather than inferred from the oldest surviving row.
- **Row count:** the table's current size, with an exact count distinguished
  from an estimate.
- **Latest change:** the latest recorded row change and its time, including a
  masked indication of the last updated row where that evidence is available.

Activity facts explain their evidence and limits. A latest surviving row update
cannot prove that no later deletion occurred. An unavailable count or change
time is shown as unavailable, not as zero or an absence of activity. Facts may
be observed at different moments while the site is in use; their freshness is
visible rather than implying one simultaneous snapshot of the whole database.

### Columns, constraints and relations

The **column description** shows each column's name, data type, whether a value
is required, and its default. **Constraints** explain the table's keys,
uniqueness, value checks and other structural rules.

An **outgoing relation** identifies a table this table refers to and the columns
that connect them. An **incoming relation** identifies another table that
refers to this one. Both directions help administrators understand dependencies
and the role of a table within the site. Following a relation opens another
permitted profile; it does not confer access to the related rows.

### Masked sample rows

**Sample rows** illustrate the shape of the data through three rows from the
start, three from the middle and three from the end. These nine positions are
one part of the profile, not the purpose of the whole workbench. Start, middle
and end refer to a declared, stable row ordering, not physical storage order.
Small tables supply fewer distinct examples instead of repeating rows where
the ranges overlap; an empty table has no samples.

Samples mask passwords, hashes, identifiers, session data, IP addresses,
people's free texts and anything that looks like a secret. Masked cells remain
recognizable as withheld values rather than appearing empty. The same
disclosure boundary applies to the indication of the last updated row and to
values embedded in defaults or other metadata.

Sample inspection does not count as a full-detail row opening under
[row view counts](Row_View_Counts.md). Row counts describe the size of a table;
view counts describe readership and retain their own meaning.

### Reference-schema difference

A **reference schema** describes the structure of a fresh installation with the
same recorded database version. A **reference-schema difference** marks where
a live table's columns, types, requirements, defaults, constraints or relations
depart from that structure and lets the administrator inspect the differences.

The existing [read-only installation schema comparison](../instructions_and_documentation/Installation_Update_And_Recovery.md#read-only-installation-schema-checks)
owns the comparison meaning. The workbench brings that comparison into live
table profiles. Site-created tables absent from the reference are distinguished
from changed or missing product tables; a difference is evidence to understand,
not an instruction to repair the database. An unavailable or incompatible
reference leaves the comparison unknown rather than claiming a match.

### Opening rows in permitted views

An **open rows** action leads from a profile into the table's registered dataset
using table, card or any other view that the dataset is allowed to use. The
available choices come from the existing view eligibility rules and current
permissions. A table without an eligible dataset view retains its profile
without gaining a browsing entry point.

The action sits in each profile, below its column list, as one translated split
button: its main part opens the preferred view directly, for example "View as
cards", and its arrow lists the other eligible views, such as table or tree.
Only eligible views appear, in the reader's language, and a table with a single
eligible view shows a plain button without the arrow.

The [permission model](../instructions_and_documentation/Permission_Model.md)
continues to decide dataset, row and field access. Where
[browse restrictions](Browse_Restrictions.md) apply, they are resolved before
a view is chosen and prevent direct browsing in every view. Neither inspection
of a profile nor changing the chosen view overrides that decision.

## General data model

The workbench assembles a derived description, not a stored collection of
workbench records. It needs no separate database table. The following concepts
explain its relationships without fixing a physical schema:

| Derived concept | Meaning and relationships |
| --- | --- |
| Table profile | An inspected table identity, its current name and schema, and any corresponding registered dataset identity. |
| Basic facts | Counts, management description, introduction evidence and latest-change evidence belonging to the profile, with freshness, estimate or unavailable distinctions. |
| Column and constraint description | The profile's ordered columns and their structural rules, derived from the current catalogue. |
| Relation description | Source and target table identities and connecting columns, allowing outgoing and incoming relations to be read together. |
| Masked sample group | The profile, the start, middle or end position in its declared order, and the permitted sample values after masking. |
| Reference comparison | The table profile, compatible fresh-installation reference and explained structural differences or an unknown comparison. |
| View entry | The registered dataset identity and the existing views it is currently permitted to open. |

The registry, database catalogue, schema history and compatible reference
remain the authorities for their respective facts. Gathering them into a
profile does not create another source of truth or a separate place to edit
management descriptions, permissions or schema definitions.

## Implementation principles

- **Enforce inspection rights and masking on the server:** verify current
  administrator authority before discovery or detail queries. Apply row and
  field authorization and masking before constructing any response; raw
  values must never reach the browser for concealment. Unknown sensitivity
  withholds the value rather than assuming it is safe.
- **Keep restricted data outside every query:** exclude the restricted schema
  from discovery, counts and samples. Views, joins and relation expansion must
  not read it indirectly. Administrator status cannot relax this boundary.
- **Use read-only inspection:** queries and refreshes must not write data,
  change schema, repair differences or trigger maintenance operations. Reuse
  existing metadata without invoking processes that update it.
- **Bound the work:** use light catalogue and metadata queries, estimated counts
  for large tables and details on demand. Sampling must use bounded reads
  without scanning or sorting a whole large table to find its middle; an
  approximate middle is identified as such. Apply query limits and cancellation
  so inspection does not obstruct normal use.
- **Recheck view entry through the shared rules:** resolve current browsing
  rights before view eligibility, and validate both again when opening rows.
  A retained profile or old navigation choice cannot preserve a permission
  that has been removed. Labels and explanations use language keys and remain
  accessible in both explicit application themes.
