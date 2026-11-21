# Filterest 9.6.14

## Cards and tabs are real links

A result card's title and its "Show more" links are real links to the row's article at its readable address, and the dataset tabs above a list and on Home's top row link to their datasets. Search engines can follow them, and a person can open an article or a dataset in a new tab or copy its link; an ordinary click still opens it in place, and the card looks as before. Links to datasets and articles keep the page's language (`?lang=`).

## Filter results on Home

Home's dataset boxes have "Filter results" beside "Show all": the same list with the filter bar and its filters section open, also from a new tab or a copied link.

## Steadier Home and menu

Home's top-row dataset buttons no longer jump sideways while the side menu opens or closes, and hovering the menu's Home link no longer hides the menu's right edge. Home shows the site's own brand colour on a first visit; a new visitor used to see the default blue until they reloaded the page.

## Experiment: frosted bars

An administrator can turn on, for their own browser only, a frosted-glass look for the menu, the dataset top bar and the filter panel. The switch is in the menu's administration tools ("Frosted bars (experiment)"). Turned off, which is the default, the bars look exactly as before; articles and image-first articles keep solid bars.

## Database and rollback

The upgrade from Filterest 9.6.13 migrates database 9.13.8 to 9.13.9. The migration only adds the frosted-bars switch's label in every interface language; the schema does not change. Back up the database and media before upgrading. To roll back after migration, restore the matching pre-upgrade database backup and the previous application version together.
