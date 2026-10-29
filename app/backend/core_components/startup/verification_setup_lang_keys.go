// verification_setup_lang_keys.go
// Seeds shared profile-code and PIN/authenticator enrollment copy without replacing site translations.
// Connects embedded verification descriptors to normal startup language maintenance.
// Exists so setup and profile fields use reviewed, accessible multilingual copy.
package startup

import "database/sql"

// Chinese rows are machine-written and await native-language review.
var verificationSetupLangKeySeeds = []startupLangKeySeed{
	{langKey: "email_change_heading", fi: "Vahvista uusi sähköpostiosoite", en: "Confirm your new email address", ch: "确认新邮箱地址"},
	{langKey: "email_change_instruction", fi: "Syötä uuteen sähköpostiosoitteeseesi lähetetty vahvistuskoodi.", en: "Enter the verification code sent to your new email address.", ch: "请输入发送至您新邮箱地址的验证码。"},
	{langKey: "email_change_confirm", fi: "Vahvista ja tallenna osoite", en: "Verify and save email", ch: "验证并保存邮箱"},
	{langKey: "password_change_heading", fi: "Vahvista salasanan vaihto", en: "Confirm your password change", ch: "确认密码更改"},
	{langKey: "password_change_instruction", fi: "Syötä nykyiseen sähköpostiosoitteeseesi lähetetty vahvistuskoodi.", en: "Enter the verification code sent to your current email address.", ch: "请输入发送至您当前邮箱地址的验证码。"},
	{langKey: "password_change_confirm", fi: "Vahvista ja vaihda salasana", en: "Verify and change password", ch: "验证并更改密码"},
	{langKey: "enrollment_step", fi: "Vahvistustavan käyttöönotto", en: "Verification setup", ch: "设置验证方式"},
	{langKey: "pin_setup_heading", fi: "Luo PIN-koodi", en: "Set up a PIN", ch: "设置PIN码"},
	{langKey: "pin_setup_instruction", fi: "Valitse kirjautumisessa käytettävä 4–8 numeron PIN-koodi.", en: "Choose a 4–8 digit PIN to use when signing in.", ch: "请选择用于登录的4–8位数字PIN码。"},
	{langKey: "pin_setup_hint", fi: "4–8 numeroa. Vahvista sama PIN-koodi alla.", en: "4–8 digits. Confirm the same PIN below.", ch: "4–8位数字。请在下方确认相同的PIN码。"},
	{langKey: "pin_confirm_hint", fi: "Syötä valitsemasi PIN-koodi uudelleen.", en: "Enter your chosen PIN again.", ch: "请再次输入您选择的PIN码。"},
	{langKey: "totp_setup_heading", fi: "Vahvista todennussovellus", en: "Confirm your authenticator app", ch: "确认身份验证器应用"},
	{langKey: "totp_setup_instruction", fi: "Kun olet lisännyt tilin todennussovellukseen, syötä sen nykyinen vahvistuskoodi.", en: "After adding the account to your authenticator app, enter its current verification code.", ch: "将账户添加到身份验证器应用后，请输入当前显示的验证码。"},
	{langKey: "pin_setup_label", fi: "PIN-koodi", en: "PIN", ch: "PIN码"},
	{langKey: "pin_setup_confirm_label", fi: "Vahvista PIN-koodi", en: "Confirm PIN", ch: "确认PIN码"},
	{langKey: "first_run_fixed_pin_invalid", fi: "PIN-koodissa pitää olla 4–8 numeroa.", en: "The PIN must contain 4–8 digits.", ch: "PIN码必须包含4–8位数字。"},
	{langKey: "first_run_fixed_pin_mismatch", fi: "PIN-koodit eivät täsmää.", en: "The PIN entries do not match.", ch: "两次输入的PIN码不一致。"},
	{langKey: "fixed_pin_format_error", fi: "PIN-koodissa pitää olla 4–8 numeroa.", en: "The PIN must contain 4–8 digits.", ch: "PIN码必须包含4–8位数字。"},
	{langKey: "fixed_pin_mismatch", fi: "PIN-koodit eivät täsmää.", en: "The PIN entries do not match.", ch: "两次输入的PIN码不一致。"},
	{langKey: "first_run_totp_invalid", fi: "Vahvistuskoodi ei kelpaa. Syötä sovelluksen nykyinen koodi.", en: "The verification code is not valid. Enter the current code from the app.", ch: "验证码无效。请输入应用当前显示的代码。"},
}

// EnsureVerificationSetupLangKeys inserts missing keys and fills empty language values only.
func EnsureVerificationSetupLangKeys(db *sql.DB) {
	ensureStartupLangKeySeeds(db, verificationSetupLangKeySeeds, "verification setup")
}
