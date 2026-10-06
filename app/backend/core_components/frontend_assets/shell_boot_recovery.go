// shell_boot_recovery.go
// Embeds the single standalone shell guard and its independent recovery styles.
// Bridges nonce-bearing Go templates with translated presentation and GET safety.
// Only maintained static source is trusted script/CSS; copy stays escaped HTML.
package frontendassets

import (
	_ "embed"
	"html/template"
	"net/http"
	"os"

	"easelect/backend/core_components/lang"
	"easelect/backend/core_components/middlewares"
)

//go:embed shell_boot_recovery.js
var shellBootScript string

//go:embed shell_boot_recovery.css
var shellBootStyle string

// ShellBootData carries source and plain translated text into the four documents.
type ShellBootData struct {
	Script template.JS
	Style  template.CSS
	Texts  lang.ShellBootTexts
	IsGET  bool
}

// ShellPageData is the shared standalone-auth document presentation.
type ShellPageData struct {
	ShellBoot      ShellBootData
	CSPNonce       string
	LangCode       string
	IsDev          bool
	StandalonePage bool
}

// NewShellBootData freezes document-method safety independently of client routing.
func NewShellBootData(r *http.Request, languageCode string) ShellBootData {
	return ShellBootData{Script: template.JS(shellBootScript), Style: template.CSS(shellBootStyle),
		Texts: lang.ReadShellBootTexts(languageCode), IsGET: r.Method == http.MethodGet}
}

// NewShellPageData arms authentication guards only on standalone documents.
func NewShellPageData(r *http.Request) ShellPageData {
	languageCode := lang.ResolvePageLanguage(r)
	return ShellPageData{ShellBoot: NewShellBootData(r, languageCode), CSPNonce: middlewares.GetCSPNonce(r),
		LangCode: languageCode, IsDev: os.Getenv("ENVIRONMENT_TYPE") == "dev", StandalonePage: r.URL.Query().Get("fragment") != "1"}
}

// SetShellNoStoreHeaders prevents saved documents referring to retired asset hashes.
// It also protects the CSRF state carried by public authentication documents.
func SetShellNoStoreHeaders(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store, max-age=0, must-revalidate, private")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")
	w.Header().Add("Vary", "Cookie")
	w.Header().Add("Vary", "Accept-Language")
}

// RenderShellTemplateFailure replaces the old raw-template fallback with the
// same escaped, nonce-authorized recovery when the application template is broken.
func RenderShellTemplateFailure(w http.ResponseWriter, r *http.Request) {
	const failureDocument = `<!DOCTYPE html>
<html lang="{{.LangCode}}" data-shell-boot-pending data-shell-boot-document-failed data-shell-boot-get="{{.ShellBoot.IsGET}}" data-shell-boot-dev="{{.IsDev}}">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="app-env" content="{{if .IsDev}}dev{{else}}prod{{end}}">
<style id="shell-boot-style" nonce="{{.CSPNonce}}">{{.ShellBoot.Style}}</style>
<script id="shell-boot-guard" nonce="{{.CSPNonce}}">{{.ShellBoot.Script}}</script></head>
<body><div id="shell-boot-notice" role="status" aria-live="polite" aria-atomic="true" hidden>
<p id="shell-boot-loading" hidden>{{.ShellBoot.Texts.Loading}}</p>
<div id="shell-boot-failed" hidden><h1>{{.ShellBoot.Texts.FailedTitle}}</h1><p>{{.ShellBoot.Texts.FailedMessage}}</p>
<button type="button" id="shell-boot-reload">{{.ShellBoot.Texts.Reload}}</button></div>
<p id="shell-boot-unsupported" hidden>{{.ShellBoot.Texts.BrowserUnsupported}}</p></div>
<noscript><div class="shell-boot-noscript"><p>{{.ShellBoot.Texts.JavaScriptRequired}}</p></div></noscript></body></html>`
	page := template.Must(template.New("shell-template-failure").Parse(failureDocument))
	SetShellNoStoreHeaders(w)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusInternalServerError)
	_ = page.Execute(w, NewShellPageData(r))
}
