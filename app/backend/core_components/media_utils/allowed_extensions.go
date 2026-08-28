// allowed_extensions.go
// Defines the list of allowed file extensions for media uploads. Provides validation helpers
// used by file upload handlers to reject unsupported file types.
// Exists to centralize upload safety policy for media-capable workflows.
package media_utils

// AllowedImageExtensions lists permitted image file extensions.
var AllowedImageExtensions = map[string]struct{}{
	".jpg":  {},
	".jpeg": {},
	".png":  {},
	".webp": {},
	".gif":  {},
}
