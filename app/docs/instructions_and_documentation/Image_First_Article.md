<!-- Defines the standalone image-first article interaction contract. -->
<!-- Connects the article opener, modal lifecycle and translated details heading. -->
<!-- Keeps background closing predictable without intercepting article interaction. -->

# Image-first article

Image-first opens one image-led article in the shared image modal. The full-height image stage is followed by centered article content; the ordinary article underneath retains its own state.

A click on empty background beside either the image or the article closes the entire image-first view through the existing modal close lifecycle. Article text, original-photo links, disclosure controls and editors remain interactive. Dragging a text selection from the article into a gutter does not count as a background click. Narrow screens may have no gutter beside the article; the close control and Escape remain available. Changing records keeps the same modal and installs the new record's background behavior without document-level listeners.

The details section uses the existing `row_article_section_details` translation key. Reviewed runtime translations remain authoritative. When a site's response lacks that key, the frontend supplies the existing bootstrap wording in Finnish, English, Chinese and Cantonese instead of displaying the technical key. Changing the UI language updates an already-open section. This fallback does not create or rewrite translation rows.

The modal uses the application's explicit theme and existing reduced-motion behavior. Image captions and their original-photo attribution are described in [Article image captions](Article_Image_Captions.md).

Focused regression tests live beside `image_first_view_opener.js` and `translation_handler.js`; the image-stage and modal tests cover the existing close animation and image/letterbox boundary. Browser verification should include real article gutters, text selection, interactive content, language switches, both explicit themes with the opposite OS theme, and a narrow viewport.
