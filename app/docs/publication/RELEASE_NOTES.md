# Filterest 9.4.3

This quick patch makes opening an article from the card view faster, especially
on large datasets. It includes all changes since 9.4.2. The database stays at
9.11.2: upgrading from 9.4.2 needs no database step, migration or new database
release record. The database minimum and target both remain 9.11.2.

## Faster article opening

Opening an article from the card view no longer repaints every card in its
dataset. Newly bound cards, images and articles receive their own appearance;
appearance changes are applied together before the next browser paint, reusing
the resolved settings and skipping unchanged styles. What an appearance looks
like is unchanged, including previews and light and dark themes.

On the development instance, using a desktop and a 60-row dataset, CSS writes
fell from 52,307 to 866, the longest main-thread task from about 290 ms to about
120 ms, and click to visible article from about 470 ms to about 250 ms. These
are development measurements, not production timing guarantees. Large
production datasets gain most: the reported 6.5-second freeze on fintravel.fi
came from repaint work that grew with the square of the number of visible
cards.

## Administrator scrolling

The administrators' Workline observatory scrolls in one place on desktop,
with one content scrollbar instead of two. Its controls compact while scrolling
and phase headings stay visible. Phones and tablets retain their existing
scrolling behaviour (900 px and below), in both themes.

## Article settings baseline for site operators

The browser and server now share one article-presentation contract. This has
no visible effect on visitors' articles, settings or access rights, and adds
no new article presentation.

Operators preparing future article changes can export a deterministic JSON
baseline of saved article settings and their current resolution, including
field assignments, order and widths, section defaults and article audiences.
Run the read-only exporter on a database copy with an explicitly supplied
connection; it uses one read-only snapshot and always rolls back. It is a
settings baseline, not proof of every rendered row. See the Article Section
Defaults guide for the command and limitations. This release does not require
running the exporter or changing any saved settings.

## Maintenance

Developer tooling adds explicit Claude worker effort; a test locator is corrected. Neither changes visitor behaviour.
