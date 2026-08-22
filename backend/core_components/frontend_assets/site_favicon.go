// site_favicon.go
// Resolves a versioned, hand-pixelled browser icon from the administrator-owned site name.
// Keeps the first browser paint branded without relying on JavaScript or font rendering.
package frontendassets

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"unicode"
)

const defaultSiteFaviconPath = "/frontend/icons/site_favicons/site-initial-f-v1-16.png"

var safeSiteFaviconFilename = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,127}\.png$`)

// SiteFaviconPath resolves the favicon using the administrator's explicit file
// first, then a multi-word initial such as ES, then the first site-name letter.
// Only existing PNG basenames inside the favicon asset directory are accepted;
// missing assets and unsupported scripts retain the Filterest F.
func SiteFaviconPath(frontendDir string, siteName string, configuredFile string) string {
	if path := existingSiteFaviconPath(frontendDir, strings.TrimSpace(configuredFile)); path != "" {
		return path
	}

	initials := siteNameInitials(siteName)
	if len(initials) > 1 {
		if path := existingSiteFaviconPath(frontendDir, "site-initial-"+initials+"-v1-16.png"); path != "" {
			return path
		}
	}
	if len(initials) > 0 {
		if path := existingSiteFaviconPath(frontendDir, "site-initial-"+initials[:1]+"-v1-16.png"); path != "" {
			return path
		}
	}

	return defaultSiteFaviconPath
}

func existingSiteFaviconPath(frontendDir string, fileName string) string {
	if fileName == "" || !safeSiteFaviconFilename.MatchString(fileName) || filepath.Base(fileName) != fileName {
		return ""
	}
	diskPath := filepath.Join(frontendDir, "icons", "site_favicons", fileName)
	if info, err := os.Lstat(diskPath); err == nil && info.Mode().IsRegular() {
		return "/frontend/icons/site_favicons/" + fileName
	}
	return ""
}

func siteNameInitials(siteName string) string {
	var initials strings.Builder
	for _, word := range strings.Fields(strings.TrimSpace(siteName)) {
		for _, value := range word {
			if !unicode.IsLetter(value) {
				continue
			}
			initial := unicode.ToLower(value)
			if initial < 'a' || initial > 'z' {
				break
			}
			initials.WriteRune(initial)
			break
		}
	}
	return initials.String()
}
