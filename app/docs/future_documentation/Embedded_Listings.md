<!-- Describes Filterest listings shown as part of another website's own pages. -->
<!-- Connects public dataset reads, canonical item addresses and the host's search visibility. -->
<!-- Keeps framing, sessions and private content out of the embedding path. -->
<!-- Lets the host site own everything around the listing. -->

# Embedded Listings

## What it makes possible

A host site, such as a news site built on another platform, shows a listing
from a Filterest installation as part of its own page: for example an events
page where Filterest supplies the events and the host site supplies everything
else, from the header and menus to its articles and advertising. The listing
follows a saved choice of dataset, filters and order. It stays current without
the host site's editors copying rows by hand.

The listing is built so that search engines can credit it to the host page.
Content that arrives in the host page's own server-rendered HTML is indexed as
part of that page. Content that a script inserts after loading is indexed only
by search engines that run scripts, and less reliably. Content in a framed page
is normally credited to the framed address rather than to the host. Embedded
listings therefore prefer server-side inclusion. A script-inserted form is a
lesser option, and a framed page is the last resort.

Only rows that a signed-out visitor may read under the
[permission model](../instructions_and_documentation/Permission_Model.md) can be
embedded. Embedding never carries a session, never lends an administrator's
access, and never exposes fields hidden from visitors.

## Concepts

- **Host site:** the website whose page contains the listing. It owns the
  surrounding page, its layout, styles and search-engine identity.
- **Embedded listing:** a named, published definition of what is shown. It
  holds the dataset, the visitor-readable fields, filters, order, item count,
  language and presentation hints, and which host sites may use it.
- **Listing fragment:** the listing delivered for inclusion. It is either
  ready, accessible HTML with structured data describing the items (such as
  events), or the same content as data for the host site to render itself.
- **Canonical item address:** every item has exactly one canonical address,
  either the host site's own item page or the item's Filterest article address.
  The other places that show the item link to it, so search engines do not see
  duplicate content.
- **Host permission:** the list of host sites allowed to use an embedded
  listing. It is a separate, explicit permission and never a general opening of
  the installation.

## Implementation principles

Serve listing fragments without cookies or sessions, and cache them with a
stated freshness so that host pages stay fast and an outage on either side
degrades to the last good copy. Keep protection against framing in force for
every other page. If a framed form is ever offered, allow it only for an
embedded listing's own presentation and only for its permitted hosts. The
fragment adapts to the host through presentation hints, such as theme, density
and language, rather than through the host's own styles reaching into
Filterest. Items link to their canonical addresses, and the fragment states
when it was produced. Programs that need non-public rows use the
[API access tokens](Programmatic_API_Access.md) feature, not embedding.
