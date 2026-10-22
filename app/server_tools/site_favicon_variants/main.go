// main.go: site_favicon_variants tool
// Replicates maintained 16px favicons and swaps eligible two-colour art for dark Home.
// Connects unpremultiplied source pixels to browser-downsampled site identity assets.
// Uses only Go's standard library; run from the repository root with:
// go run app/server_tools/site_favicon_variants/main.go
package main

import (
	"fmt"
	"image"
	"image/color"
	"image/png"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

func main() {
	files, err := filepath.Glob("app/frontend/icons/site_favicons/*-16.png")
	if err != nil || len(files) == 0 {
		fmt.Fprintln(os.Stderr, "NOT completed: no source favicons found; run from the repository root.")
		os.Exit(1)
	}
	for index, source := range files {
		fmt.Printf("%d/%d Replicate %s\n", index+1, len(files), source)
		if err := replicate(source); err != nil {
			fmt.Fprintf(os.Stderr, "NOT completed: %d/%d icons succeeded; failed: %s: %v\n", index, len(files), source, err)
			os.Exit(1)
		}
	}
	fmt.Printf("Completed: %d/%d icons succeeded.\n", len(files), len(files))
}

func replicate(source string) error {
	file, err := os.Open(source)
	if err != nil {
		return err
	}
	original, err := png.Decode(file)
	file.Close()
	if err != nil {
		return err
	}
	if original.Bounds().Size() != image.Pt(16, 16) {
		return fmt.Errorf("source must be 16x16, got %v", original.Bounds())
	}
	stem := strings.TrimSuffix(source, "-16.png")
	if err := writePNG(stem+"-128.png", replicatePixels(original, false)); err != nil {
		return err
	}
	darkPath := stem + "-128-dark-v1.png"
	dark, ok := swapTwoColours(original)
	if !ok {
		if err := os.Remove(darkPath); err != nil && !os.IsNotExist(err) {
			return err
		}
		return nil
	}
	return writePNG(darkPath, replicatePixels(dark, true))
}

func replicatePixels(original image.Image, preserveDepth bool) image.Image {
	bounds := original.Bounds()
	if source, ok := original.(*image.NRGBA64); preserveDepth && ok {
		variant := image.NewNRGBA64(image.Rect(0, 0, bounds.Dx()*8, bounds.Dy()*8))
		for y := 0; y < variant.Bounds().Dy(); y++ {
			for x := 0; x < variant.Bounds().Dx(); x++ {
				variant.SetNRGBA64(x, y, source.NRGBA64At(bounds.Min.X+x/8, bounds.Min.Y+y/8))
			}
		}
		return variant
	}
	variant := image.NewNRGBA(image.Rect(0, 0, bounds.Dx()*8, bounds.Dy()*8))
	for y := 0; y < variant.Bounds().Dy(); y++ {
		for x := 0; x < variant.Bounds().Dx(); x++ {
			// NRGBA keeps unpremultiplied 8-bit colour and alpha, including hidden RGB.
			pixel := color.NRGBAModel.Convert(original.At(bounds.Min.X+x/8, bounds.Min.Y+y/8)).(color.NRGBA)
			variant.SetNRGBA(x, y, pixel)
		}
	}
	return variant
}

// swapTwoColours is pure. Opaque RGB frequencies must identify two unambiguous
// bases: each outranks every mixture, and together they cover >=75% of opaque
// pixels. This deliberately rejects gradients/ties rather than guessing endpoints.
// Every visible pixel must lie on their RGB segment within one 8-bit step/channel
// (257 steps for 16-bit PNGs). Alpha never weights colour; zero-alpha RGB is ignored.
// Mixed pixels must touch both opaque bases in their eight-neighbourhood: wider
// ramps are gradients/ambiguous art, not a confidently identified antialiased edge.
// Twin bases closer than this tolerance are ambiguous and rejected as well.
func swapTwoColours(original image.Image) (image.Image, bool) {
	const tolerance = 257.0 // One 8-bit step, in the common 16-bit working space.
	const opaqueAlpha = 65535
	highDepth := false
	switch original.(type) {
	case *image.NRGBA64, *image.RGBA64, *image.Gray16, *image.Alpha16:
		highDepth = true
	}
	// Keep all source precision before looking for bases or mixtures. In particular,
	// a 16-bit fractional alpha must never round to zero during classification.
	pixel := func(x, y int) color.NRGBA64 {
		return color.NRGBA64Model.Convert(original.At(x, y)).(color.NRGBA64)
	}
	counts := map[color.NRGBA64]int{}
	bounds := original.Bounds()
	opaque := 0
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			c := pixel(x, y)
			if c.A == opaqueAlpha {
				counts[c]++
				opaque++
			}
		}
	}
	if len(counts) < 2 {
		return nil, false
	}
	colours := make([]color.NRGBA64, 0, len(counts))
	for c := range counts {
		colours = append(colours, c)
	}
	sort.Slice(colours, func(i, j int) bool {
		if counts[colours[i]] != counts[colours[j]] {
			return counts[colours[i]] > counts[colours[j]]
		}
		a, b := colours[i], colours[j]
		return uint64(a.R)<<32|uint64(a.G)<<16|uint64(a.B) < uint64(b.R)<<32|uint64(b.G)<<16|uint64(b.B)
	})
	a, b := colours[0], colours[1]
	if len(colours) > 2 && (counts[b] <= counts[colours[2]] || (counts[a]+counts[b])*4 < opaque*3) {
		return nil, false
	}
	touchesBases := func(x, y int) bool {
		var touchesA, touchesB bool
		for ny := y - 1; ny <= y+1; ny++ {
			for nx := x - 1; nx <= x+1; nx++ {
				if !image.Pt(nx, ny).In(bounds) {
					continue
				}
				c := pixel(nx, ny)
				touchesA = touchesA || c == a
				touchesB = touchesB || c == b
			}
		}
		return touchesA && touchesB
	}
	av := [3]float64{float64(a.R), float64(a.G), float64(a.B)}
	bv := [3]float64{float64(b.R), float64(b.G), float64(b.B)}
	var distance, span float64
	for i := range av {
		d := bv[i] - av[i]
		distance += d * d
		span = math.Max(span, math.Abs(d))
	}
	if span <= 2*tolerance {
		return nil, false
	}
	var result image.Image
	var setPixel func(int, int, color.NRGBA64)
	if highDepth {
		img := image.NewNRGBA64(bounds)
		result = img
		setPixel = img.SetNRGBA64
	} else {
		img := image.NewNRGBA(bounds)
		result = img
		channel8 := func(c uint16) uint8 { return uint8((uint32(c) + 128) / 257) }
		setPixel = func(x, y int, c color.NRGBA64) {
			img.SetNRGBA(x, y, color.NRGBA{channel8(c.R), channel8(c.G), channel8(c.B), channel8(c.A)})
		}
	}
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			c := pixel(x, y)
			if c.A == 0 {
				setPixel(x, y, c)
				continue
			}
			isBase := c.R == a.R && c.G == a.G && c.B == a.B || c.R == b.R && c.G == b.G && c.B == b.B
			if !isBase && !touchesBases(x, y) {
				return nil, false
			}
			cv := [3]float64{float64(c.R), float64(c.G), float64(c.B)}
			var projection float64
			for i := range av {
				projection += (cv[i] - av[i]) * (bv[i] - av[i])
			}
			t := math.Max(0, math.Min(1, projection/distance))
			var swapped [3]uint16
			for i := range av {
				if math.Abs(cv[i]-((1-t)*av[i]+t*bv[i])) > tolerance {
					return nil, false
				}
				// Exchange A/B, preserving the same mixture t: never an RGB invert.
				swapped[i] = uint16(math.Round(t*av[i] + (1-t)*bv[i]))
			}
			setPixel(x, y, color.NRGBA64{swapped[0], swapped[1], swapped[2], c.A})
		}
	}
	return result, true
}

func writePNG(path string, variant image.Image) error {
	output, err := os.Create(path)
	if err != nil {
		return err
	}
	encodeErr := png.Encode(output, variant)
	closeErr := output.Close()
	if encodeErr != nil {
		return encodeErr
	}
	return closeErr
}
