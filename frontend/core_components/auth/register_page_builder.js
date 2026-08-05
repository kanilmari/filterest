// register_page_builder.js
// Builds the registration page's initial client-side behavior.
// Bridges language preference reading with registration-page translation on load.
// Exists to keep pre-auth registration-page setup separate from shared auth utilities.

import { translatePage } from "../lang/translation_handler.js";
import { getPreferredAvailableLanguage } from "../state_stores/lang_preference_reader.js";

const chosenLanguage = getPreferredAvailableLanguage(['en', 'fi']);
translatePage(chosenLanguage);
