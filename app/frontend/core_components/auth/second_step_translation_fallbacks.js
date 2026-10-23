// second_step_translation_fallbacks.js
// Provides the reviewed Finnish and English sign-in verification copy before startup seeding.
// Connects the shared code view and the page translator through the local fallback catalogue.
// Exists so missing server translations never expose implementation names.
export const SECOND_STEP_TRANSLATION_FALLBACKS = {
    "verification_step": {
        "fi": "Kirjautuminen · vaihe 2/2",
        "en": "Sign-in · step 2 of 2"
    },
    "verification_heading": {
        "fi": "Vahvista kirjautuminen",
        "en": "Confirm sign-in"
    },
    "verification_pin_instruction": {
        "fi": "Syötä kirjautumista varten määrittämäsi PIN-koodi.",
        "en": "Enter the PIN you set up for sign-in."
    },
    "verification_pin_label": {
        "fi": "PIN-koodi",
        "en": "PIN"
    },
    "verification_pin_hint": {
        "fi": "4–8 numeroa. Käytä samaa PIN-koodia jokaisella kirjautumisella.",
        "en": "4–8 digits. Use the same PIN each time you sign in."
    },
    "verification_pin_error": {
        "fi": "PIN-koodi ei kelpaa. Tarkista se ja yritä uudelleen.",
        "en": "The PIN is not valid. Check it and try again."
    },
    "verification_pin_empty": {
        "fi": "Syötä PIN-koodi.",
        "en": "Enter your PIN."
    },
    "verification_pin_help_action": {
        "fi": "Ongelmia PIN-koodin kanssa?",
        "en": "Trouble with your PIN?"
    },
    "verification_pin_help": {
        "fi": "Jos unohdit PIN-koodin, ota yhteyttä sivuston ylläpitäjään.",
        "en": "If you forgot your PIN, contact the site administrator."
    },
    "verification_email_instruction": {
        "fi": "Syötä sähköpostiisi lähetetty vahvistuskoodi.",
        "en": "Enter the verification code sent to your email."
    },
    "verification_code_label": {
        "fi": "Vahvistuskoodi",
        "en": "Verification code"
    },
    "verification_email_hint": {
        "fi": "9 kirjainta tai numeroa. Voit liittää koko koodin välilyönteineen.",
        "en": "9 letters or numbers. You can paste the whole code, including spaces."
    },
    "verification_email_error": {
        "fi": "Vahvistuskoodi ei kelpaa tai on vanhentunut. Tarkista koodi tai pyydä uusi.",
        "en": "The verification code is not valid or has expired. Check it or request a new one."
    },
    "verification_code_empty": {
        "fi": "Syötä vahvistuskoodi.",
        "en": "Enter the verification code."
    },
    "verification_recipient": {
        "fi": "Vastaanottaja",
        "en": "Sent to"
    },
    "verification_totp_instruction": {
        "fi": "Syötä todennussovelluksen nykyinen vahvistuskoodi.",
        "en": "Enter the current verification code from your authenticator app."
    },
    "verification_totp_hint": {
        "fi": "6 numeroa. Käytä sovelluksessa juuri nyt näkyvää koodia.",
        "en": "6 digits. Use the code currently shown in the app."
    },
    "verification_totp_error": {
        "fi": "Vahvistuskoodi ei kelpaa. Syötä sovelluksen nykyinen koodi.",
        "en": "The verification code is not valid. Enter the current code from the app."
    },
    "verification_totp_help_action": {
        "fi": "Etkö voi käyttää sovellusta?",
        "en": "Cannot use your authenticator app?"
    },
    "verification_totp_help": {
        "fi": "Jos et voi käyttää todennussovellusta, ota yhteyttä sivuston ylläpitäjään.",
        "en": "If you cannot use your authenticator app, contact the site administrator."
    },
    "verification_sign_in": {
        "fi": "Vahvista ja kirjaudu",
        "en": "Verify and sign in"
    },
    "verification_checking": {
        "fi": "Tarkistetaan…",
        "en": "Checking…"
    },
    "verification_back": {
        "fi": "Takaisin kirjautumiseen",
        "en": "Back to sign-in"
    },
    "verification_resend": {
        "fi": "Pyydä uusi koodi",
        "en": "Request a new code"
    },
    "verification_resending": {
        "fi": "Pyydetään uutta koodia…",
        "en": "Requesting a new code…"
    },
    "verification_send_failed": {
        "fi": "Koodia ei voitu lähettää. Yritä uudelleen.",
        "en": "The code could not be sent. Try again."
    },
    "verification_attempts": {
        "fi": "Yrityksiä jäljellä: $count.",
        "en": "Attempts remaining: $count."
    },
    "verification_locked": {
        "fi": "Liian monta yritystä. Odota ennen uutta yritystä.",
        "en": "Too many attempts. Wait before trying again."
    },
    "verification_expired": {
        "fi": "Vahvistus on päättynyt. Aloita vahvistus uudelleen.",
        "en": "This verification has ended. Start verification again."
    },
    "verification_unavailable": {
        "fi": "Vahvistus ei ole juuri nyt käytettävissä. Yritä hetken kuluttua uudelleen.",
        "en": "Verification is temporarily unavailable. Try again shortly."
    },
    "verification_pin_format": {
        "fi": "PIN-koodissa pitää olla 4–8 numeroa.",
        "en": "The PIN must contain 4–8 digits."
    },
    "verification_totp_format": {
        "fi": "Syötä 6 numeroa.",
        "en": "Enter 6 digits."
    },
    "verification_email_format": {
        "fi": "Syötä koodin kaikki 9 kirjainta tai numeroa.",
        "en": "Enter all 9 letters or numbers in the code."
    },
    "reset_step": {
        "fi": "Tilin palautus",
        "en": "Account recovery"
    },
    "reset_heading": {
        "fi": "Vaihda salasana",
        "en": "Reset your password"
    },
    "password_reset_send_attempted": {
        "fi": "Jos tili löytyy, yritämme lähettää palautuskoodin. Voit pyytää uuden koodin.",
        "en": "If the account exists, we will try to send a recovery code. You can request a new code."
    },
    "reset_code_label": {
        "fi": "Palautuskoodi",
        "en": "Recovery code"
    },
    "reset_code_hint": {
        "fi": "9 kirjainta tai numeroa. Lisää alle uusi salasana.",
        "en": "9 letters or numbers. Add your new password below."
    },
    "reset_code_error": {
        "fi": "Palautuskoodi ei kelpaa tai on vanhentunut. Tarkista koodi tai pyydä uusi.",
        "en": "The recovery code is not valid or has expired. Check it or request a new one."
    },
    "reset_code_empty": {
        "fi": "Syötä palautuskoodi.",
        "en": "Enter the recovery code."
    },
    "new_password": {
        "fi": "Uusi salasana",
        "en": "New password"
    },
    "reset_password_hint": {
        "fi": "Valitse tilillesi uusi salasana.",
        "en": "Choose a new password for your account."
    },
    "reset_password_empty": {
        "fi": "Syötä uusi salasana.",
        "en": "Enter a new password."
    },
    "reset_password": {
        "fi": "Vaihda salasana",
        "en": "Reset password"
    },
    "show_pin": {
        "fi": "Näytä PIN-koodi",
        "en": "Show PIN"
    },
    "hide_pin": {
        "fi": "Piilota PIN-koodi",
        "en": "Hide PIN"
    },
    "show_password": {
        "fi": "Näytä salasana",
        "en": "Show password"
    },
    "hide_password": {
        "fi": "Piilota salasana",
        "en": "Hide password"
    },
    "password_updated_sign_in": {
        "fi": "Salasana vaihdettu. Kirjaudu sisään uudella salasanalla.",
        "en": "Password updated. Log in with the new password."
    }
};
