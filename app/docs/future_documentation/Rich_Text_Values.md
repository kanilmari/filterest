<!-- Describes formatted text values that are made safe when they are saved. -->
<!-- Connects editors, imports and API writes with one shared definition of allowed formatting. -->
<!-- Keeps display-time cleaning as a second layer instead of the only protection. -->
<!-- Defines the missing save-time cleaning without choosing a parsing library. -->

# Rich Text Values

## What it makes possible

Text fields can hold formatted text, such as paragraphs, headings, lists,
emphasis, quotations and links, whether it comes from people, imports or other
programs. For example, articles brought over from another publishing system
keep their structure. The formatting is cleaned when the value is saved, so the
stored value is already safe and is the same for every reader, export and API
client.

Today formatted text is cleaned only in the browser when it is displayed:
allowed tags are kept, but all attributes, including link addresses, are removed.
The stored value keeps whatever was written. Cleaning on display stays as a
second layer of protection. The content security policy remains a third layer
and is never the only one. How the browser treats link addresses is separate
work. This description covers what is allowed to be stored.

## Concepts

- **Rich text value:** a text value that contains allowed formatting. A value
  without formatting is plain text and is treated as today. Web addresses written
  as plain text continue to become links when displayed.
- **Allowed structure:** one installation-wide definition of the formatting that
  may be stored, shared by save-time and display-time cleaning:
  - **Block elements:** paragraph, headings, ordered and unordered lists with
    their items, quotation, preformatted text, horizontal rule and line break.
  - **Inline elements:** strong and emphasised text and neutral spans.
  - **Links:** a link may keep only its target address, with the web and e-mail
    schemes. Nothing else is kept: no styles, classes, identifiers, event handlers
    or embedded frames.
- **Save-time cleaning:** a disallowed element is unwrapped and its text kept.
  Scripts, styles, comments and embedded objects are removed together with their
  content. A disallowed attribute, or a link address with any other scheme, is
  removed.
- **Cleaning notice:** when saving changed the value, the person or program that
  saved it is told what was removed, so an editor or an import can correct its
  source instead of losing content silently.
- **Images:** formatted text does not carry images. Images belong to image fields,
  where a copied image keeps its recorded source.

## General data model

A rich text value is stored text in an ordinary text field. The allowed
structure is versioned with the installation, not set per dataset. A cleaning
notice belongs to the save that produced it and does not have to be stored with
the value.

## Implementation principles

Every write path cleans: forms, inline edits, the API, imports, bulk and
maintenance tools. Cleaning is idempotent, so cleaning a clean value changes
nothing, and saving an unchanged value never alters it. Narrowing the allowed
structure takes effect for new saves. Existing values are brought into line
only through a deliberate, reviewable maintenance pass. Display-time cleaning
uses the same definition, so a value never shows formatting that could not have
been stored.
