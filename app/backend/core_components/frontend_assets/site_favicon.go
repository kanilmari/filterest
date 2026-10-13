// site_favicon.go
// Resolves the configured site favicon and its optional lossless display variant.
// Connects safe maintained filenames to shell, login and first-run head metadata.
// Preserves administrator selection, site-initial fallbacks and regular-file checks.
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

// SiteFaviconData supplies both head links from one resolved administrator/site choice.
type SiteFaviconData struct {
	FaviconPath    string
	Favicon128Path string
}

// NewSiteFaviconData preserves 16px resolution and derives its optional display variant.
func NewSiteFaviconData(frontendDir, siteName, configuredFile string) SiteFaviconData {
	path := SiteFaviconPath(frontendDir, siteName, configuredFile)
	return SiteFaviconData{FaviconPath: path, Favicon128Path: SiteFavicon128Path(frontendDir, path)}
}

// SiteFavicon128Path derives only a sibling of the resolved 16px path. Missing,
// non-regular or unsafe variants retain the original; selection rules stay in SiteFaviconPath.
func SiteFavicon128Path(frontendDir, resolvedPath string) string {
	const prefix = "/frontend/icons/site_favicons/"
	if !strings.HasPrefix(resolvedPath, prefix) || !strings.HasSuffix(resolvedPath, "-16.png") {
		return resolvedPath
	}
	fileName := strings.TrimSuffix(strings.TrimPrefix(resolvedPath, prefix), "-16.png") + "-128.png"
	if path := existingSiteFaviconPath(frontendDir, fileName); path != "" {
		return path
	}
	return resolvedPath
}

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
