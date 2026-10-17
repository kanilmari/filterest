// translation_source_writer.go
// Separates frontend translation context from scanner-owned literal authority.
// Connects the administrator translation writer to ordinary source provenance.
// Even an administrator request cannot mint a scanner marker through context.
package lang

import "strings"

// Frontend provenance describes context, never scanner authority, even when an
// administrator submitted it. Only the reviewed scanner can mint this marker.
func frontendTranslationSourceDetail(detail string) string {
	if strings.HasPrefix(detail, "ui_literal_v1:") {
		return ""
	}
	return detail
}
