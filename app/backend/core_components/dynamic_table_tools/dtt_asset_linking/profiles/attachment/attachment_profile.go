// attachment_profile.go
// Defines the first non-image profile defaults for the shared asset_linking module.
// Bridges future attachment enablement flows and the generic asset-linking scaffold.
// Exists to give PDFs, documents, and archives one isolated profile home before live wiring starts.
package attachment

var defaultAllowedFileTypes = []string{
	"pdf",
	"txt",
	"rtf",
	"doc",
	"docx",
	"odt",
	"csv",
	"xls",
	"xlsx",
	"zip",
	"7z",
	"rar",
}

var supportedAssetKinds = []string{
	"pdf",
	"document",
	"archive",
}

// DefaultAllowedFileTypes returns the seeded file-extension defaults for the attachment profile scaffold.
func DefaultAllowedFileTypes() []string {
	return append([]string(nil), defaultAllowedFileTypes...)
}

// SupportedAssetKinds returns the asset kinds grouped under the first attachment profile rollout.
func SupportedAssetKinds() []string {
	return append([]string(nil), supportedAssetKinds...)
}
