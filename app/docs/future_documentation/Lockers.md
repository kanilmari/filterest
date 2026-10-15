<!-- Describes named lockers for visibility and allocation of work. -->
<!-- Connects dataset rows, user groups and permission scopes. -->
<!-- Keeps work organization separate from the authority to read or act. -->
<!-- Extends the shared row-policy concept without duplicating its engine. -->

# Lockers

## What it makes possible

Lockers let an organization divide records into named areas of responsibility
and limit which people may see or work on the records in each area. A team can
have its own work area without creating another copy of the dataset.

Work allocation and visibility are separate decisions: assigning work does
not automatically grant reading, and permission to read does not assign the
work. A locker used only as a view filter does not secure its records.

## Concepts

- **Locker:** a named boundary within a dataset for organizing responsibility
  and, when configured, restricting access.
- **Locker membership:** the relationship placing a record within a locker.
- **Responsible party:** the user or group to which a locker's work is assigned.
- **Locker scope:** the permission scope identifying the records and actions
  covered by a locker's access rules.

## General data model

A locker belongs to a dataset and relates records, responsible parties and
scope rights. These relationships use stable identities so renaming a locker
does not change its boundaries or transfer rights.

## Implementation principles

Use the [permission model](../instructions_and_documentation/Permission_Model.md)
for scope rights and [row policies](Row_Policies.md) for enforcement and refusal
explanations. Lockers supply named organizational boundaries to that model;
they do not define a parallel authorization engine. Mandatory row conditions
still apply. Moving a record between lockers requires authorization for the
transfer and immediately changes its effective visibility and work allocation
across reads, writes and retained views.
