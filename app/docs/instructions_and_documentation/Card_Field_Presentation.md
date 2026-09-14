<!-- Card_Field_Presentation.md -->
<!-- Describes the site-wide card field visibility choice and its compatibility contract. -->
<!-- Connects Appearance settings, the existing settings API, and client card rendering. -->
<!-- Keeps stored data, article views and retained card history independent of presentation. -->

# Card field presentation

Administrators choose **Appearance settings → Card layout → Card fields**. The choice is shared by the site's light and dark themes:

| Choice | Explanation |
| --- | --- |
| Show only fields with values | Saves space and looks cleaner, but field positions may vary and labels need to be checked more carefully. |
| Show all fields (Recommended) | Uses more space, but keeps fields in consistent positions, making cards easier to scan and compare. (Recommended) |

Finnish choices are **Näytä kaikki kentät (suositus)** and **Näytä vain kentät, joilla on arvo**. Their explanations are “Vie enemmän tilaa, mutta pitää kentät samoissa kohdissa, jolloin kortteja on helpompi silmäillä ja vertailla. (Suositus)” and “Säästää tilaa ja selkeyttää näkymää, mutta kenttien paikat voivat vaihdella ja kenttänimiä on luettava tarkemmin.” Language changes preserve the selected draft.

All palette sections start closed. Opening or closing a section through its summary is remembered in that browser across palette remounts and datasets; changing the language or theme retains the choice. Initial or programmatic openings do not overwrite this user preference.

The bordered card-fields group lists **Show only fields with values** first; the default remains **Show all fields (Recommended)**. The radio buttons preview the setting immediately. **Save appearance** persists it with the other palette settings. Saving, success and failure feedback use the application's shared toast notifications, outside the panel. Their text follows the current application language. **Reset** discards the draft; closing the panel retains the existing palette preview behavior.

## Setting and older clients

The single persisted setting is `dataset_cover_theme.shared.card_show_all_fields`, a boolean whose default is `true`. Missing stored or cached values load as `true`; an explicit `false` remains `false`. The root document attribute used by card rendering is only a projection of these effective settings, not a second stored preference.

The existing site-presentation API accepts an explicit JSON boolean. A present `null`, string, number, array or object is rejected. An older POST that omits the field preserves its currently stored boolean in the same database transaction, including a concurrent update. If no stored boolean exists, omission uses `true`. The response reports the actual persisted value. No schema change is needed.

## Rendering scope

When the value is `false`, ordinary cards filter empty entries before their field DOM is built, including each entry's label, icon and layout position. An entirely empty details group creates no details container. This is part of client rendering, rather than hiding a completed field with CSS or removing data from API responses.

Emptiness uses the existing locale-resolved value: null, undefined and whitespace-only text are empty. A metadata-marked multilingual map with no translations is also empty. Explicit `0`, `false`, literal `N/A` and dash text remain values. Ordinary JSON objects and malformed JSON are visible data. Existing language fallback remains in force: a missing requested translation may fall back, while an explicit empty translation stays empty.

Column visibility, `show_key_on_card`, and explicit existing hide-false/null rules still apply. The setting does not change stored rows or metadata, classic articles, Image first article view (IFAV), their compact navigation cards, compact card summaries, or experimental free-layout cards.

Previewing or resetting rebuilds only ordinary card field groups. It preserves the outer card and wrapper, selection checkbox, image, summary and retained history anchor, including cards in a connected but hidden history surface. Newly mounted cards resynchronize after asynchronous construction. Article navigation checkboxes have distinct IDs, and a language refresh selects the card within its own article list.

See [Card image presentation](Card_Image_Presentation.md) for the separate image setting and [Image First Article](Image_First_Article.md) for article behavior.
