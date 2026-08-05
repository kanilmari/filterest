// image_profile.go
// Defines the image-specific profile defaults for the future asset_linking module.
// Bridges generic asset config and image-only concerns like cached_image and thumbnail generation.
// Exists to keep image behavior first-class without forcing all asset kinds through image rules.
package imageprofile

// DefaultAllowedTypes lists the current web image extensions supported by the image profile.
var DefaultAllowedTypes = []string{
	"jpg",
	"jpeg",
	"jfif",
	"bmp",
	"png",
	"webp",
	"avif",
	"gif",
	"ico",
	"tif",
	"tiff",
	"heic",
	"heif",
}
