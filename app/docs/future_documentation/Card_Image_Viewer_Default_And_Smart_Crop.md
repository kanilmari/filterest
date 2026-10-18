<!-- Describes optional future card-image preferences and automatic framing. -->
<!-- Connects personal viewing choices, administrator control and image uses. -->
<!-- Keeps unimplemented concepts separate from the current light model. -->

# Card image viewer default and smart crop

These extensions would give people more control over card images while keeping
the original image intact. Each extension is independent of the others.

## Viewer default

A viewer could choose how to display card photographs: fill and crop, show the
whole image, or show the whole image over a blurred background. An explicit
choice for an image use would take precedence, followed by the viewer's choice,
the dataset default, and the site default. With no choice, the whole image is
shown. The viewer level belongs above the dataset level so it remains useful
when an administrator has already chosen a dataset default.

Signed-in viewers would keep the preference with their account. An anonymous
viewer would keep it only in their own browser, without writing to a shared
guest account. Resetting the preference would restore inheritance and leave
other account settings intact. The interface would explain the effective level
in the viewer's language.

## Administrator lock

An administrator could protect a particular image use from later changes by a
row owner. A lock would belong to that use, with its scope and reason visible to
the owner. It would neither grant row-edit rights nor protect unrelated uses of
the same library image. Administrator changes and unlocking would remain
available. Introducing a lock also requires an explicit decision about how
ownership and ordinary row-edit rights interact; ownership alone must never
become an alternative permission system.

## Cover image used in a card

A dataset's cover could have a separate presentation choice for its card use.
Changing that choice would leave its banner and background presentations alone.
The cover's existing focal point could guide a filling crop, while its card
presentation would follow the documented inheritance levels. Only a person
authorized to administer the dataset could change shared cover settings.

## Automatic smart crop

Smart crop could suggest a focal point by locating a face or the main subject.
The same point would work across desktop and phone card proportions. People
could preview the suggestion, adjust it, or return to the center; an automatic
suggestion would never silently replace their saved point. Detection would keep
the original image and avoid storing face identities. Any external processing
would require a clear site choice about disclosure and processing boundaries.

A focal point and a presentation are separate concepts: a point guides a
filling crop even when the presentation is inherited, and whole-image modes
remain centered. A suggestion belongs to an image use unless an explicit,
authorized operation applies it elsewhere.
