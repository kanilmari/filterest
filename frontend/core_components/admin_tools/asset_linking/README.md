# asset_linking admin module

This folder is the isolated frontend home for asset-linking administration.

Intended responsibilities:
- asset capability view state
- shared asset-linking admin rendering
- profile-specific editors such as image-only controls

Current live state:
- the `asset_linking` admin tab renders from `asset_linking_view.js`
- the same view also exposes the first live attachment capability section
- keep adding new asset-profile UI here instead of reviving removed image-only compatibility entrypoints
