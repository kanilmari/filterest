// Pins the backfill to the full administrator chain without a request transaction.
package pipeline

import "testing"

func TestImageDimensionsBackfillHasAdministratorBatchProfile(t *testing.T) {
	profile, exists := RouteProfiles["missing_media_check.AdminImageDimensionsBackfillHandler"]
	if !exists || !profile.AdminOnly || !profile.SkipStages["transaction"] {
		t.Fatal("backfill lost its explicit administrator batch profile")
	}
	for _, stage := range []string{"auth", "csrf", "fingerprint", "device_id", "access_control", "admin_check", "audit"} {
		if profile.SkipStages[stage] {
			t.Fatal("backfill skips security/audit stage", stage)
		}
	}
}
