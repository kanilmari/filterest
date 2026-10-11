<!-- Describes limits on direct browsing that narrow an existing dataset read right. -->
<!-- Connects user groups, dataset rights and values presented through references. -->
<!-- Keeps reader focus and permission timing explicit across all views. -->
<!-- Defines restriction administration and lifecycle without a physical schema. -->

# Browse Restrictions

## What it makes possible

A user group that holds the read right on a dataset can also carry a **browse
restriction** on that dataset. The group cannot open, list, search, filter or
navigate the dataset directly, yet selected values remain readable where other
permitted content references them. For example, an article can show its author's
public display name from the accounts dataset without inviting the reader to
open the author account or browse authors.

The restriction narrows an existing read right; it never grants reading to a
group without that right. It applies to direct browsing in **all views or none**,
with no per-view exceptions. The accounts dataset is the first target. The same
model can extend to other datasets without changing these meanings.

The purpose is reader focus. This is **neither a privacy nor a security
control**: a group with the read right can still read permitted values through
references. A restriction does not make those values confidential. Data
minimisation remains with the existing
[client-delivery policy](../instructions_and_documentation/Permission_Model.md#view-presentation-and-client-delivery),
and existing row and field authorization still applies.

## Concepts

- **Read right:** a user group's dataset action right to read rows. It is the
  prerequisite for reading the dataset's values, including through references.
- **Browse restriction:** a separate limit attached to a group and dataset,
  preventing direct discovery and navigation while retaining the read right.
  Absence or removal of a restriction grants no dataset action by itself.
- **Referenced value:** a value of a target dataset presented through a
  relationship from other content the reader may read. A **referenced-value
  selection** identifies which target fields may supply such presentation, for
  example the account's public display-name field or another name field chosen
  for public attribution. Selecting one field does not select every account
  field, and displaying a name does not make the target row a browsable item.
- **Permission decision:** the resolution of the reader's group rights and
  restrictions for the relevant datasets. It establishes what may be read
  through references and what may be browsed before presentation is chosen.

## Permission check ordering

The ordering is explicit:

1. **Before any view is chosen**, the permission model resolves the reader's
   read rights and browse restrictions for both the content dataset and each
   referenced dataset. The permitted referenced-value selections are resolved
   within this decision, subject to existing authorization and client-delivery
   rules.
2. Without the target dataset's read right, this feature allows neither direct
   browsing nor reading its values through references. With the right and a
   browse restriction, selected referenced values may be read, but direct
   browsing is refused for every view.
3. A view is chosen only for content already permitted by that decision. It
   presents the allowed values and navigation; it cannot grant reading, remove
   a restriction or make a per-view exception. In the article example, the name
   is an attribution value, with no navigation into the restricted accounts
   dataset.

Changing the view cannot change the permission decision. Permission explanations
show this ordering and distinguish a missing read right from an existing right
whose direct browsing is restricted.

## Restriction lifecycle

### Administration

Administrators authorized to manage the group's dataset permissions create,
change and remove its restriction through permission administration. Holding a
read right alone does not give that authority. Creation selects a group with
the read right and the target dataset. Administrators with authority over the
target's reference presentation select or change the referenced fields; changing
that selection does not remove the browse restriction.

Removing a restriction restores direct browsing only if the group still holds
the read right and the other applicable permissions allow it. Removing a
referenced field from the selection stops its presentation through references
without altering the read grant or the restriction.

Administrators can inspect the group and dataset, the current read grant, the
configured restriction, its effective browsing outcome and the selected
referenced fields together. Retained restrictions with missing rights or targets
are distinguishable from active restrictions. History records creation, changes,
removal and lifecycle events, including the responsible actor, when the event
occurred, its reason and the previous and resulting configuration. Removing a
restriction does not erase its history.

### Changes to the read right

Revoking the group's read right makes the retained restriction dormant. It
cannot authorize reading through references while the right is absent. Granting
the read right again reactivates that retained restriction, unless an authorized
administrator explicitly removed or changed it. Permission administration shows
the retained restriction when the right is granted again, so the resulting
browsing limitation is visible. Administrators can change or remove a dormant
restriction without restoring the read right.

### Dataset and field changes

Restrictions and referenced-value selections follow stable dataset and field
identities, rather than their names. Renaming a dataset or selected field keeps
the configuration attached and updates its displayed name.

Dropping a dataset retains its restriction configuration and history for
recovery, but leaves no target to browse or read through references. Dropping a
selected field makes that referenced value unavailable; the dataset's browse
restriction remains in force, and no other field is substituted automatically.
Restoring the same dataset or field identity restores the retained configuration
after validating its relationships and the current permissions. A newly created
dataset or field with a reused name does not inherit the old configuration.

Migrations preserve these identities or use an explicit, reviewed mapping to
replacement identities. An unresolved field suspends its reference presentation;
an unresolved restriction is reported for repair rather than silently discarded
or treated as permission to browse a replacement dataset. Restoration carries
the rights, restrictions and referenced-value selections together, so recovering
data does not silently reopen browsing.

### New groups, datasets and upgrades

A new group or dataset has no browse restriction until one is explicitly
configured. Its read rights still come from the permission model; absence of a
restriction supplies no right. Removing a group retains its restriction history
without applying its configuration to a different group that reuses its name.

Upgrades preserve existing grants, active and dormant restrictions,
referenced-value selections and their history. Introducing this capability does
not infer restrictions from existing read grants or rewrite existing reference
presentation choices. Configuration migrations preserve meaning and identify
any mapping that needs administrator review.

## General data model

| Conceptual record | Meaning and relationships |
| --- | --- |
| Dataset action grant | The existing relationship between a user group, dataset and action; its read action is the authority to read. |
| Browse restriction | A stable identity linked to one group and dataset, with its retained configuration independent of whether the read grant is currently present. |
| Referenced-value selection | The target dataset and stable identities of fields chosen for presentation through references, without granting read rights. |
| Restriction history entry | The restriction or related selection, the responsible actor, event, time, reason and previous and resulting configuration; retained across removal and identity changes. |

Content references retain their target identities independently of the displayed
values. These relationships do not require a particular storage layout or a
separate permission system for accounts.

## Implementation principles

- **One decision authority:** browsing entry points and reference presentation
  consume the same permission model. Combined group memberships must produce an
  explainable result identifying the contributing rights and restrictions.
- **Consistent configuration and history:** record a configuration change and
  its history together, and report conflicting concurrent edits instead of
  silently overwriting another administrator's decision.
- **Current decisions in open content:** changes to rights, restrictions or
  referenced-value selections invalidate retained permission decisions and
  reference presentations, so cached navigation or names cannot preserve an
  earlier allowance.
