# Filterest 9.3.7

Database compatibility: 9.7.13. This application update does not require a database migration.

## Fixed

- The production Docker build now includes the shared card-role catalogue in its backend build stage. This fixes the Docker image build failure in 9.3.6.

The following improvements from 9.3.6 are included.

## Added

- Dataset creation now includes a translated card-role selector for each column. The form has more room on wide screens and stacks its controls on smaller screens.
- Site administrators can choose cropped cover images, complete images, or complete images over a blurred copy with a background tint matching the active theme.

## Improved

- Dataset creation and the existing card-field editor use the same supported role catalogue. New title, description and keyword roles omit redundant field labels; detail fields retain their own labels.
- The filter-sidebar and main-menu opening buttons stay reachable in their corresponding viewport corners. Settings and appearance controls remain accessible beside them.
- Search inputs and their buttons share one border, background, shadow and focus treatment.
- Article details retain individual field labels without an extra generic Details heading.
- Image-first articles can be closed from the empty background beside their text. Dragging or selecting text does not accidentally close the article.
- Multilingual article field metadata supports the graphical language editor.
- The application no longer adds top and bottom outer borders on very wide screens. The right filter sidebar uses a two-pixel separator from adjacent content.

Existing dataset roles and authored content are preserved. Automatic role suggestions and automatic translation during dataset creation are not included in this release.
