// credential_recovery_validator.go
// Validates administrator recovery passwords, fixed PINs, and email readiness.
// Bridges interactive recovery inputs with bcrypt-safe restricted credential values.
// Exists so every recovery caller enforces the same security boundary before database writes.
package credentials

import (
	"net/mail"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

// DatabaseVersionAtLeast compares stable three-part numeric database versions.
func DatabaseVersionAtLeast(current, minimum string) bool {
	parse := func(value string) ([3]int, bool) {
		var parsed [3]int
		parts := strings.Split(strings.TrimSpace(value), ".")
		if len(parts) != len(parsed) {
			return parsed, false
		}
		for index, part := range parts {
			number, err := strconv.Atoi(part)
			if err != nil || number < 0 {
				return parsed, false
			}
			parsed[index] = number
		}
		return parsed, true
	}

	currentVersion, currentOK := parse(current)
	minimumVersion, minimumOK := parse(minimum)
	if !currentOK || !minimumOK {
		return false
	}
	for index := range currentVersion {
		if currentVersion[index] != minimumVersion[index] {
			return currentVersion[index] > minimumVersion[index]
		}
	}
	return true
}

// ParseVerificationMethod converts persisted or requested factor text into a supported method.
func ParseVerificationMethod(value string) (VerificationMethod, error) {
	method := VerificationMethod(strings.ToLower(strings.TrimSpace(value)))
	switch method {
	case VerificationNone, VerificationFixedPIN, VerificationTOTP, VerificationEmail:
		return method, nil
	default:
		return "", ErrUnsupportedVerificationMethod
	}
}

// ValidatePassword enforces the administrator password policy and bcrypt's byte-size boundary.
func ValidatePassword(password string) error {
	runeCount := utf8.RuneCountInString(password)
	if runeCount < minimumPasswordLength || runeCount > maximumPasswordLength || len([]byte(password)) > 72 {
		return ErrInvalidPassword
	}
	for _, character := range password {
		if unicode.IsControl(character) {
			return ErrInvalidPassword
		}
	}
	return nil
}

// ValidateFixedPIN accepts only the product's established 4-8 ASCII digit format.
func ValidateFixedPIN(pin string) error {
	if len(pin) < 4 || len(pin) > 8 {
		return ErrInvalidFixedPIN
	}
	for _, character := range pin {
		if character < '0' || character > '9' {
			return ErrInvalidFixedPIN
		}
	}
	return nil
}

// EmailDeliveryConfigured matches the application's minimum outbound-auth configuration contract.
func EmailDeliveryConfigured(apiToken, fromAddress string) bool {
	return strings.TrimSpace(apiToken) != "" && EmailAddressLooksDeliverable(fromAddress)
}

// EmailAddressLooksDeliverable accepts a syntactically valid address but rejects reserved placeholders.
func EmailAddressLooksDeliverable(value string) bool {
	cleanValue := strings.TrimSpace(value)
	parsed, err := mail.ParseAddress(cleanValue)
	if err != nil || !strings.EqualFold(parsed.Address, cleanValue) {
		return false
	}
	at := strings.LastIndex(parsed.Address, "@")
	if at <= 0 || at == len(parsed.Address)-1 {
		return false
	}
	domain := strings.ToLower(parsed.Address[at+1:])
	for _, reservedSuffix := range []string{".invalid", ".example", ".test", ".localhost"} {
		if domain == strings.TrimPrefix(reservedSuffix, ".") || strings.HasSuffix(domain, reservedSuffix) {
			return false
		}
	}
	return true
}
