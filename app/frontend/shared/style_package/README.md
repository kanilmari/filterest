<!-- README.md: the controlled style-package token contract. -->
<!-- Connects the source vocabulary, Go/browser validators and CSS consumers. -->
<!-- Preserves existing appearance owners and default rendering before publication. -->
<!-- Describes slice 1 only; later slices add persistence, fonts and activation. -->

# Controlled style-package tokens

[definition.json](definition.json) is the single source-owned policy. Go embeds
it in [definition.go](definition.go); the browser imports it in
[validator.js](validator.js). Change the definition and its shared examples
together when evolving this versioned contract. No storage, API, upload,
activation, CSS compiler or cascade layers are implemented in this slice.

## Manifest and themes

```json
{
  "schema_version": 1,
  "scopes": {
    "home-hero": {
      "light": {
        "heading.color": "#203040",
        "heading.gap": { "value": 8, "unit": "px" }
      },
      "dark": { "heading.color": "#f4f2eb" }
    }
  }
}
```

Only `schema_version` and `scopes` are accepted at the top level. Each present
scope requires explicit `light` and `dark` objects; either may be empty. Token
assignments are sparse and independent: omission retains that theme's inherited
site/surface value or shipped fallback, never the other theme's override.
An absent scope means no override. There are no `system`, `shared` or unthemed
package assignment objects. Existing settings keep their own older contracts.

## Scopes and values

The definition owns selectors and allowed token/scope combinations. Initial
scopes are `site` (body), `home`, `home-hero`, `navigation-header` (the shared hero
destination row), `primary-button` (the framework primary action) and `cards`
(framework cards and the product-card surface). Ordinary result cards retain
their existing appearance contract; these approved consumers do not replace it.
Future compilation must resolve defaults → site → applicable Home/component
scopes using these source selectors, and recompute theme-derived values at their
owner. A navigation row physically inside Home also inherits Home font roles.
Authentication, administration and recovery layout, visibility, focus and
control geometry are outside package ownership.

The token table specifies every key, CSS mapping, allowed scope, type and bound:

- `font.body`, `font.display`, `font.emphasis`: registered font bindings.
- Body letter spacing and line height; Home heading size, weight, colour,
  letter spacing and gap; slogan/description sizes and paragraph gap.
- Home block spacing, padding, radius and background; named reveal preset.
- Navigation spacing, padding, radius, text size, line height and colours.
- Primary button padding, radius, size, rest colours and shadow preset.
- Framework/product card radius, padding, body gap, background and shadow preset.

Lengths are exactly `{ "value": number, "unit": "px|rem|em" }`, with only the
unit listed for that token accepted. Responsive heading size is exactly
`{ "min": length, "preferred": length, "max": length }`: rem/vw/rem respectively,
with minimum ≤ maximum. Number/integer values are finite and use inclusive
bounds; no coercion or arbitrary CSS text is accepted. Colours are six-digit
hex strings. Shadow values select source-owned `none`, `soft` or `raised` CSS.

Reveal values select `off`, `fade` or `fade-up`. Their bounded duration, distance
and stagger are in the definition; `off` is the default. Emphasis markup,
CTA content/targets and reveal rendering belong to slice 6. That implementation
must retain usable content with missing scripts/fonts and reduced motion.

## Font slots and ownership

Each font binding is exactly `{ "default": "registered-uuid", "languages": {} }`.
Language entries override the default role for actual text languages, e.g.
`"languages": { "fi": "registered-uuid" }`. The source language pattern keeps
slots open for later languages; it does not enable a language or ship assets.
Both validators receive a trusted list of registered font IDs. With no list,
all font references are refused. Font names, URLs, stacks and external services
are never author-supplied token values. Licensed local serif/sans family choice,
face validation and storage are later slices. Production checks initially cover
Finnish/English; this slice adds no CJK fonts or assets.

The definition's `reserved` inventory records existing setting fields and CSS
projections. Brand colour and navigation appearance stay with site presentation;
Home anchors, margins, alignment, width, wash, opacity and the versioned
`text_style` (including its reveal variables) stay with Home presentation; dataset covers and card/caption/header choices stay with dataset
appearance. A package cannot claim these keys or their projections. Package
revert therefore restores only package-owned choices. Existing definitions
remain authoritative for reserved values and validation.

## Validation and default preservation

Go `Parse(raw, knownFonts)` and browser `parseStylePackageJSON(raw, knownFonts)`
refuse unknown fields/scopes/keys, duplicate decoded JSON keys, nulls, wrong
types/units, out-of-range numbers, invalid themes and unknown font references.
Browser `isValidStylePackage` checks draft objects; imports must use the raw
parser so duplicate-key evidence is retained. Limits start at 64 KiB JSON,
128 assignments, 12 distinct font references and 24 JSON nesting levels.
Each token and each per-language font slot counts as one assignment.
Font upload slices must enforce 12 faces, 20 MiB per WOFF2 and 60 MiB total.

CSS consumers use `var(--token, previous-declaration-value)` directly, with no
new global aliases, selectors, specificity or interaction-state changes.
Default font stacks remain Arial/sans-serif and Space Grotesk/system/sans-serif;
installed fonts and existing fallbacks still determine the actual face.
No `!important` is added. Explicit themes continue to beat OS preferences.

Both test suites read
[`style_package_validation_examples.json`](../../../testing/shared_contracts/style_package_validation_examples.json)
and exercise each definition's scopes and bounds. The separate pre-change
[`style_package_default_declarations.json`](../../../testing/shared_contracts/style_package_default_declarations.json)
records all replaced declarations. The default regression parses actual CSS,
resolves inherited variables at root/body, and checks every named declaration
under both application themes over both OS preferences. It also checks title
clamp sizes at representative widths. This unit proof does not claim browser,
font-loading, contrast or production delivery verification; those remain in
the later native/browser acceptance matrix.
Home's box gap intentionally changes to 40 px in WO98; the pre-change fixture remains
historical, while the regression resolves the current component-owned Home token.
