# Filterest 9.3.10

Filterest 9.3.10 improves article navigation, image presentation and startup reliability. Database compatibility remains 9.7.15; this release requires no schema migration.

- Result counts remain above the result list after navigation and infinite scrolling. Filter and reset controls use the same one-pixel container border as sorting.
- Article sidebars continue loading results and reuse the already-loaded rows when opened from another result view. Returning to the source list preserves its loaded rows and position.
- Article images share navigation controls with image-first presentation. Site settings can place captions over or below article images; image-first actions leave clear space after captions.
- First-paint theme and navigation initialization arrive with the page HTML instead of separate blocking script requests. Login forms remain usable while optional password icons load or fail.
- Verified administrators can create ordinary users through the existing registration API while public signup remains disabled. Existing CSRF protection, rate limiting, password hashing and the administrator session are preserved; production accounts still require activation.

The investigation of intermittent original-image request failures continues separately.
