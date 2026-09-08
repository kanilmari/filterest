// view_field_settings_view.js
// Exposes the canonical administrator field-settings page entry point.
// Bridges the clear route name with the established field-assignment editor.
// Exists so old bookmarks and imports remain valid while navigation uses settings.
export { generate_view_field_assignments_view as generate_view_field_settings_view } from "./view_field_assignments_view.js";
