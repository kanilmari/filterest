// recipient_address_masker.go
// Shows only a recipient's first character and domain in operator output and logs.
// Connects account recovery selection and OTP delivery diagnostics.
// Keeps the identifying local part out of routine output.
package email

import "strings"

// MaskRecipientAddress omits the local part apart from its first character.
func MaskRecipientAddress(address string) string {
	local, domain, ok := strings.Cut(strings.TrimSpace(address), "@")
	if !ok || local == "" || domain == "" || strings.Contains(domain, "@") {
		return "(unavailable)"
	}
	return string([]rune(local)[0]) + "***@" + domain
}
