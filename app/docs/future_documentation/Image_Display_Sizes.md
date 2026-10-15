<!-- Describes an intermediate image display size for high-density screens. -->
<!-- Connects generated variants with selection by rendered width and pixel density. -->
<!-- Reduces oversized card downloads while preserving adequate display detail. -->
<!-- Keeps variant production and selection aligned across image formats. -->

# Image Display Sizes

## What it makes possible

A card drawn about 300 CSS pixels wide on a screen with twice the pixel
density can load an image about 600 pixels wide instead of a 1000-pixel image.
The missing intermediate size reduces unnecessary transfer while retaining
the detail the display needs.

Existing display variants are 300, 1000 and 2160 pixels alongside the original;
cards already choose between 300 and 1000 using rendered width and pixel
density. The addition is the intermediate choice, not a replacement image
presentation system.

## Concepts

- **Display variant:** an image prepared for a bounded display size.
- **Required pixel width:** the rendered CSS width multiplied by the display's
  pixel density.
- **Intermediate variant:** an approximately 600-pixel option between the
  compact and larger card images.

## Implementation principles

Change the available variant set and its selection rule together, including
generation, serving and fallback behavior. Apply the policy across all
supported image formats; a different format must not silently retain the
oversized choice. Preserve the original and avoid enlarging an image that is
already smaller than the requested display size.
