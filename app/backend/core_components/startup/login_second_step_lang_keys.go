// login_second_step_lang_keys.go
// Seeds factor-specific sign-in and recovery copy without replacing reviewed translations.
// Connects the shared second-step view catalogue to normal startup maintenance.
// Exists so page and modal code screens use the same multilingual language keys.
package startup

import "database/sql"

// Chinese rows are machine-written and await native-language review.
var loginSecondStepLangKeySeeds = []startupLangKeySeed{
	{langKey: "verification_step", fi: "Kirjautuminen · vaihe 2/2", en: "Sign-in · step 2 of 2", ch: "登录 · 第2步，共2步"},
	{langKey: "verification_heading", fi: "Vahvista kirjautuminen", en: "Confirm sign-in", ch: "确认登录"},
	{langKey: "verification_pin_instruction", fi: "Syötä kirjautumista varten määrittämäsi PIN-koodi.", en: "Enter the PIN you set up for sign-in.", ch: "请输入您为登录设置的PIN码。"},
	{langKey: "verification_pin_label", fi: "PIN-koodi", en: "PIN", ch: "PIN码"},
	{langKey: "verification_pin_hint", fi: "4–8 numeroa. Käytä samaa PIN-koodia jokaisella kirjautumisella.", en: "4–8 digits. Use the same PIN each time you sign in.", ch: "4–8位数字。每次登录使用相同的PIN码。"},
	{langKey: "verification_pin_error", fi: "PIN-koodi ei kelpaa. Tarkista se ja yritä uudelleen.", en: "The PIN is not valid. Check it and try again.", ch: "PIN码无效。请检查后重试。"},
	{langKey: "verification_pin_empty", fi: "Syötä PIN-koodi.", en: "Enter your PIN.", ch: "请输入PIN码。"},
	{langKey: "verification_pin_help_action", fi: "Ongelmia PIN-koodin kanssa?", en: "Trouble with your PIN?", ch: "PIN码有问题？"},
	{langKey: "verification_pin_help", fi: "Jos unohdit PIN-koodin, ota yhteyttä sivuston ylläpitäjään.", en: "If you forgot your PIN, contact the site administrator.", ch: "如果忘记PIN码，请联系网站管理员。"},
	{langKey: "verification_email_instruction", fi: "Syötä sähköpostiisi lähetetty vahvistuskoodi.", en: "Enter the verification code sent to your email.", ch: "请输入发送至您邮箱的验证码。"},
	{langKey: "verification_code_label", fi: "Vahvistuskoodi", en: "Verification code", ch: "验证码"},
	{langKey: "verification_email_hint", fi: "9 kirjainta tai numeroa. Voit liittää koko koodin välilyönteineen.", en: "9 letters or numbers. You can paste the whole code, including spaces.", ch: "9个字母或数字。您可以粘贴包含空格的完整代码。"},
	{langKey: "verification_email_error", fi: "Vahvistuskoodi ei kelpaa tai on vanhentunut. Tarkista koodi tai pyydä uusi.", en: "The verification code is not valid or has expired. Check it or request a new one.", ch: "验证码无效或已过期。请检查代码或申请新代码。"},
	{langKey: "verification_code_empty", fi: "Syötä vahvistuskoodi.", en: "Enter the verification code.", ch: "请输入验证码。"},
	{langKey: "verification_recipient", fi: "Vastaanottaja", en: "Sent to", ch: "收件人"},
	{langKey: "verification_totp_instruction", fi: "Syötä todennussovelluksen nykyinen vahvistuskoodi.", en: "Enter the current verification code from your authenticator app.", ch: "请输入身份验证器应用当前显示的验证码。"},
	{langKey: "verification_totp_hint", fi: "6 numeroa. Käytä sovelluksessa juuri nyt näkyvää koodia.", en: "6 digits. Use the code currently shown in the app.", ch: "6位数字。请使用应用当前显示的代码。"},
	{langKey: "verification_totp_error", fi: "Vahvistuskoodi ei kelpaa. Syötä sovelluksen nykyinen koodi.", en: "The verification code is not valid. Enter the current code from the app.", ch: "验证码无效。请输入应用当前显示的代码。"},
	{langKey: "verification_totp_help_action", fi: "Etkö voi käyttää sovellusta?", en: "Cannot use your authenticator app?", ch: "无法使用身份验证器应用？"},
	{langKey: "verification_totp_help", fi: "Jos et voi käyttää todennussovellusta, ota yhteyttä sivuston ylläpitäjään.", en: "If you cannot use your authenticator app, contact the site administrator.", ch: "如果无法使用身份验证器应用，请联系网站管理员。"},
	{langKey: "verification_sign_in", fi: "Vahvista ja kirjaudu", en: "Verify and sign in", ch: "验证并登录"},
	{langKey: "verification_checking", fi: "Tarkistetaan…", en: "Checking…", ch: "正在检查…"},
	{langKey: "verification_back", fi: "Takaisin kirjautumiseen", en: "Back to sign-in", ch: "返回登录"},
	{langKey: "verification_resend", fi: "Pyydä uusi koodi", en: "Request a new code", ch: "申请新代码"},
	{langKey: "verification_resending", fi: "Pyydetään uutta koodia…", en: "Requesting a new code…", ch: "正在申请新代码…"},
	{langKey: "verification_send_failed", fi: "Koodia ei voitu lähettää. Yritä uudelleen.", en: "The code could not be sent. Try again.", ch: "无法发送代码。请重试。"},
	{langKey: "verification_attempts", fi: "Yrityksiä jäljellä: $count.", en: "Attempts remaining: $count.", ch: "剩余尝试次数：$count。"},
	{langKey: "verification_locked", fi: "Liian monta yritystä. Odota ennen uutta yritystä.", en: "Too many attempts. Wait before trying again.", ch: "尝试次数过多。请稍后重试。"},
	{langKey: "verification_expired", fi: "Vahvistus on päättynyt. Aloita vahvistus uudelleen.", en: "This verification has ended. Start verification again.", ch: "本次验证已结束。请重新开始验证。"},
	{langKey: "verification_unavailable", fi: "Vahvistus ei ole juuri nyt käytettävissä. Yritä hetken kuluttua uudelleen.", en: "Verification is temporarily unavailable. Try again shortly.", ch: "验证暂时不可用。请稍后重试。"},
	{langKey: "verification_pin_format", fi: "PIN-koodissa pitää olla 4–8 numeroa.", en: "The PIN must contain 4–8 digits.", ch: "PIN码必须包含4–8位数字。"},
	{langKey: "verification_totp_format", fi: "Syötä 6 numeroa.", en: "Enter 6 digits.", ch: "请输入6位数字。"},
	{langKey: "verification_email_format", fi: "Syötä koodin kaikki 9 kirjainta tai numeroa.", en: "Enter all 9 letters or numbers in the code.", ch: "请输入代码的全部9个字母或数字。"},
	{langKey: "reset_step", fi: "Tilin palautus", en: "Account recovery", ch: "账户恢复"},
	{langKey: "reset_heading", fi: "Vaihda salasana", en: "Reset your password", ch: "重置密码"},
	{langKey: "password_reset_send_attempted", fi: "Jos tili löytyy, yritämme lähettää palautuskoodin. Voit pyytää uuden koodin.", en: "If the account exists, we will try to send a recovery code. You can request a new code.", ch: "如果账户存在，我们将尝试发送恢复码。您可以申请新代码。"},
	{langKey: "reset_code_label", fi: "Palautuskoodi", en: "Recovery code", ch: "恢复码"},
	{langKey: "reset_code_hint", fi: "9 kirjainta tai numeroa. Lisää alle uusi salasana.", en: "9 letters or numbers. Add your new password below.", ch: "9个字母或数字。请在下方输入新密码。"},
	{langKey: "reset_code_error", fi: "Palautuskoodi ei kelpaa tai on vanhentunut. Tarkista koodi tai pyydä uusi.", en: "The recovery code is not valid or has expired. Check it or request a new one.", ch: "恢复码无效或已过期。请检查代码或申请新代码。"},
	{langKey: "reset_code_empty", fi: "Syötä palautuskoodi.", en: "Enter the recovery code.", ch: "请输入恢复码。"},
	{langKey: "new_password", fi: "Uusi salasana", en: "New password", ch: "新密码"},
	{langKey: "reset_password_hint", fi: "Valitse tilillesi uusi salasana.", en: "Choose a new password for your account.", ch: "为您的账户选择新密码。"},
	{langKey: "reset_password_empty", fi: "Syötä uusi salasana.", en: "Enter a new password.", ch: "请输入新密码。"},
	{langKey: "reset_password", fi: "Vaihda salasana", en: "Reset password", ch: "重置密码"},
	{langKey: "show_pin", fi: "Näytä PIN-koodi", en: "Show PIN", ch: "显示PIN码"},
	{langKey: "hide_pin", fi: "Piilota PIN-koodi", en: "Hide PIN", ch: "隐藏PIN码"},
	{langKey: "show_password", fi: "Näytä salasana", en: "Show password", ch: "显示密码"},
	{langKey: "hide_password", fi: "Piilota salasana", en: "Hide password", ch: "隐藏密码"},
	{langKey: "password_updated_sign_in", fi: "Salasana vaihdettu. Kirjaudu sisään uudella salasanalla.", en: "Password updated. Log in with the new password.", ch: "密码已更新。请使用新密码登录。"},
}

// EnsureLoginSecondStepLangKeys only inserts keys or fills empty language values.
func EnsureLoginSecondStepLangKeys(db *sql.DB) {
	ensureStartupLangKeySeeds(db, loginSecondStepLangKeySeeds, "login second step")
}
