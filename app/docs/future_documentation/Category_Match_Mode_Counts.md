<!-- Category_Match_Mode_Counts.md -->
<!-- Describes exact result totals for both ways of combining category values. -->
<!-- Connects category selection, readable results and the shared search response. -->
<!-- Keeps the future count contract separate from the current direction tags. -->

# Category Match-Mode Counts

## What it makes possible

After the shared mobile and desktop interface release, people can compare the
exact result totals for **Accept any** and **Require all** before changing a
category heading's matching mode. Each total appears in the existing effect
tag beside its native radio row, with translated result wording in both themes
and at phone widths. The current mode and selections stay unchanged until the
person chooses an option.

## Concepts

A **mode total** counts distinct readable rows matching the current search and
other filters, including selections under every other heading, with this one
heading evaluated in the named mode. Accept any includes rows with at least one
selected value; Require all includes rows with every selected value. Require
all can never have more results than Accept any.

Exact totals are useful for headings with at least two selected values. With
fewer selections the direction tags remain appropriate and no extra count is
needed. A **value count** answers a different question: it counts matches for
one candidate value. Value counts cannot be added or combined to derive either
mode total because rows may belong to several values.

## General data model

The first results page carries a pair of mode totals for each eligible heading,
bound to the same search and selection state as its facets. Later pages do not
repeat the calculation. A mode change fetches a new first page. Abandoned
responses cannot replace current totals, and a missing or failed calculation
keeps the direction text rather than displaying a false zero.

## Implementation principles

Compute both totals on the server using the same permission checks, search
scope and already-matched rows as the listing. Keep separately presented AI
results distinct so the tags and listing count have an explicit, consistent
meaning. Never request separate membership lookups from the browser for each
mode or infer totals from individual value counts.

Verify correctness on fresh installations and upgrades, including overlapping
values, other headings, ordinary filters and restricted rows. Measure query
cost on a representative case with 100,000 rows and one million memberships
before shipping. Keep native radio behavior, accessible names, translated copy,
44 px targets and the existing expandable help.
