# Filterest 9.3.13

Filterest 9.3.13 makes card images lighter to load. Database compatibility remains 9.7.15; this release requires no schema migration.

- Cards choose the 300 px or 1000 px image from the width the image is actually drawn at and the screen's pixel density. Stacked cards on short windows no longer load the 1000 px image for a small picture.
- A card no longer replaces an image that has already loaded with a smaller one, so image requests are not cancelled and fetched again while the page settles.
- Display JPEG images are saved at quality 85. When a resized image would be heavier than its original, the original is stored instead.
- On startup, Filterest also replaces previously stored display images that are heavier than their original, so existing sites serve lighter files without manual maintenance.
- The app/DB compatibility check no longer reports tracked schema snapshots as untracked when it runs from another repository's `git commit -a` hook.

Existing installations retain their data and settings.
