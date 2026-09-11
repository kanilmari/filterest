<!-- What: Describes the site's three raster-card image presentation modes. -->
<!-- Between: Connects the Appearance palette, typed site settings, and card rendering. -->
<!-- Why: Keeps the current site default and future per-image work distinct. -->

# Card image presentation

Administrators choose a site-wide default under Appearance settings → Card layout:

- Fill and crop (cover): fill the existing card image frame, cropping where necessary.
- Whole image: fit the complete image inside the frame.
- Whole image with blurred background: fit the complete image over an enlarged, blurred copy of the same image. The background overlay uses the active application theme colour, including explicit light/dark overrides that differ from the operating system.

Changing the selector previews the choice immediately. Save appearance persists it with the other palette settings; Reset discards the unsaved draft. Finnish and English labels update in place with the application language.

The setting is dataset_cover_theme.shared.card_image_presentation in the existing site-presentation API. Allowed values are cover, contain and contain_blur. Older stored settings without this field load as contain and retain their other values. The current POST contract requires an explicit valid value. No database schema change is needed.

Only raster photos rendered in the CARD_MEDIA slot participate. SVG and CSS logos, avatars, thumbnails, article images, gallery images and Image first media retain their existing rendering. Card dimensions do not change. There is one accessible image; the blurred copy is a decorative CSS background that follows the resolved image URL and clears if image loading fails. Stored media and captions are unchanged.

Per-image overrides, viewer preferences and crop editing are possible later work. They are not part of this initial site-wide setting.
