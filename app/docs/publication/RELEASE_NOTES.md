# Filterest 9.6.5

Release date: 2026-11-11. Contains the one commit since 9.6.4.

## Database and rollback

The database is unchanged at **9.13.6**, with the same minimum as 9.6.4.
The minimum and target are both **9.13.6**. No migration runs on the first
start after upgrading from 9.6.4. Rolling back to **9.6.4** keeps the same
database; no database restore is required for this application rollback.
The selected photo's caption and credit described below no longer appear
in Page-sized image-first articles after returning to 9.6.4.

## Selected photo credit

Page-sized image-first articles show the selected photo's localized caption
and photographer link at the dataset's configured position, over or below
the image. The position follows inherited site settings and live appearance
changes. Both placements fit the displayed photo's width, including portraits
narrower than the text column. A photo without caption or credit text leaves
no empty caption box.
