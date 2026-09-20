Filterest 9.3.14 brings the site assistant to the dataset chat and makes searching a dataset the same thing as browsing it. Database compatibility moves from 9.7.15 to 9.8.0; the migrations are additive and existing installations keep their rows.

- An administrator can ask the dataset chat's coding agent to work on the site itself. The job reads live data through the site's own interface with the asking person's rights, and any change it prepares waits in the chat: each one shows what it would do and its exact request, and one button approves and runs them. Screenshots can be attached to the question.
- An approval names exactly one target. The dataset, ticket or comment a change addresses is part of what was approved, so an approval given for one cannot be spent on another that happens to look the same.
- When one approved change fails, the ones not yet attempted are kept and can be approved again, instead of disappearing with an offer to retry work that no longer exists.
- The chat says which agent it is about to run. One choice previously ran either an agent that may edit the code workspace or one that may only call the site's own interface, depending on the environment, while the waiting text promised the first in both cases.
- Searching a dataset is browsing it. A search used to answer with a separate list of ten best matches; it is now a condition of the dataset's own listing, so the counter shows the real number of matches in the dataset in front of you, endless scrolling loads the rest, and matches are ordered by relevance. Results found in other datasets follow afterwards as a short extract around the words that matched.
- Creating and editing a dataset offer the same settings, including a decimal number with its digits and decimal places, as well as symbols, folders, relations, group read access, images and deletion protection.
- A price can be left empty. Adding a row to a dataset with a decimal column failed outright when the field was blank; an empty field is missing data, as it already was for dates and whole numbers, and a comma is read as a decimal point.
- A half-filled add-row form survives a page refresh, kept per dataset and cleared once the row is created.
- A new dataset has readable names for itself and its columns, in the languages the installation uses, instead of raw column names.
- Starting the application no longer deletes permission settings. It reports what it would remove and removes nothing unless an operator approves that run explicitly.
- Renaming the code behind a web address no longer strands that address's permissions on a row nothing serves, and a grant left on a retired address no longer opens it.
- Every address states which kinds of request it answers, in one place, so a request that only reads cannot reach code that changes data.
- A dataset is described in one place, so the article view, the table view and the editing controls cannot disagree about a column.
- Interface text is served as written, and the cleanup that retires unused language keys no longer removes one that is still in use.
- The developer ticket and workline tools shipped with Filterest now work from this repository alone.
- Queen, the agent orchestrator, is retired; its browser surface, its addresses and its permissions are removed.

Existing installations retain their data and settings.
