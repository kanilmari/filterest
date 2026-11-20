# Filterest 9.6.13

## Article links open their article

A link that names one article, as the All articles page, the sitemap, search results and shared links give it, opens that article also on a dataset whose rows open as an image-first article (IFAV or Page). Such a link used to show the dataset's list: the list loading underneath the article replaced the article's address with its own before the article could open. The list view or search the link names stays behind the article, the readable address stays in the address bar, and the dataset's saved default sort is applied when the article is closed. An image-first article also opens when the list behind it happens to answer first, and a record opened while a slow article is still loading is the one shown.

## Titles for readers and search engines

An open image-first article names the browser tab after itself, as an ordinary article does; this is also the title a search engine reads after rendering the page. A title stored with heading markup, such as `<h1>…</h1>`, reads as plain text in page titles, link previews and the plain article pages, exactly as the application shows it.

## Menu and language addresses

The menu's datasets are real links: search engines can follow them, and a person can open a dataset in a new tab or copy its link, while an ordinary click still opens it in place. Hovering All articles no longer hides the menu's right edge. A language address (`?lang=fi`) no longer shows the language as a filter above the list, keeps it when the filters are cleared, and no longer brings it back in other tabs or on later visits.

## Database and rollback

The database stays at 9.13.8; the upgrade from Filterest 9.6.12 runs no migrations. To roll back, install the previous application version; back up the database and media before upgrading, as always.
