# Filterest 9.6.12

## Articles in search engines

Search engines can find and show a public site's articles. Each article a signed-out visitor may read has its own title, description, picture and address words in its page head and link previews. An address with missing or old words moves permanently to the current one, and a missing or hidden article answers "not found". Finnish and English versions have their own `?lang=` addresses, which the page and the sitemap announce. The sitemap lists Home, the menu datasets and every such article in every published language. robots.txt is written from the site's settings: an indexable site lets search engines fetch the data a visitor's page needs, while a site that is not indexed or requires signing in keeps everything out. Sign-in, registration and administration pages tell search engines not to index them. Every server-side read uses the signed-out visitor's own rights.

## Reading without the application

An article's text is part of its page, so it can be read when JavaScript is off or the application cannot start. A new plain page, All articles (`/articles`), lists the menu datasets' articles 20 to a page, and the menu links to it at the bottom. Sites that require signing in have no such page.

## Image-first articles

A card photo opens its image-first article at once, growing from the photo already on the card while the rest loads. Closing the article retraces the opening. The Page view's article panel has an outline in the theme's border colour.

## Database and rollback

The upgrade from Filterest 9.6.10 migrates database 9.13.7 to 9.13.8. The migration only adds interface texts; the schema does not change. Back up the database and media before upgrading. To roll back after migration, restore the matching pre-upgrade database backup and the previous application version together.
