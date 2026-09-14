<!-- Article_Image_Captions.md
Documents the shared photo-credit presentation for both article layouts.
Connects asset descriptions, image-source metadata and localized safe DOM output.
Keeps legacy credits readable without rewriting stored application data. -->

# Article image captions

Ordinary articles default to captions below the matching main image. The
appearance palette's **Article images → Caption position** offers **Below image**
and **Over image**. This is an explicit site-wide setting shared by both themes,
stored in the existing `system_config.dataset_cover_theme_config` JSON at
`shared.article_image_caption_position` (`below` or `overlay`). Missing values
mean `below`; older clients that omit the setting preserve its saved value.
The normal site-default Save action persists it; preview and reset use the same
lifecycle as the other site presentation settings.

Overlay captions share the image-first caption skin. Below-image captions sit
3 px closer to the image, while the following prose begins 5 px lower than the
previous layout. Image-first keeps its own overlay; its Show more control stays
at least 20 px to the right of the caption, or 20 px below on narrow screens.
Compact cards and gallery thumbnails do not gain captions.

Ordinary article images reuse the image-first previous/next image controls and
image counter. Record controls follow the same existing record-navigation feature
flag. Ordinary images have no Show more control. Arrow keys and horizontal swipes
browse the already permitted image rows, preserve focus and update the matching
caption; clicking the selected image opens that image in the image-first view.
The active media surface identifies SVG/logo assets even when their inner image
is hidden from accessibility. Removing an article releases its media observers.

The shared renderer reads the image asset's localized `description` and optional
`metadata_json.image_source`. New web-image selections supply the original
`source_page_url`, `creator_name` and `provider`. Photographer and provider names
form one combined link to the original photo page. A generated picker credit is replaced with
the localized linked credit; an independently authored description remains
beside its attribution.

Historical descriptions such as
`Kuvituskuva – [Photographer](https://www.pexels.com/photo/example/)`
also produce a short linked illustration credit. This is a display conversion:
the saved description and metadata remain unchanged. Named web links in ordinary
captions are supported, including balanced parentheses in a destination URL;
arbitrary Markdown and HTML are not interpreted.

Only absolute HTTP(S) destinations without embedded credentials or control
characters become links. Labels and surrounding prose are DOM text. Links open
a separate tab with opener isolation and do not activate image navigation or
close the article. Normal tab navigation and Escape-to-close remain available.

Captions refresh when the active image or interface language changes. Main-image
credit loading is independent of optional related-item sections and their editing
controls. Reads retain the existing permission-checked article load session;
obsolete or disconnected article requests cannot replace current captions.
