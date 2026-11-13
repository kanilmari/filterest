# Filterest 9.6.8

Release date: 2026-11-13. Contains the two landed commits since 9.6.6.

## Database and rollback

The database minimum and target are both **9.13.6**, unchanged from 9.6.6.
No migration runs on the first start after upgrading from 9.6.6.
Rolling back to **9.6.6** keeps the same database; no database restore is required.

Before rollback, restore **Space between rows in a box** to its minimum (9.6 px)
and **Space below box headings** to 8 px in the Home palette, then save.
Custom row spacing stores Home presentation format 7; custom heading spacing
stores format 6. Application 9.6.6 accepts neither format. Saving both defaults
uses the earlier compatible format and preserves the other Home choices.
After rollback, the new spacing controls and the interface refinements below
are no longer available. The earlier layout, link colours and title rendering return.

## Home navigation and titles

On phones, Home navigation buttons fit their icons and labels and share spare
space equally within each row. Each icon and label is centred together; labels
wider than a row wrap inside the button. Dataset and article buttons form
balanced rows and keep the final two together when they fit.
Selecting a destination in the overlay menu closes it. Dataset sort and filter
controls follow the current theme's surface colour at every width.
Home's Serif story headline and italic accent use normal letter spacing.

## Dataset panels

Open navigation and filter panels reach the top edge of dataset pages, including
articles and phone layouts. Each panel shows its own corner close button.
The dataset toolbar shows the opening controls when those panels are closed.

## Home boxes and search results

Larger linked dataset headings open the same collection as **Show all**, keeping
their heading colour and keyboard focus outline. The Home palette controls
spacing below headings from 5 to 30 px, with an 8 px default, for boxes and search results.
Article and **Show all** links are darker in the light theme.
Row spacing defaults to 0.6 rem at every reader font size. The palette permits
custom spacing up to 30 px, using the font-relative default as its floor.
These presentation settings need no database migration.

## Record headings

Stored heading tags follow the selected title size on standard and Glowy cards
and in articles. The compact article list, search results and browser tab show
the same readable title. Full titles retain inline emphasis and links.
