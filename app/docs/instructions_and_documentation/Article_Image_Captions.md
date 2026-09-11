<!-- Article_Image_Captions.md
Documents the shared photo-credit presentation for both article layouts.
Connects asset descriptions, image-source metadata and localized safe DOM output.
Keeps legacy credits readable without rewriting stored application data. -->

# Article image captions

Ordinary articles show the caption below the matching main image. Image-first
articles use the same renderer in a content-sized overlay above the article
scroll control. Compact cards and gallery thumbnails do not gain captions.

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
