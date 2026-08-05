# dtt_asset_linking

This module is the isolated home for asset-linking behavior in Easelect.
It exists to keep generic asset capability logic out of legacy table-specific media paths.

Design boundary:
- generic asset capability logic lives here
- media-specific profiles live under `profiles/`

Current profile scaffolds:
- `profiles/image/` owns the live image-first defaults
- `profiles/attachment/` holds the first non-image scaffold for pdf/document/archive rollout

Current live contracts:
- image and attachment routes register directly from `dtt_asset_linking`
- attachment status/enable/disable/remove routes now register directly from `dtt_asset_linking`
- profile-specific relation lookups are required so image and attachment configs never overwrite each other
