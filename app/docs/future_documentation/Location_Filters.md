<!-- Describes distance and map-area queries over ordinary dataset locations. -->
<!-- Connects location columns, shared filters, ordering and permitted results. -->
<!-- Extends the map view's role from presentation to choosing query inputs. -->
<!-- Keeps the data model independent of a physical schema or separate location store. -->

# Location Filters

## What it makes possible

Location filters let readers narrow any dataset with a location column by
place: rows within a chosen distance of a point, rows inside the area shown on
the map view, and results ordered nearest first. A reader can use distance
ordering with or without a distance limit or area filter.

These choices combine with every other dataset filter and produce the same
matching rows and ordering in lists, cards and the map view. The existing
[permission model](../instructions_and_documentation/Permission_Model.md)
continues to determine which rows and location columns the reader may read.
A location query cannot use an unreadable column to disclose a row's location
through a match, count, distance or ordering.

A reader chooses the reference point by clicking the map or, with explicit
consent, using the device's own position. Declining device-location access
leaves map selection available. The chosen point is a query input; it does
not become a saved row location merely because the reader uses it to filter.

Locations remain ordinary row values. The feature adds queries and controls
to the shared dataset filtering and map concepts without a separate location
store. Rows without a location do not match a distance or area filter and
cannot receive a distance rank.

## Concepts

- **Location column:** the readable dataset field whose row locations are used
  for a query. A query identifies its chosen field when a dataset has several.
- **Reference point:** the geographic point from which distance is measured,
  chosen on the map or supplied by the device with the reader's consent.
- **Distance filter:** a reference point and a maximum distance, expressed in
  real-world units, that select rows within that distance.
- **Area filter:** the geographic bounds selected from the area visible in the
  map view, used to select rows whose locations lie inside those bounds.
- **Distance ordering:** ordering matching rows by their distance from the
  reference point, starting with the nearest.
- **Location query:** the selected location column, distance or area conditions
  and optional distance ordering combined with the ordinary dataset query.

## General data model

| Conceptual value | Meaning and relationships |
| --- | --- |
| Row location | An existing geographic value belonging to a row and location column. |
| Location query | The dataset and stable location-column identity, combined with the reader's ordinary filters and ordering choices. |
| Distance condition | A query's reference point, maximum distance and unit. |
| Area condition | A query's chosen geographic bounds from the map view. |
| Distance order | A query's reference point and nearest-first ordering choice. |
| Derived distance | The distance between a permitted row location and the reference point; calculated for the query rather than stored as another location. |

The same reference point can serve both a distance condition and distance
ordering. Query conditions refer to ordinary dataset and field identities;
they do not create a parallel collection of location records.

## Implementation principles

- **Query the complete permitted dataset:** apply spatial conditions and
  distance ordering before paging. Filtering only the rows already drawn or
  loaded cannot produce complete results or reliable totals.
- **Keep large datasets responsive:** datasets with many locations need a
  spatial index for distance and area queries. It is derived from the ordinary
  location values and maintained as those values change.
- **Use geographic meaning consistently:** distance calculations use a common
  geographic reference and real-world units; area bounds retain their meaning
  across longitude wraparound rather than depending on screen coordinates.
