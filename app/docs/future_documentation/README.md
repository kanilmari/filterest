<!-- Defines the contract for descriptions of unimplemented Filterest features. -->
<!-- Connects durable feature ideas with normal product documentation. -->
<!-- Keeps public ideas recoverable and documentation aligned with implementation. -->
<!-- Worklines and tickets own changing status and scheduling. -->

# Future Documentation

This folder holds descriptions of features that are not yet implemented in
Filterest. Selected work requests can become lasting feature descriptions here,
instead of tickets or technical plans that quickly age. The folder is part of
the public repository and versioned in Git, so the ideas remain open and can be
recovered after the loss of a working installation.

## What a document contains

Each document describes one feature in English and explains:

- **What it makes possible:** the outcomes and capabilities it gives the owner,
  users or agents, and the boundaries of those capabilities.
- **Its concepts:** the named things, their meanings and their relationships.
- **A general data model, where useful:** the identities, kinds and relationships
  needed to understand the feature, without committing to a physical schema.
- **Optional implementation principles:** a short, separate section or plan
  containing durable design constraints that add to the feature description.
  It must not repeat the description as a list of implementation steps.

An expensive technical plan is not required. Prefer timeless language and
principles over task lists, temporary arrangements or detailed designs that
depend on today's implementation. A lasting prerequisite may state when the
feature can follow another capability; dates, priorities, progress and release
assignments belong in worklines and tickets, not in these documents.

## Semantic references

Refer to the product and its implementation only through named concepts and
components and explain their role, such as the Workline Observatory or the
permission model. Do not reference source filenames, code paths or raw code
symbols. References should survive an implementation being reorganized. Links
to documentation may identify the owning concept.

Keep any data model at a general level. Physical table definitions, executable
schema changes and exact implementation choices belong to implementation work.

## Move the text as implementation arrives

A feature document may stay here only while some of the feature is missing
from the code. When any part is implemented, move the text describing that part
into the appropriate normal product documentation in the same change. Adjust
the remaining description to contain only the missing capability and its needed
context; do not leave a second description of the implemented behavior here.

When nothing remains unimplemented, delete the feature document from this
folder. Git history preserves the idea and its development; this folder is not
an archive of completed features. Worklines and tickets retain implementation
status and scheduling throughout, without a parallel progress record here.
Update incoming documentation links when text moves or a document is deleted.

## Feature descriptions

- [Lifecycle management](Lifecycle_Management.md) describes a shared way to
  follow the lives of different kinds of named things in Filterest.
- [Row view counts](Row_View_Counts.md) describes distinct viewers of each row,
  shared card totals and the privacy choice for anonymous viewer identity.
- [Row policies](Row_Policies.md) describes named dataset rules, optional
  database enforcement and administrator explanations of access refusals.
- [Browse restrictions](Browse_Restrictions.md) describes restricted direct browsing
  while groups with read rights can still read selected values through references.
- [Live schema workbench](Live_Schema_Workbench.md) describes a living administrator
  overview of table structure, activity, masked samples and reference-schema differences.
- [Protected fields](Protected_Fields.md) describes encrypted secrets, routine masking,
  deliberate reveal and copy records, key replacement and random value generation.
- [Location filters](Location_Filters.md) describes distance and map-area queries,
  shared dataset filters and nearest-first results over readable row locations.
- [Independent linked-name filter visibility](Linked_Name_Filter_Visibility.md)
  describes shared or separate reference/name controls, metadata model options,
  administrator settings and adoption without reviving hidden selections.
- [Local workspace](Local_Workspace.md) describes private file and folder datasets
  on one computer, portable locations and local, rebuildable search data.
- [AI setup choices](AI_Setup_Choices.md) describes independent, optional AI uses
  during setup and administration, data disclosures and manual translation steps.
- [Source code availability](Source_Code_Availability.md) describes a planned
  owned release mirror for obtaining published versions without GitHub.
- [One settings table template](Settings_Table.md) describes one shared
  administrator editor with typed cells, ordering, bulk choices, drafts and
  verified saves across settings domains.
