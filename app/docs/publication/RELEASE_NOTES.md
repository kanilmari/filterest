# Filterest 9.6.16

- Home's dataset boxes use 23 px as the default row spacing. A site's stored choice stays in place, and the control now moves in whole pixels.
- Dataset tabs in the side menu share one shape. They are rounded when none of the visible datasets shows a picture in either theme and none is in Table, List or Compare view. Visitors can also see a dataset's cover above its results.
- Public article addresses use the readable words of the title without HTML markup. Older article addresses redirect to the corrected address.
- Search result counts and cards update together when a search finishes. The previous result set stays visible with its own count until the new results are ready.
- Row saves report success after the database confirms them. CSV export reports success after the complete file is written and preserves the previous file if writing fails.
- Renaming a folder or dataset preserves shared translations. When the new name already has a language key, that key keeps its existing translations and receives only missing languages from the old key.

The database version is 9.13.9. This release adds no database migrations.
