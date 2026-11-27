# Filterest 9.6.17

- Image-first articles and their page-sized view leave 70% of the browser's small viewport height below the article. This lets the reader scroll past browser controls that cover the bottom of the page.
- The theme, language, account and sign-in controls, the filter buttons, and an article's Previous and Next buttons no longer cast a shadow at rest. Pressing a button still gives visual feedback.
- Article descriptions read at a roomier 1.6 line height by default, with more space after paragraphs and lists. A line height supplied by the site's style package still applies. The image-first view now uses the same spacing as other articles.
- In image-first articles, including the page-sized view, the Details section has square bottom corners when open or closed. The article panel keeps its rounded corners.

The database version is 9.13.9. This release adds no database migrations.
