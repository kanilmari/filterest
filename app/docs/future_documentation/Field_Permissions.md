<!-- Describes group-specific field read, insert and edit authorization. -->
<!-- Connects dataset and row rights with field security across every data path. -->
<!-- Keeps presentation choices distinct from enforceable access decisions. -->
<!-- Extends the permission model without duplicating protected-secret behavior. -->

# Field Permissions

View field settings already choose fields and their order for a view, including
group assignments and priorities. Resolution prefers personal, then group,
then site choices, then metadata defaults, intersected with actual database
read rights. These are presentation choices for one view, not per-group field
authorization: another view or data route is not bound by that selection.
**Hiding a field in a view never secures it.** Selecting fields also grants
neither a view right nor a dataset right.

Existing column rules cover global hiding, server-only delivery, hiding article
fields unless the row is one's own, insertability and UI editability. They are
column-wide rules, including for administrators, rather than group-specific
field grants.

## What it makes possible

Administrators can allow a group to read, insert or edit particular fields
independently. Without field read permission, the server omits that field
from every view, response, export and API result, regardless of presentation
choices. Search, filters and sorting must neither use nor reveal its values
for that reader. Insert and edit permissions are enforced on every server
write path, including imports, relations and automation.

## Concepts

- **Field grant:** a group's right to read, insert or edit a stable dataset field.
- **Effective field permission:** the decision for a person after combining
  group membership with dataset, row and field restrictions.
- **Presentation selection:** the fields a view chooses to show within those
  effective permissions; it supplies no authority itself.
- **Visibility gate:** a mandatory condition deciding whether a row may be
  exposed before any permitted fields are delivered.

## General data model

Field grants relate internal groups, stable dataset and field identities, and
actions. The [permission model](../instructions_and_documentation/Permission_Model.md)
owns group combination and explanations. [Row policies](Row_Policies.md) and
the visibility gate constrain accessible rows; a field grant cannot bypass
them or grant a dataset action. Global column restrictions remain additional
constraints. [Protected fields](Protected_Fields.md) add encryption, masking
and deliberate reveal within ordinary field rights; they are a separate layer.

## Implementation principles

Put administration in Permissions, with a clear link from View field settings.
Show access and presentation as separate decisions, including their effective
result for a selected group. Use one server decision across reads and writes;
reject unauthorized writes rather than silently accepting discarded values.
Permission changes invalidate cached decisions and retained field values.
