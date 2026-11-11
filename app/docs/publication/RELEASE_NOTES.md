# Filterest 9.6.6

Release date: 2026-11-12. Contains the two commits since 9.6.5.

## Database and rollback

The database is unchanged at **9.13.6**, with the same minimum as 9.6.5.
The minimum and target are both **9.13.6**. No migration runs on the first
start after upgrading from 9.6.5. Rolling back to **9.6.5** keeps the same
database; no database restore is required for this application rollback.
Returning to 9.6.5 removes the option to restrict the field selector to
administrators, so guests and ordinary users see the selector again.

## Field-selector disclosure

A site can show the filter bar's **Select visible fields** section only to
administrators. When enabled, guests and ordinary users do not see the
section, including on the first render. Administrators retain the picker.
Every visitor still receives the effective fields for the current dataset
and view, even when the selector is hidden.

The option is off by default. An authenticated user with the existing
layout-save permission can enable it by sending only
`{"field_selector_admin_only":true}` to
`POST /api/filterbar-section-layout/save`, preserving other layout settings.
The public `GET /api/filterbar-section-layout` reports the value. Sending
`false` restores the usual selector for everyone.

The selector stays hidden while the layout is unavailable. With the option
on, it appears only after the field-set response confirms administrator
rights. With an unrestricted layout, the local field picker remains
available if the field-set request fails.
