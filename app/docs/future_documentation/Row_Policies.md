<!-- Describes named row policies held in dataset metadata. -->
<!-- Connects typed access rules, optional database enforcement and administrator explanations. -->
<!-- Gives row-policy definitions one durable home beyond individual requests and pilots. -->

# Row Policies

## What it makes possible

Row policies let administrators define which rows of a dataset a reader may
see or an actor may change through named, typed rules held in the dataset's
metadata. Publication, availability and moderation requirements become
explicit policy conditions rather than special flags attached to individual columns.
Administrators can combine these conditions with ownership, user and group
allowances, and organization, tenant or scope boundaries without separate
policy logic for each dataset.

One definition governs every surface that shows, counts, searches, exports or
changes rows, including related data and tools acting on a user's behalf.
Administrators can inspect each dataset's rules, its enforcement mode and the
reason an access decision was refused. Where additional protection is
justified, PostgreSQL row-level security can be generated from the same
definition and introduced independently for each dataset.

## Concepts and rule composition

A **policy definition** is a named rule associated with a dataset and one or
more actions. A **typed condition** expresses a bounded access test with
declared inputs, such as a publication flag, an organization reference or an
authorized scope. Conditions can refer to the permission model's proven owner
and existing explicit user or group allowances. Naming these rules makes their
meaning inspectable without inventing a general scripting language.

A **mandatory condition** narrows access and combines with other mandatory
conditions as an AND requirement. A **discretionary allowance** can grant
access only within that boundary; it cannot bypass publication, moderation or
another mandatory gate. An owner exception belongs explicitly to the condition
that permits it, rather than being inferred from a discretionary allowance.
Any administrator exception is likewise explicit in the definition.

The [permission model](../instructions_and_documentation/Permission_Model.md#existing-row-visibility-rules)
owns the existing owner proof and mandatory-flag behavior. Expressing those
decisions as named metadata rules preserves their meaning, including the
declared owner exception; it does not make owner guessing or broader row
allowances valid. Row policies compose with dataset actions, scope rights,
field permissions and allowed write values, rather than replace those layers.

An **enforcement mode** describes how a dataset's definition is applied and
compared across enforcement mechanisms. A **decision explanation** identifies
the action, relevant rules and failed condition for an authorized administrator.
It can distinguish a refusal under a valid rule from an invalid definition,
such as an owner reference that cannot be proven.

## General data model

The model describes identities and relationships without fixing storage names
or a physical schema:

| Conceptual record | Meaning and relationships |
| --- | --- |
| Policy definition | Stable identity, name, dataset, applicable actions and a revision identifying the rule meaning being enforced. |
| Typed condition | A condition belonging to a definition, its kind, referenced fields or relations, mandatory or discretionary role, and any declared exception. |
| Policy composition | How conditions combine, including mandatory conjunctions and the precedence of explicit refusals over allowances. |
| Dataset enforcement | The dataset, policy revision, selected enforcement mechanism, enforcement mode and comparison evidence. |
| Decision explanation | The attempted action and principal, applicable definition and revision, and the condition or missing prerequisite responsible for refusal. |

Conditions reuse the identities of users, groups, organizations and permission
scopes. An owner condition refers to a named, database-proven user reference;
an organization or scope condition names its authoritative boundary. A rule
can consume existing row allowances without creating another allowance
registry. A generated database policy refers back to its definition and
revision so it remains a derived enforcement artifact.

## Optional database enforcement

Database enforcement applies the same definition to reads and permitted
creates, updates and deletes. It adds protection beneath the application while
leaving Filterest metadata authoritative for policy meaning, application
decisions and explanations.

Each dataset can use application enforcement, shadow comparison or database
enforcement. In shadow comparison, the candidate database policy is compared
with the application's decision through tests and diagnostics without changing
the actor's effective access. Comparison covers the dataset's relevant read
and write surfaces before it depends on database enforcement. Administrators
can see disagreements and the definition revision under comparison.

Disabling the optional database backend never disables application row
authorization. A dataset that depends on database enforcement is not ready
unless its generated policies, actor context, runtime roles and supporting
privileges are complete. Removing duplicated policy fragments after adoption
must preserve the application's use of the shared definition. Changing the
database's enforcement configuration is a controlled schema change, separate
from selecting an application feature setting.

## Implementation principles

- **Validate typed inputs:** reject unsupported condition kinds, ambiguous
  references and incompatible field types before activating a definition.
- **Use trusted actor context:** derive user identity and administrator status
  from the authenticated request and bind them to its database transaction.
  Missing required context refuses access. Centralize its interpretation so
  generated policies do not each invent their own identity parsing.
- **Verify effective database privileges:** account for table ownership and
  privileged roles that can bypass row-level security. Row operations use
  policy-aware runtime connections; operator and read-only inspection rights
  are deliberate. Include related and helper data, required sequences and
  owner-safe field writes in the same privilege design.
- **Protect explanations:** disclose policy diagnostics only to administrators
  authorized to inspect them. A refusal explanation must not reveal row values
  or related data the recipient cannot read. Present rule names and reasons
  through translatable text usable in both application themes.
