# Filterest 9.6.9

## Articles, images and cards

Image galleries use the image's dimensions when reserving space for its caption. The maintenance page can check stored image sizes across datasets and update missing or incorrect dimensions. Cards can show a short photo credit separately from the article's full caption. Image-first articles use a 48 px backdrop blur. Empty article metadata no longer leaves rows of dash placeholders.

## Reading and preferences

Site administrators can turn automatic hyphenation on or off per supported content language. Finnish defaults to on; English defaults to off. On narrow screens, article detail values sit below their labels. Collapsible article sections and filter panel sections start closed by default; site and dataset defaults and the reader's remembered choices are handled separately. Repeated matching error notifications share one visible counter.

## Database and rollback

The upgrade from Filterest 9.6.8 migrates database 9.13.6 to 9.13.7. Existing row-opening settings, including CIFAV, are retained. Back up the database and media before upgrading. To roll back after migration, restore the matching pre-upgrade database backup and the previous application version together. Image dimension maintenance is a separate administrator action after upgrading.
