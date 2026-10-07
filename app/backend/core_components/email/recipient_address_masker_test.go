// recipient_address_masker_test.go
// Checks the shared diagnostic mask for ordinary, Unicode and invalid addresses.
// Connects operator selection and OTP logging without disclosing local parts.
// Malformed input is never repeated in diagnostic output.
package email

import "testing"

func TestMaskRecipientAddress(t *testing.T) {
	for _, test := range []struct{ address, want string }{{"owner@example.invalid", "o***@example.invalid"}, {"äiti@example.invalid", "ä***@example.invalid"}, {"bad-address", "(unavailable)"}, {"a@b@c", "(unavailable)"}} {
		if got := MaskRecipientAddress(test.address); got != test.want {
			t.Fatalf("masked address=%q want=%q", got, test.want)
		}
	}
}
