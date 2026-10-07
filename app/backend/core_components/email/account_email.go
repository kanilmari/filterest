// account_email.go
// Delivers private account mail without printing names, addresses or provider bodies.
// Bridges reviewed caller-supplied translated copy with the existing Postmark transport.
// Exists to keep welcome, recovery and security notices outside committed account transactions.
package email

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"html"
	"io"
	"net/http"
	"strings"
)

// SendAccountEmail is intentionally separate from SendOTPEmail's historical logging behavior.
func SendAccountEmail(to, subject, body string) error {
	token := firstConfiguredEnv("POSTMARK_API_KEY", "POSTMARK_SERVER_TOKEN")
	from := firstConfiguredEnv("EMAIL_FROM_ADDRESS", "POSTMARK_FROM_ADDRESS")
	if token == "" || from == "" {
		return errors.New("account mail delivery unavailable")
	}
	if validateMailboxAddress("sender", from) != nil || validateMailboxAddress("recipient", to) != nil {
		return errors.New("account mail address invalid")
	}
	payload, err := json.Marshal(postmarkRequest{From: from, To: to, Subject: subject, TextBody: body, HtmlBody: "<p>" + strings.ReplaceAll(html.EscapeString(body), "\n", "<br>") + "</p>", Headers: []postmarkHeader{{Name: "Auto-Submitted", Value: "auto-generated"}}})
	if err != nil {
		return errors.New("account mail encoding failed")
	}
	req, err := http.NewRequest(http.MethodPost, postmarkURL, bytes.NewReader(payload))
	if err != nil {
		return errors.New("account mail request failed")
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Postmark-Server-Token", token)
	response, err := postmarkHTTPClient.Do(req)
	if err != nil {
		return errors.New("account mail delivery failed")
	}
	defer response.Body.Close()
	var result postmarkResponse
	if response.StatusCode < 200 || response.StatusCode >= 300 || json.NewDecoder(io.LimitReader(response.Body, 64*1024)).Decode(&result) != nil || result.ErrorCode != 0 || result.MessageID == "" {
		return errors.New("account mail delivery failed")
	}
	return nil
}

// SendPasswordResetEmail contains the login name only in the account owner's mail.
func SendPasswordResetEmail(to, formattedCode, loginName, subject, loginLabel, codeLabel string) error {
	return SendAccountEmail(to, subject, loginLabel+"\n"+loginName+"\n\n"+codeLabel+"\n"+formattedCode)
}

// SendAccountNotice returns a language key after a committed welcome or name change.
// It is shared by HTTP and operator recovery callers and never exposes provider text.
func SendAccountNotice(ctx context.Context, db *sql.DB, address, loginName string, welcome bool) string {
	prefix := "notice_email_"
	if welcome {
		prefix = "registration_email_"
	}
	if strings.TrimSpace(address) == "" || firstConfiguredEnv("POSTMARK_API_KEY", "POSTMARK_SERVER_TOKEN") == "" || firstConfiguredEnv("EMAIL_FROM_ADDRESS", "POSTMARK_FROM_ADDRESS") == "" {
		return prefix + "not_configured"
	}
	copy := func(key string) string {
		var text string
		if db != nil {
			_ = db.QueryRowContext(ctx, `SELECT COALESCE(NULLIF(en,''),fi) FROM system_lang_keys WHERE lang_key=$1`, key).Scan(&text)
		}
		if text == "" {
			return key
		}
		return text
	}
	subject, body := copy("login_name_change_notice_subject"), copy("login_name_change_notice_body")
	if welcome {
		subject, body = copy("registration_welcome_subject"), copy("registration_welcome_body")
	}
	if loginName != "" {
		body += "\n" + loginName
	}
	if SendAccountEmail(address, subject, body) != nil {
		return prefix + "failed"
	}
	return prefix + "sent"
}
