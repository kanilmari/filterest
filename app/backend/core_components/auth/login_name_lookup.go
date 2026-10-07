// login_name_lookup.go
// Reads a private login name and its complete credential snapshot once.
// Bridges confidential database permissions with sign-in's equal failure path.
// Exists to avoid display-name lookup and early returns before password comparison.
package auth

import (
	backend "easelect/backend/core_components"
	"errors"
	"golang.org/x/crypto/bcrypt"
)

// Generated once at the same cost as current account passwords; never derived from a request.
var dummyLoginPasswordHash = func() string {
	hash, err := bcrypt.GenerateFromPassword([]byte("unusable-dummy-sign-in-password"), bcrypt.DefaultCost)
	if err != nil {
		panic(err)
	}
	return string(hash)
}()
var compareLoginPassword = bcrypt.CompareHashAndPassword

func lookupLoginCredentials(name string) (int, bool, loginVerificationRecord, error) {
	if backend.DbConfidential == nil {
		return 0, false, loginVerificationRecord{}, errors.New("confidential database unavailable")
	}
	var id int
	var enabled bool
	var record loginVerificationRecord
	var method string
	err := backend.DbConfidential.QueryRow(`SELECT u.id, u.enabled IS TRUE, ur.password, ur.login_verification_method, COALESCE(ur.fixed_pin_hash,''), COALESCE(ur.totp_secret,''), COALESCE(ur.email,''), ur.authentication_generation, ur.api_only FROM restricted.users_restricted ur JOIN system_users u ON u.id=ur.id WHERE lower(ur.login_name)=lower($1)`, name).Scan(&id, &enabled, &record.PasswordHash, &method, &record.PINHash, &record.TOTPSecret, &record.Email, &record.AuthenticationGeneration, &record.APIOnly)
	if err != nil {
		return id, enabled, record, err
	}
	record.Method = loginVerificationMethod(method)
	return id, enabled, record, err
}
