// main_test.go
// Proves offline two-colour swaps, alpha handling and rejection cleanup.
// Connects decoded source pixels to both generated display variants.
// Keeps normal 8x replication exact through palette and true-colour inputs.
package main

import (
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

var blue = color.NRGBA{55, 83, 121, 255}
var white = color.NRGBA{255, 255, 255, 255}

func twoColourIcon() *image.NRGBA {
	img := image.NewNRGBA(image.Rect(0, 0, 16, 16))
	for y := 0; y < 16; y++ {
		for x := 0; x < 16; x++ {
			pixel := blue
			if x >= 8 {
				pixel = white
			}
			img.SetNRGBA(x, y, pixel)
		}
	}
	return img
}

func writeIcon(t *testing.T, name string, img image.Image) {
	t.Helper()
	f, err := os.Create(name)
	if err != nil {
		t.Fatal(err)
	}
	err = png.Encode(f, img)
	closeErr := f.Close()
	if err != nil {
		t.Fatal(err)
	}
	if closeErr != nil {
		t.Fatal(closeErr)
	}
}

func readIcon(t *testing.T, name string) image.Image {
	t.Helper()
	f, err := os.Open(name)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	img, err := png.Decode(f)
	if err != nil {
		t.Fatal(err)
	}
	return img
}

func pixelAt(img image.Image, x, y int) color.NRGBA {
	return color.NRGBAModel.Convert(img.At(x, y)).(color.NRGBA)
}

func TestReplicateSwapsEndpointsEdgesAndAlphaWithoutChangingNormal(t *testing.T) {
	for _, kind := range []string{"nrgba", "rgba", "palette"} {
		t.Run(kind, func(t *testing.T) {
			img := twoColourIcon()
			// 25% white, rounded to the nearest byte; both opaque and fractional edges.
			for i, alpha := range []uint8{255, 128, 1, 254} {
				img.SetNRGBA(7, i, color.NRGBA{105, 126, 155, alpha})
			}
			img.SetNRGBA(4, 0, color.NRGBA{245, 13, 81, 0})
			img.SetNRGBA(7, 6, color.NRGBA{105, 127, 155, 128}) // One-byte antialias rounding.
			var input image.Image = img
			if kind == "rgba" {
				// Premultiplied 8-bit RGBA cannot represent this hue at alpha=1.
				// NRGBA/palette cases above exercise that exact fractional alpha.
				for y := 0; y < 4; y++ {
					img.SetNRGBA(7, y, color.NRGBA{105, 126, 155, 255})
				}
				img.SetNRGBA(5, 0, color.NRGBA{255, 255, 255, 128})
				img.SetNRGBA(7, 6, color.NRGBA{105, 126, 155, 255})
				rgba := image.NewRGBA(img.Bounds())
				for y := 0; y < 16; y++ {
					for x := 0; x < 16; x++ {
						rgba.Set(x, y, img.At(x, y))
					}
				}
				input = rgba
			}
			if kind == "palette" {
				palette := color.Palette{blue, white}
				for y := 0; y < 4; y++ {
					palette = append(palette, img.At(7, y))
				}
				palette = append(palette, img.At(4, 0), img.At(7, 6))
				indexed := image.NewPaletted(img.Bounds(), palette)
				for y := 0; y < 16; y++ {
					for x := 0; x < 16; x++ {
						indexed.Set(x, y, img.At(x, y))
					}
				}
				input = indexed
			}
			source := filepath.Join(t.TempDir(), "icon-16.png")
			writeIcon(t, source, input)
			decoded := readIcon(t, source)
			if err := replicate(source); err != nil {
				t.Fatal(err)
			}
			normal := readIcon(t, strings.TrimSuffix(source, "-16.png")+"-128.png")
			dark := readIcon(t, strings.TrimSuffix(source, "-16.png")+"-128-dark-v1.png")
			if dark.Bounds().Size() != image.Pt(128, 128) {
				t.Fatal(dark.Bounds())
			}
			for y := 0; y < 128; y++ {
				for x := 0; x < 128; x++ {
					original := pixelAt(decoded, x/8, y/8)
					if got := pixelAt(normal, x, y); got != original {
						t.Fatalf("normal %d,%d: %v != %v", x, y, got, original)
					}
					got := pixelAt(dark, x, y)
					if got.A != original.A {
						t.Fatalf("alpha %d,%d: %v != %v", x, y, got, original)
					}
					if original.A == 0 {
						continue
					} // Hidden RGB never selects a base colour.
					if original == blue && got != white || original == white && got != blue {
						t.Fatalf("endpoint %v -> %v", original, got)
					}
					// Independent channel complement around the two endpoints, never 255-C.
					for i, channel := range []uint8{got.R, got.G, got.B} {
						want := []int{310 - int(original.R), 338 - int(original.G), 376 - int(original.B)}[i]
						if difference := int(channel) - want; difference < -1 || difference > 1 {
							t.Fatalf("mixture %v -> %v", original, got)
						}
					}
				}
			}
		})
	}
}

func TestRejectedArtHasNoDarkFileAndRemovesStaleSibling(t *testing.T) {
	for _, kind := range []string{"third colour", "gradient", "dominant endpoints gradient", "single colour", "ambiguous", "near bases", "outside tolerance", "no opaque endpoints", "transparent"} {
		t.Run(kind, func(t *testing.T) {
			img := twoColourIcon()
			for y := 0; y < 16; y++ {
				for x := 0; x < 16; x++ {
					switch kind {
					case "third colour":
						img.SetNRGBA(0, 0, color.NRGBA{255, 0, 0, 255})
					case "gradient":
						img.SetNRGBA(x, y, color.NRGBA{uint8(x * 17), uint8(x * 17), uint8(x * 17), 255})
					case "dominant endpoints gradient":
						c := blue
						if x >= 9 {
							c = white
						}
						if x >= 6 && x < 9 {
							c = []color.NRGBA{{105, 126, 155, 255}, {155, 169, 188, 255}, {205, 212, 222, 255}}[x-6]
						}
						img.SetNRGBA(x, y, c)
					case "single colour":
						img.SetNRGBA(x, y, blue)
					case "ambiguous":
						if x%3 == 0 {
							img.SetNRGBA(x, y, color.NRGBA{155, 169, 188, 255})
						}
					case "near bases":
						img.SetNRGBA(x, y, color.NRGBA{55 + uint8(x%2), 83, 121, 255})
					case "outside tolerance":
						img.SetNRGBA(7, 0, color.NRGBA{105, 129, 155, 128})
					case "no opaque endpoints":
						c := img.NRGBAAt(x, y)
						c.A = 128
						img.SetNRGBA(x, y, c)
					case "transparent":
						img.SetNRGBA(x, y, color.NRGBA{uint8(x), uint8(y), 85, 0})
					}
				}
			}
			source := filepath.Join(t.TempDir(), "rejected-16.png")
			dark := strings.TrimSuffix(source, "-16.png") + "-128-dark-v1.png"
			writeIcon(t, source, img)
			for _, stale := range []bool{false, true} {
				if stale {
					if err := os.WriteFile(dark, []byte("stale"), 0600); err != nil {
						t.Fatal(err)
					}
				}
				if err := replicate(source); err != nil {
					t.Fatal(err)
				}
				if _, err := os.Lstat(dark); !os.IsNotExist(err) {
					t.Fatalf("rejected %s retained dark file: %v", kind, err)
				}
				readIcon(t, strings.TrimSuffix(source, "-16.png")+"-128.png")
			}
		})
	}
}

func TestSixteenBitPNGKeepsFractionalAlphaAndUnpremultipliedMixtures(t *testing.T) {
	img := image.NewNRGBA64(image.Rect(0, 0, 16, 16))
	a := color.NRGBA64{55 * 257, 83 * 257, 121 * 257, 65535}
	b := color.NRGBA64{65535, 65535, 65535, 65535}
	for y := 0; y < 16; y++ {
		for x := 0; x < 16; x++ {
			c := a
			if x >= 8 {
				c = b
			}
			img.SetNRGBA64(x, y, c)
		}
	}
	img.SetNRGBA64(7, 0, color.NRGBA64{105 * 257, 126 * 257, 154*257 + 128, 0x1234})
	img.SetNRGBA64(7, 1, color.NRGBA64{105 * 257, 126 * 257, 154*257 + 128, 1})
	img.SetNRGBA64(2, 0, color.NRGBA64{65535, 20, 42000, 0})
	source := filepath.Join(t.TempDir(), "deep-16.png")
	writeIcon(t, source, img)
	if err := replicate(source); err != nil {
		t.Fatal(err)
	}
	dark := readIcon(t, strings.TrimSuffix(source, "-16.png")+"-128-dark-v1.png")
	for y := 0; y < 128; y++ {
		for x := 0; x < 128; x++ {
			c := img.NRGBA64At(x/8, y/8)
			got := color.NRGBA64Model.Convert(dark.At(x, y)).(color.NRGBA64)
			if got.A != c.A {
				t.Fatalf("16-bit alpha %d,%d: %v != %v", x, y, got, c)
			}
			if c == a && got != b || c == b && got != a {
				t.Fatalf("16-bit endpoint %v -> %v", c, got)
			}
			if c.A == 0 {
				continue
			}
			for i, channel := range []uint16{got.R, got.G, got.B} {
				want := []int{int(a.R) + int(b.R) - int(c.R), int(a.G) + int(b.G) - int(c.G), int(a.B) + int(b.B) - int(c.B)}[i]
				if difference := int(channel) - want; difference < -1 || difference > 1 {
					t.Fatalf("16-bit mixture %v -> %v", c, got)
				}
			}
		}
	}
}
