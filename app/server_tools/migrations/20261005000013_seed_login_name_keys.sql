-- Seeds Finnish and English account-name copy (WL132, K175/K203/K205).
-- Connects the account rule, sign-in/profile flows and settings with reviewed translations.
-- Existing reviewed wording is preserved in both translation stores.
-- VERSION_DB: 9.10.0
-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql

WITH authored_keys(lang_key, fi, en) AS (
    VALUES
        ('error_admin_display_name_equals_login_name', 'Ylläpitäjän näyttönimen on oltava eri kuin kirjautumisnimi.', 'An administrator’s display name must differ from the login name.'),
        ('error_user_display_name_equals_login_name', 'Tällä sivustolla näyttönimen on oltava eri kuin kirjautumisnimi.', 'On this site the display name must differ from the login name.'),
        ('username_exists', 'Näyttönimi on jo käytössä.', 'The display name is already in use.'),
        ('error_identity_edit_requires_administrator', 'Vain ylläpitäjä voi muokata käyttäjä- ja oikeustietoja tässä editorissa.', 'Only an administrator may edit account and permission data in this editor.'),
        ('login_name', 'Kirjautumisnimi', 'Login name'),
        ('display_name', 'Näyttönimi', 'Display name'),
        ('login_name_help', 'Kirjautumisnimeä käytetään vain kirjautumiseen. Muut eivät näe sitä.', 'The login name is used only to sign in. Other people cannot see it.'),
        ('display_name_help', 'Näyttönimi näkyy muille käyttäjille.', 'The display name is visible to other people.'),
        ('login_name_exists', 'Kirjautumisnimi on jo käytössä.', 'The login name is already in use.'),
        ('login_name_invalid', 'Kirjautumisnimen on alettava kirjaimella tai numerolla. Käytä vain kirjaimia, numeroita, alaviivaa, pistettä tai yhdysmerkkiä.', 'Start the login name with a letter or number. Use only letters, numbers, underscores, dots or hyphens.'),
        ('login_name_reserved', 'Tämä kirjautumisnimi on varattu järjestelmälle.', 'This login name is reserved for the system.'),
        ('login_name_fixed', 'Tämän ohjelmatilin kirjautumisnimeä ei voi vaihtaa.', 'This program account has a fixed login name.'),
        ('change_login_name', 'Vaihda kirjautumisnimi', 'Change login name'),
        ('new_login_name', 'Uusi kirjautumisnimi', 'New login name'),
        ('current_password', 'Nykyinen salasana', 'Current password'),
        ('current_password_required', 'Anna nykyinen salasana.', 'Enter your current password.'),
        ('profile_password_rate_limited', 'Nykyistä salasanaa on yritetty väärin kolme kertaa viidessä minuutissa. Odota ennen uutta yritystä.', 'The current password was entered incorrectly three times in five minutes. Wait before trying again.'),
        ('current_password_incorrect', 'Nykyinen salasana on väärä.', 'The current password is incorrect.'),
        ('login_name_change_help', 'Anna nykyinen salasana. Muut kirjautumisesi päättyvät nimen vaihdon jälkeen.', 'Enter your current password. Your other sign-ins end after the name changes.'),
        ('login_name_changed', 'Kirjautumisnimi vaihdettu.', 'Login name changed.'),
        ('login_name_change_use_profile', 'Vaihda oma kirjautumisnimesi profiilisivulla nykyisellä salasanallasi.', 'Change your own login name in your profile using your current password.'),
        ('login_name_change_failed', 'Kirjautumisnimeä ei voitu vaihtaa. Yritä uudelleen.', 'The login name could not be changed. Try again.'),
        ('login_name_change_rate_limited', 'Voit yrittää kirjautumisnimen vaihtoa kolme kertaa viidessä minuutissa. Odota ennen uutta yritystä.', 'You may try to change the login name three times in five minutes. Wait before trying again.'),
        ('login_name_change_notice_subject', 'Kirjautumisnimesi on vaihdettu', 'Your login name has changed'),
        ('login_name_change_notice_body', 'Tilisi kirjautumisnimi on vaihdettu. Jos et tehnyt muutosta, ota yhteyttä sivuston ylläpitäjään.', 'Your account’s login name has changed. If you did not make this change, contact the site administrator.'),
        ('notice_email_sent', 'Ilmoitus lähetettiin sähköpostiisi.', 'A notice was sent to your email.'),
        ('notice_email_failed', 'Muutos tallennettiin, mutta sähköpostia ei voitu lähettää.', 'The change was saved, but the email could not be sent.'),
        ('notice_email_not_configured', 'Muutos tallennettiin. Sähköposti-ilmoitus ei ole käytössä.', 'The change was saved. Email notices are not configured.'),
        ('registration_welcome_subject', 'Tervetuloa', 'Welcome'),
        ('registration_welcome_body', 'Tilisi on luotu. Kirjautumisnimesi:', 'Your account has been created. Your login name:'),
        ('registration_email_sent', 'Tili luotiin ja tervetuloviesti lähetettiin sähköpostiisi.', 'The account was created and a welcome email was sent.'),
        ('registration_email_failed', 'Tili luotiin, mutta tervetuloviestiä ei voitu lähettää.', 'The account was created, but the welcome email could not be sent.'),
        ('registration_email_not_configured', 'Tili luotiin ilman tervetuloviestiä.', 'The account was created without a welcome email.'),
        ('login_name_or_email', 'Kirjautumisnimi tai sähköposti', 'Login name or email'),
        ('password_reset_send_attempted', 'Jos tili löytyy, yritämme lähettää palautuskoodin. Voit pyytää uuden koodin.', 'If the account exists, we will try to send a recovery code. You can request a new code.'),
        ('password_reset_login_name', 'Tilisi kirjautumisnimi: $login_name', 'Your account’s login name: $login_name'),
        ('sign_out_other_devices', 'Kirjaudu ulos muilta laitteilta', 'Sign out other devices'),
        ('sign_out_other_devices_help', 'Anna nykyinen salasana. Tämä kirjautuminen jatkuu, ja muut laitteet kirjautuvat ulos seuraavalla pyynnöllä.', 'Enter your current password. This sign-in continues; other devices sign out on their next request.'),
        ('other_devices_signed_out', 'Muut kirjautumisesi on päätetty. Tämä kirjautuminen jatkuu.', 'Your other sign-ins have ended. This sign-in continues.'),
        ('sign_out_other_devices_failed', 'Muita kirjautumisia ei voitu päättää. Yritä uudelleen.', 'Your other sign-ins could not be ended. Try again.'),
        ('display_name_may_equal_login_name', 'Näyttönimi saa olla sama kuin kirjautumisnimi', 'Display name may equal login name'),
        ('display_name_may_equal_login_name_help', 'Koskee tavallisia käyttäjiä. Ylläpitäjän nimet ovat aina eri. Kun asetus poistetaan käytöstä, olemassa olevat samat nimet säilyvät, kunnes käyttäjä muuttaa nimeään.', 'Applies to ordinary users. Administrators always use different names. Turning this off preserves existing equal names until a user changes a name.'),
        ('account_names_may_be_same', 'Saa olla sama', 'May be the same'),
        ('first_run_name_choice_invalid', 'Valitse, saavatko tavallisen käyttäjän nimet olla samat.', 'Choose whether ordinary users may use equal names.'),
        ('account_names_must_differ', 'On oltava eri', 'Must be different')
), written_keys AS (
    INSERT INTO public.system_lang_keys AS existing (lang_key, fi, en, creation_spec)
    SELECT lang_key, fi, en, 'WL132 account name copy.' FROM authored_keys
    ON CONFLICT (lang_key) DO UPDATE
       SET fi = CASE WHEN NULLIF(btrim(existing.fi), '') IS NULL THEN EXCLUDED.fi ELSE existing.fi END,
           en = CASE WHEN NULLIF(btrim(existing.en), '') IS NULL THEN EXCLUDED.en ELSE existing.en END,
           creation_spec = CASE WHEN NULLIF(btrim(existing.creation_spec), '') IS NULL
                                THEN EXCLUDED.creation_spec ELSE existing.creation_spec END,
           updated = now()
     WHERE NULLIF(btrim(existing.fi), '') IS NULL OR NULLIF(btrim(existing.en), '') IS NULL
        OR NULLIF(btrim(existing.creation_spec), '') IS NULL
    RETURNING existing.id, existing.lang_key, existing.fi, existing.en
), served_keys AS (
    SELECT id, lang_key, fi, en FROM written_keys
    UNION ALL
    SELECT keys.id, keys.lang_key, keys.fi, keys.en FROM public.system_lang_keys AS keys
    JOIN authored_keys USING (lang_key) WHERE keys.lang_key NOT IN (SELECT lang_key FROM written_keys)
)
INSERT INTO public.system_lang_key_translations AS existing
    (lang_key_id, language_code, translation, source_kind, review_status)
SELECT served.id, copy.language_code, copy.translation, 'manual', 'approved'
  FROM served_keys AS served
 CROSS JOIN LATERAL (VALUES ('fi', served.fi), ('en', served.en)) AS copy(language_code, translation)
 JOIN public.system_languages AS languages ON languages.language_code = copy.language_code
 WHERE NULLIF(btrim(copy.translation), '') IS NOT NULL
ON CONFLICT (lang_key_id, language_code) DO UPDATE
   SET translation = EXCLUDED.translation, source_kind = 'manual', review_status = 'approved'
 WHERE NULLIF(btrim(existing.translation), '') IS NULL;
