<!-- Describes category colours and explanations for calendar rows. -->
<!-- Connects row classifications, dataset settings and calendar presentation. -->
<!-- Keeps category meaning shared across layouts, languages and themes. -->
<!-- Defines the target capability without choosing storage or source structure. -->

# Colored Calendar Row Categories

## What it makes possible

Calendar rows show their event type through a category colour and meaningful
text in month, week, day and agenda layouts, including compact month previews.
One dataset-owned set of category definitions serves every row and layout.

## Categories and settings

Category identities and multilingual text reuse the product's
[Classes and categories](../instructions_and_documentation/Frontend_Category_Panel_And_Dropdowns.md).
Event type is a single-valued class: each row has one category. The dataset's
event-type field and its row classification express the same choice; status
remains a separate property. Each category definition has a stable identity,
a translated label, a short translated description and a colour, defined once
for the dataset. Changing a definition updates all its calendar appearances.

Administrators edit these definitions alongside the dataset's other settings,
extending Classes and categories for labels and descriptions and
[dataset appearance](../instructions_and_documentation/Frontend_Dataset_Appearance.md)
for colours. Shared classification identities retain dataset-specific colour
and description settings; editing one dataset does not change another.

## Meaning, accessibility and themes

A visible legend pairs every category's colour with its label and description.
Each event also shows its category label; hover and keyboard focus expose the
same description, which is associated with the event for assistive technology.
The legend keeps descriptions available on touch devices without hover.
Colour is never the only signal. A missing or unrecognised category uses a
neutral appearance and explanatory text, retaining any supplied category label.

Category colours use the application's theme-aware appearance rules. Labels,
dates and descriptions retain readable contrast on the coloured background in
both explicit light and dark themes, including when the operating system
prefers the other theme. Category meaning stays consistent across themes.
Interface copy uses language keys; category labels and descriptions use
multilingual values with the product's language selection and fallback rules.
The [language rules](../instructions_and_documentation/Frontend_Coding_Conventions.md#7-languages-and-translations-ui)
own translation behaviour.

## Example categories

| Finnish label / English label | Finnish description | English description |
| --- | --- | --- |
| kokeilu / Trial or experiment | Rajattu kokeilu, jolla testataan uutta ideaa, toimintatapaa tai ominaisuutta. | A bounded trial that tests a new idea, way of working or feature. |
| retro / Retrospective | Menneen työn yhteinen arviointi, jossa tunnistetaan opit ja parannukset. | A shared review of past work to identify lessons and improvements. |
| julkaisu / Release | Testattujen muutosten tai uuden version saattaminen käyttäjien saataville. | Making tested changes or a new version available to users. |
| riski / Risk | Epävarmuus tai uhka, joka voi haitata suunnitelmaa tai toimintaa. | An uncertainty or threat that may affect a plan or operations. |
| määräaika / Deadline | Sitova ajankohta, johon mennessä toimitus, päätös tai velvoite on hoidettava. | A fixed date by which a delivery, decision or obligation must be completed. |
