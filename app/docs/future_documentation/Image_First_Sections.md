<!-- Describes the missing collapsible sections in image-first articles. -->
<!-- Connects article presentations with shared section choices and access rules. -->
<!-- Keeps section defaults distinct from section rights and media authorization. -->
<!-- Leaves image-stage behavior and existing article capabilities with their owning guides. -->

# Image-first article sections

Implements #881's remaining image-first section requirement as a future description.

## What it makes possible

Readers can use Images, Attachments, Related rows and Task progress in both
the full and page-sized image-first article presentations, alongside Details.
Choosing an image-led presentation therefore preserves the article's section
capabilities wherever the reader has the necessary rights and content exists.

The [existing article section defaults](../instructions_and_documentation/Article_Section_Defaults.md)
describe the classic article's five sections and the image-first article's
Details-only support. The page-sized presentation is reserved groundwork;
the initial presentation design gives both image-first forms only Details.
This feature extends that section support after those presentations and their
shared settings table are available.

## Concepts

An **article presentation** is the classic article, the full image-first
article or the page-sized image-first article. They present the same row;
changing presentation does not create another row or grant access to it.

A **section** is one of Details, Images, Attachments, Related rows or Task
progress. Each image-first presentation gains the same section meanings as
the classic article. The **image stage** remains outside these collapsible
sections; closing Images does not close the stage. Its interaction belongs
to the [image-first article](../instructions_and_documentation/Image_First_Article.md).

The **section settings table** extends the planned five-column article
presentations table: section name, classic article, full image-first article,
page-sized image-first article and Select all. Its section row group has one
row per section and an independent initial-open choice in each presentation
column. Select all changes those presentation choices for that row. The added
sections become selectable in both image-first columns rather than remaining
unsupported cells. A closed section retains its heading and opening control.

**Section rights** decide whether a reader may use a section. **Media
authorization** decides which pictures or attachments the reader may access.
An **initial-open choice** decides only how an available section starts; it
neither grants rights nor conceals content from an unauthorized reader.
The [permission model](../instructions_and_documentation/Permission_Model.md)
owns access rules. A reader's later open or close action does not rewrite
the configured initial state.

## General data model

A dataset relates each section to each article presentation through an
initial-open choice. Section identity is shared across presentations, while
each presentation's choice is independent. Section rights and authorized
content remain separate inputs to rendering, outside that choice.

## Implementation principles

Extend the shared section definitions and planned settings table rather than
introducing another section editor. Reuse existing section behavior and
authorization boundaries across presentations. Keep controls keyboard
accessible, labels translated and both application themes supported.
