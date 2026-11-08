// Verify build-bound repository addresses and strict release-link ownership.
// These are in-memory identity fixtures; no GitHub requests or runtime files.
package repodetails

import (
	"strings"
	"testing"
)

func TestRepositoryAddressesFollowOwnerHostAndRepo(t *testing.T) {
	for _, host := range []string{"github.com", "code.example.test"} {
		details, err := Parse([]byte(`{"host":"` + host + `","owner":"new-owner","repo":"a-project"}`))
		if err != nil {
			t.Fatal(err)
		}
		web := "https://" + host + "/new-owner/a-project"
		api := "https://" + host + "/api/v3/repos/new-owner/a-project"
		if host == "github.com" {
			api = "https://api.github.com/repos/new-owner/a-project"
		}
		if details.WebURL() != web || details.GitURL() != web+".git" || details.APIURL() != api ||
			details.LatestReleaseAPIURL() != api+"/releases/latest" ||
			details.ReleaseURL("v1.2.3") != web+"/releases/tag/v1.2.3" ||
			details.DownloadURL("v1.2.3") != web+"/releases/download/v1.2.3" {
			t.Fatalf("addresses did not follow identity: %#v", details)
		}
		valid := details.ReleaseURL("v1.2.3")
		if details.ValidatedReleaseURL(valid) != valid {
			t.Fatal("valid link rejected")
		}
		for _, bad := range []string{
			strings.Replace(valid, "new-owner", "old-owner", 1),
			strings.Replace(valid, "a-project", "other-project", 1),
			strings.Replace(valid, host, host+".attacker.test", 1),
			strings.Replace(valid, host, host+":443", 1),
			strings.Replace(valid, host, "someone@"+host, 1),
			strings.Replace(valid, "https:", "http:", 1),
			web + "/releases/../../another/repo", web + "/releases/%2e%2e/another", valid + "?redirect=x",
		} {
			if details.ValidatedReleaseURL(bad) != "" {
				t.Fatalf("unowned link accepted: %q", bad)
			}
		}
	}
}

func TestRepositoryMetadataRejectsAmbiguousOrInvalidInputs(t *testing.T) {
	for _, value := range []string{
		`null`, `[]`, `{}`, `{"host":"github.com","owner":"a","repo":"r","extra":1}`,
		`{"host":"github.com","owner":"a","owner":"b","repo":"r"}`,
		`{"host":"github.com:443","owner":"a","repo":"r"}`,
		`{"host":"https://github.com","owner":"a","repo":"r"}`,
		`{"host":"github.com","owner":"a/b","repo":"r"}`,
		`{"host":"github.com","owner":true,"repo":"r"}`,
		`{"host":"github.com","owner":"a","repo":".."}`,
		`{"host":"github.com","owner":"a","repo":"r"} {}`,
	} {
		if _, err := Parse([]byte(value)); err == nil {
			t.Fatalf("accepted invalid identity %s", value)
		}
	}
}

func TestCurrentIdentityIsEmbeddedAndReturnedByValue(t *testing.T) {
	expected, err := Parse(embeddedDetails)
	if err != nil {
		t.Fatal(err)
	}
	copy := Current()
	copy.Owner = "runtime-change"
	if Current() != expected || Current() == copy {
		t.Fatal("build identity was mutable")
	}
}
