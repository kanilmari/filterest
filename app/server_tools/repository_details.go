// Package repodetails supplies the build's immutable public repository identity.
// The Go runtime and lifecycle tools share repo_details.json as their source.
// Invalid metadata fails at startup rather than falling back to a previous owner.
package repodetails

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"regexp"
	"strings"
)

//go:embed repo_details.json
var embeddedDetails []byte

type Details struct {
	Host  string
	Owner string
	Repo  string
}

var hostPattern = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$`)
var ownerPattern = regexp.MustCompile(`^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$`)
var repoPattern = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,100}$`)
var current = mustParse(embeddedDetails)

func mustParse(data []byte) Details {
	details, err := Parse(data)
	if err != nil {
		panic("invalid embedded repository identity: " + err.Error())
	}
	return details
}

// Current returns a value copy; deployment files cannot change the binary's source.
func Current() Details { return current }

func Parse(data []byte) (Details, error) {
	fail := func() (Details, error) { return Details{}, fmt.Errorf("expected valid host, owner and repo") }
	if len(data) > 4096 {
		return fail()
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	start, err := decoder.Token()
	if err != nil || start != json.Delim('{') {
		return fail()
	}
	fields := map[string]string{}
	for decoder.More() {
		key, err := decoder.Token()
		name, ok := key.(string)
		if err != nil || !ok || (name != "host" && name != "owner" && name != "repo") {
			return fail()
		}
		if _, exists := fields[name]; exists {
			return fail()
		}
		var value string
		if decoder.Decode(&value) != nil {
			return fail()
		}
		fields[name] = value
	}
	if end, err := decoder.Token(); err != nil || end != json.Delim('}') {
		return fail()
	}
	if _, err := decoder.Token(); err != io.EOF {
		return fail()
	}
	details := Details{fields["host"], fields["owner"], fields["repo"]}
	if len(fields) != 3 || !hostPattern.MatchString(details.Host) || !ownerPattern.MatchString(details.Owner) ||
		!repoPattern.MatchString(details.Repo) || details.Repo == "." || details.Repo == ".." {
		return fail()
	}
	return details, nil
}

func (d Details) Repository() string { return d.Owner + "/" + d.Repo }
func (d Details) WebURL() string     { return "https://" + d.Host + "/" + d.Repository() }
func (d Details) GitURL() string     { return d.WebURL() + ".git" }
func (d Details) APIURL() string {
	base := "https://" + d.Host + "/api/v3"
	if d.Host == "github.com" {
		base = "https://api.github.com"
	}
	return base + "/repos/" + d.Repository()
}
func (d Details) LatestReleaseAPIURL() string { return d.APIURL() + "/releases/latest" }
func (d Details) ReleaseURL(tag string) string {
	return d.WebURL() + "/releases/tag/" + url.PathEscape(tag)
}
func (d Details) DownloadURL(tag string) string {
	return d.WebURL() + "/releases/download/" + url.PathEscape(tag)
}

// ValidatedReleaseURL only accepts this build's repository, with no credentials,
// custom port, encoded path or dot segments masquerading as another repository.
func (d Details) ValidatedReleaseURL(value string) string {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsed.Scheme != "https" || parsed.Host != d.Host || parsed.User != nil ||
		parsed.RawQuery != "" || parsed.Fragment != "" || parsed.RawPath != "" {
		return ""
	}
	prefix := "/" + d.Repository() + "/releases/"
	if !strings.HasPrefix(parsed.Path, prefix) || parsed.Path == prefix {
		return ""
	}
	for _, part := range strings.Split(parsed.Path, "/") {
		if part == "." || part == ".." {
			return ""
		}
	}
	return parsed.String()
}
