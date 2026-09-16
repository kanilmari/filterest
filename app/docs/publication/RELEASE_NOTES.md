# Filterest 9.3.12

Filterest 9.3.12 reduces image and page-load network work, keeps article position across reloads and fixes local session and translation issues. Database compatibility remains 9.7.15; this release requires no schema migration.

- Catalog, list, cover and background images request display-sized files instead of the original. When a sized file is missing, storage tries another sized file before the original. Display files are written completely before they are served, and an image that already fits is stored unchanged instead of being enlarged.
- On startup, Filterest replaces previously stored display files that were enlarged beyond their original image with a copy of the original, so existing sites serve lighter images without manual maintenance.
- Page loads avoid duplicate stylesheet, image and translation requests, and guest startup reuses dataset lists it has already loaded.
- Filter bar tool and view sections appear only after the user's dataset rights are known, so guests no longer see sections that then disappear.
- Article view keeps its scroll position, open related-rows section and selected child tab after a page reload.
- Ticket articles show agent-task todos as a checkbox list that toggles between todo and done and updates the progress bar. A second line in the todo text appears as a muted identifier phrase.
- Hero tabs, the dataset cover palette and the site presentation interface are refined.
- The English password-recovery send-code button follows the selected language.
- Development and test instances include the listening port in session, device and fingerprint cookie names, so local instances on different ports keep separate logins. Production behavior is unchanged unless explicitly configured.
- The worker-agent runner finds the Claude CLI under VS Code Remote/WSL and VS Code Insiders extension folders.

The production Docker image installs the currently available Alpine time-zone data package; the unpublished 9.3.11 candidate could not be built after Alpine replaced the pinned version.

Existing installations retain their data and settings.
