# Filterest 9.6.10

## Reading

Finnish article and card texts keep their paragraph breaks again. In 9.6.9 the Finnish hyphenation let the page join an article's paragraphs into one block, and hyphenated headings could lose their own colour. English texts, which are not hyphenated by default, were not affected.

## Development server

The application loads again when the browser reads its source files directly, as on the native development server. Built release bundles were not affected.

## Database and rollback

This release keeps database 9.13.7 and runs no migration. Back up the database and media before upgrading. To roll back, start the previous application version against the same database.
