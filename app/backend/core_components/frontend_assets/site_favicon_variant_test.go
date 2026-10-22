// site_favicon_variant_test.go
// Proves every source icon has an exact 8x variant and both head sizes are offered.
// Connects maintained PNG bytes and page templates to safe server resolution.
// Prevents asset drift, lost alpha and unsafe or missing-variant regressions.
package frontendassets

import (
	"bytes"
	"html/template"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

func TestSiteFaviconVariantsExactlyReplicateEverySource(t *testing.T) {
	assetDir := filepath.Join("..", "..", "..", "frontend", "icons", "site_favicons")
	sources, err := filepath.Glob(filepath.Join(assetDir, "*-16.png"))
	if err != nil || len(sources) == 0 {
		t.Fatalf("source icons: %v, %v", sources, err)
	}
	variants, err := filepath.Glob(filepath.Join(assetDir, "*-128.png"))
	if err != nil || len(variants) != len(sources) {
		t.Fatalf("variants = %d, sources = %d: %v", len(variants), len(sources), err)
	}
	for _, source := range sources {
		t.Run(filepath.Base(source), func(t *testing.T) {
			original := readFaviconPNG(t, source)
			variant := readFaviconPNG(t, strings.TrimSuffix(source, "-16.png")+"-128.png")
			if original.Bounds().Size() != image.Pt(16, 16) || variant.Bounds().Size() != image.Pt(128, 128) {
				t.Fatalf("wrong dimensions: %v -> %v", original.Bounds(), variant.Bounds())
			}
			for y := 0; y < 128; y++ {
				for x := 0; x < 128; x++ {
					want := color.NRGBAModel.Convert(original.At(x/8, y/8)).(color.NRGBA)
					got := color.NRGBAModel.Convert(variant.At(x, y)).(color.NRGBA)
					if got != want {
						t.Fatalf("pixel %d,%d = %v, want %v (including alpha)", x, y, got, want)
					}
				}
			}
		})
	}
}

func TestSiteFaviconVariantResolutionPreservesFallbackAndSafety(t *testing.T) {
	frontendDir := t.TempDir()
	directory := filepath.Join(frontendDir, "icons", "site_favicons")
	if err := os.MkdirAll(directory, 0o755); err != nil {
		t.Fatal(err)
	}
	const original = "/frontend/icons/site_favicons/site-initial-f-v1-16.png"
	const variant = "/frontend/icons/site_favicons/site-initial-f-v1-128.png"
	if got := SiteFavicon128Path(frontendDir, original); got != original {
		t.Fatalf("missing variant = %q", got)
	}
	if err := os.WriteFile(filepath.Join(directory, filepath.Base(variant)), []byte("png"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := NewSiteFaviconData(frontendDir, "Unknown", "../invalid.png"); got.FaviconPath != original || got.Favicon128Path != variant {
		t.Fatalf("resolved links = %+v", got)
	}
	for _, path := range []string{"/frontend/icons/site_favicons/../site-initial-f-v1-16.png", "/outside/site-initial-f-v1-16.png", original + "?query", "/frontend/icons/site_favicons/custom.png"} {
		if got := SiteFavicon128Path(frontendDir, path); got != path {
			t.Fatalf("unsafe/unsupported input %q became %q", path, got)
		}
	}
	if err := os.Remove(filepath.Join(directory, filepath.Base(variant))); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("target.png", filepath.Join(directory, filepath.Base(variant))); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "target.png"), []byte("png"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := SiteFavicon128Path(frontendDir, original); got != original {
		t.Fatalf("symlink variant = %q", got)
	}
}

func TestSiteFaviconHeadTemplatesOfferBothSizes(t *testing.T) {
	frontendDir := filepath.Join("..", "..", "..", "frontend")
	links := NewSiteFaviconData(frontendDir, "Fintravel", "site-fintravel-ft-v1-16.png")
	for _, file := range []string{"index.html", "templates/login.html", "templates/first_run_admin.html"} {
		t.Run(file, func(t *testing.T) {
			content, err := os.ReadFile(filepath.Join(frontendDir, file))
			if err != nil {
				t.Fatal(err)
			}
			tags := regexp.MustCompile(`<link\s+rel="icon"[^>]+>`).FindAllString(string(content), -1)
			if len(tags) != 2 {
				t.Fatalf("icon links = %d, want 2", len(tags))
			}
			tpl := template.Must(template.New("head").Parse(strings.Join(tags, "\n")))
			var rendered bytes.Buffer
			if err := tpl.Execute(&rendered, links); err != nil {
				t.Fatal(err)
			}
			for index, size := range []string{"16x16", "128x128"} {
				tag := strings.Split(rendered.String(), "\n")[index]
				path := links.FaviconPath
				if index == 1 {
					path = links.Favicon128Path
				}
				for _, attribute := range []string{`type="image/png"`, `sizes="` + size + `"`, `href="` + path + `"`} {
					if !strings.Contains(tag, attribute) {
						t.Fatalf("%s missing %s", tag, attribute)
					}
				}
				if file == "index.html" && index == 1 && !strings.Contains(tag, `data-home-dark-href="/frontend/icons/site_favicons/site-fintravel-ft-v1-128-dark-v1.png"`) {
					t.Fatalf("Home dark metadata missing: %s", tag)
				}
			}
		})
	}
}

func TestHomeDarkFaviconResolutionUsesSafeRegularSiblingOrNormal(t *testing.T) {
	root := t.TempDir()
	directory := filepath.Join(root, "icons", "site_favicons")
	if err := os.MkdirAll(directory, 0700); err != nil {
		t.Fatal(err)
	}
	const stem = "site-initial-f-v1"
	const prefix = "/frontend/icons/site_favicons/"
	for _, suffix := range []string{"-16.png", "-128.png"} {
		if err := os.WriteFile(filepath.Join(directory, stem+suffix), []byte("png"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	// Rendering the field exercises the shell's metadata contract without a second selector.
	tpl := template.Must(template.New("dark").Parse("{{.Favicon128DarkPath}}"))
	assertPath := func(configured, want string) {
		t.Helper()
		var rendered bytes.Buffer
		if err := tpl.Execute(&rendered, NewSiteFaviconData(root, "Filterest", configured)); err != nil {
			t.Fatal(err)
		}
		if rendered.String() != want {
			t.Fatalf("dark path %q, want %q", rendered.String(), want)
		}
	}
	dark := filepath.Join(directory, stem+"-128-dark-v1.png")
	assertPath("", prefix+stem+"-128.png")
	if err := os.WriteFile(dark, []byte("dark"), 0600); err != nil {
		t.Fatal(err)
	}
	assertPath(stem+"-16.png", prefix+stem+"-128-dark-v1.png")
	for _, unsafe := range []string{"../outside-16.png", "/outside-16.png", "bad?name-16.png"} {
		assertPath(unsafe, prefix+stem+"-128-dark-v1.png")
	}
	if err := os.Remove(dark); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(stem+"-128.png", dark); err != nil {
		t.Fatal(err)
	}
	assertPath("", prefix+stem+"-128.png")
	if err := os.Remove(dark); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(dark, 0700); err != nil {
		t.Fatal(err)
	}
	assertPath("", prefix+stem+"-128.png")
	if err := os.Remove(filepath.Join(directory, stem+"-128.png")); err != nil {
		t.Fatal(err)
	}
	assertPath("", prefix+stem+"-16.png")
}

func readFaviconPNG(t *testing.T, path string) image.Image {
	t.Helper()
	file, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	value, err := png.Decode(file)
	if err != nil {
		t.Fatal(err)
	}
	return value
}

func TestCommittedDarkPixelsExchangeMaintainedSourceColours(t *testing.T) {
	blue := color.NRGBA{55, 83, 121, 255}
	white := color.NRGBA{255, 255, 255, 255}
	sources, err := filepath.Glob("../../../frontend/icons/site_favicons/*-16.png")
	if err != nil || len(sources) != 5 {
		t.Fatalf("maintained sources: %v %v", sources, err)
	}
	for _, source := range sources {
		original := readFaviconPNG(t, source)
		dark := readFaviconPNG(t, strings.TrimSuffix(source, "-16.png")+"-128-dark-v1.png")
		if dark.Bounds().Size() != image.Pt(128, 128) {
			t.Fatal(dark.Bounds())
		}
		for y := 0; y < 128; y++ {
			for x := 0; x < 128; x++ {
				want := faviconColourAt(original, x/8, y/8)
				if want.A != 0 {
					switch want {
					case blue:
						want = white
					case white:
						want = blue
					default:
						t.Fatalf("unexpected maintained colour %v", want)
					}
				}
				got := faviconColourAt(dark, x, y)
				if got.A != want.A || want.A != 0 && got != want {
					t.Fatalf("%s %d,%d: %v != %v", source, x, y, got, want)
				}
			}
		}
	}
}

func faviconColourAt(img image.Image, x, y int) color.NRGBA {
	return color.NRGBAModel.Convert(img.At(x, y)).(color.NRGBA)
}
