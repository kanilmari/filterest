# Third-Party Notices

This generated inventory covers what the Filterest release distributes:
compiled Go modules across shipped binaries, runtime npm packages, build-tool
code present in the production browser bundle, third-party public assets,
and the reviewed rights basis for project-original public assets.
Reviewed upstream legal and attribution document bytes are retained under
`THIRD_PARTY_LICENSES/` and bound here through its manifest.

## Candidate

- Filterest app version: `9.2.2`
- Database version: `9.7.0`
- Project source license: `GPL-2.0-or-later`
- Combined release-binary license: `GPL-3.0-or-later`
- License bundle manifest SHA-256: `389d50048b0c14b2b9d0aa3af25cf4c821dc4b7aadb34a12df497e9c4a0393cf`
- Go metadata source: `GOOS=linux GOARCH=amd64 CGO_ENABLED=1 go list -deps metadata for filterest[linux-release]:. tags=netgo osusergo; filterest[container]:.; filterest-admin-recovery[container]:./server_tools/admin_credential_recovery, plus compiled vendored components and Go toolchain`
- npm metadata source: `package-lock.json production dependency graph`
- browser bundle metadata source: `app/server_tools/licenses/browser_bundle_provenance.json matched against app/package-lock.json and app/frontend/dist/*.js`
- compiled Go modules listed: `18`
- compiled Go runtime or vendored components listed: `2`
- runtime npm packages listed: `0`
- browser bundle build components listed: `3`
- third-party asset files listed: `80`
- source files containing third-party icon geometry: `6`
- first-party asset files recorded: `47`
- retained legal and attribution documents: `34`
- unresolved third-party rows: `0`

Most development-only npm packages referenced by `app/package-lock.json` are not
copied into release assets. Build tools whose generated helper code is present in
the production browser bundle are listed explicitly below with retained licenses.

Filterest's own source is GPL-2.0-or-later. Because the compiled release includes
Apache-2.0 components, the combined binaries are conveyed under GPL-3.0-or-later.

## Dependency License Summary

- `Apache-2.0`: 1
- `BSD-3-Clause`: 10
- `MIT`: 12

## Compiled Go Modules Across Release Binaries

| Module | Version | License | Scope | Binaries | Retained documents |
| --- | --- | --- | --- | --- | --- |
| github.com/anthropics/anthropic-sdk-go | v1.19.0 | MIT | release-binary | filterest | [`go-github.com-anthropics-anthropic-sdk-go-v1.19.0-faf6ca380dee-1-LICENSE`](THIRD_PARTY_LICENSES/go-github.com-anthropics-anthropic-sdk-go-v1.19.0-faf6ca380dee-1-LICENSE) |
| github.com/chai2010/webp | v1.4.0 | BSD-3-Clause | release-binary | filterest | [`go-github.com-chai2010-webp-v1.4.0-82ebf916fa54-1-LICENSE`](THIRD_PARTY_LICENSES/go-github.com-chai2010-webp-v1.4.0-82ebf916fa54-1-LICENSE) |
| github.com/disintegration/imaging | v1.6.2 | MIT | release-binary | filterest | [`go-github.com-disintegration-imaging-v1.6.2-a519053e1eec-1-LICENSE`](THIRD_PARTY_LICENSES/go-github.com-disintegration-imaging-v1.6.2-a519053e1eec-1-LICENSE) |
| github.com/google/uuid | v1.6.0 | BSD-3-Clause | release-binary | filterest | [`go-github.com-google-uuid-v1.6.0-0bbb5769d1c9-1-LICENSE`](THIRD_PARTY_LICENSES/go-github.com-google-uuid-v1.6.0-0bbb5769d1c9-1-LICENSE) |
| github.com/gorilla/securecookie | v1.1.2 | BSD-3-Clause | release-binary | filterest | [`go-github.com-gorilla-securecookie-v1.1.2-69e1cb231393-1-LICENSE`](THIRD_PARTY_LICENSES/go-github.com-gorilla-securecookie-v1.1.2-69e1cb231393-1-LICENSE) |
| github.com/gorilla/sessions | v1.4.0 | BSD-3-Clause | release-binary | filterest | [`go-github.com-gorilla-sessions-v1.4.0-86715e2102b4-1-LICENSE`](THIRD_PARTY_LICENSES/go-github.com-gorilla-sessions-v1.4.0-86715e2102b4-1-LICENSE) |
| github.com/joho/godotenv | v1.5.1 | MIT | release-binary | filterest | [`go-github.com-joho-godotenv-v1.5.1-d3250180717e-1-LICENCE`](THIRD_PARTY_LICENSES/go-github.com-joho-godotenv-v1.5.1-d3250180717e-1-LICENCE) |
| github.com/lib/pq | v1.10.9 | MIT | release-binary | filterest, filterest-admin-recovery | [`go-github.com-lib-pq-v1.10.9-2f943f85f11a-1-LICENSE.md`](THIRD_PARTY_LICENSES/go-github.com-lib-pq-v1.10.9-2f943f85f11a-1-LICENSE.md) |
| github.com/pgvector/pgvector-go | v0.2.3 | MIT | release-binary | filterest | [`go-github.com-pgvector-pgvector-go-v0.2.3-02a5f6b317a4-1-LICENSE.txt`](THIRD_PARTY_LICENSES/go-github.com-pgvector-pgvector-go-v0.2.3-02a5f6b317a4-1-LICENSE.txt) |
| github.com/sashabaranov/go-openai | v1.36.1 | Apache-2.0 | release-binary | filterest | [`go-github.com-sashabaranov-go-openai-v1.36.1-389af7d4b752-1-LICENSE`](THIRD_PARTY_LICENSES/go-github.com-sashabaranov-go-openai-v1.36.1-389af7d4b752-1-LICENSE) |
| github.com/tidwall/gjson | v1.18.0 | MIT | release-binary | filterest | [`go-github.com-tidwall-gjson-v1.18.0-6d44db203e82-1-LICENSE`](THIRD_PARTY_LICENSES/go-github.com-tidwall-gjson-v1.18.0-6d44db203e82-1-LICENSE) |
| github.com/tidwall/match | v1.1.1 | MIT | release-binary | filterest | [`go-github.com-tidwall-match-v1.1.1-98ebc616cb44-1-LICENSE`](THIRD_PARTY_LICENSES/go-github.com-tidwall-match-v1.1.1-98ebc616cb44-1-LICENSE) |
| github.com/tidwall/pretty | v1.2.1 | MIT | release-binary | filterest | [`go-github.com-tidwall-pretty-v1.2.1-bbab3931ba1a-1-LICENSE`](THIRD_PARTY_LICENSES/go-github.com-tidwall-pretty-v1.2.1-bbab3931ba1a-1-LICENSE) |
| github.com/tidwall/sjson | v1.2.5 | MIT | release-binary | filterest | [`go-github.com-tidwall-sjson-v1.2.5-5bb783e1f317-1-LICENSE`](THIRD_PARTY_LICENSES/go-github.com-tidwall-sjson-v1.2.5-5bb783e1f317-1-LICENSE) |
| golang.org/x/crypto | v0.40.0 | BSD-3-Clause | release-binary | filterest, filterest-admin-recovery | [`go-golang.org-x-crypto-v0.40.0-bb9f020887de-1-LICENSE`](THIRD_PARTY_LICENSES/go-golang.org-x-crypto-v0.40.0-bb9f020887de-1-LICENSE), [`go-golang.org-x-crypto-v0.40.0-bb9f020887de-2-PATENTS`](THIRD_PARTY_LICENSES/go-golang.org-x-crypto-v0.40.0-bb9f020887de-2-PATENTS) |
| golang.org/x/image | v0.43.0 | BSD-3-Clause | release-binary | filterest | [`go-golang.org-x-image-v0.43.0-225f7a2ce8c1-1-LICENSE`](THIRD_PARTY_LICENSES/go-golang.org-x-image-v0.43.0-225f7a2ce8c1-1-LICENSE), [`go-golang.org-x-image-v0.43.0-225f7a2ce8c1-2-PATENTS`](THIRD_PARTY_LICENSES/go-golang.org-x-image-v0.43.0-225f7a2ce8c1-2-PATENTS) |
| golang.org/x/sys | v0.34.0 | BSD-3-Clause | release-binary | filterest, filterest-admin-recovery | [`go-golang.org-x-sys-v0.34.0-8ab87b41b5af-1-LICENSE`](THIRD_PARTY_LICENSES/go-golang.org-x-sys-v0.34.0-8ab87b41b5af-1-LICENSE), [`go-golang.org-x-sys-v0.34.0-8ab87b41b5af-2-PATENTS`](THIRD_PARTY_LICENSES/go-golang.org-x-sys-v0.34.0-8ab87b41b5af-2-PATENTS) |
| golang.org/x/term | v0.33.0 | BSD-3-Clause | release-binary | filterest-admin-recovery | [`go-golang.org-x-term-v0.33.0-8820e08dfc6e-1-LICENSE`](THIRD_PARTY_LICENSES/go-golang.org-x-term-v0.33.0-8820e08dfc6e-1-LICENSE), [`go-golang.org-x-term-v0.33.0-8820e08dfc6e-2-PATENTS`](THIRD_PARTY_LICENSES/go-golang.org-x-term-v0.33.0-8820e08dfc6e-2-PATENTS) |

## Go Runtime And Vendored Components

| Component | Version | License | Scope | Binaries | Retained documents |
| --- | --- | --- | --- | --- | --- |
| Go runtime and standard library | go1.26.5 | BSD-3-Clause | release-binary | filterest, filterest-admin-recovery | [`go-toolchain-Go-runtime-and-standard-library-go1.26.5-666161183bab-1-LICENSE`](THIRD_PARTY_LICENSES/go-toolchain-Go-runtime-and-standard-library-go1.26.5-666161183bab-1-LICENSE), [`go-toolchain-Go-runtime-and-standard-library-go1.26.5-666161183bab-2-PATENTS`](THIRD_PARTY_LICENSES/go-toolchain-Go-runtime-and-standard-library-go1.26.5-666161183bab-2-PATENTS) |
| github.com/chai2010/webp:libwebp | 1.4.0 | BSD-3-Clause | release-binary | filterest | [`go-vendored-github.com-chai2010-webp-libwebp-1.4.0-4fb52bde06ae-1-COPYING`](THIRD_PARTY_LICENSES/go-vendored-github.com-chai2010-webp-libwebp-1.4.0-4fb52bde06ae-1-COPYING), [`go-vendored-github.com-chai2010-webp-libwebp-1.4.0-4fb52bde06ae-2-PATENTS`](THIRD_PARTY_LICENSES/go-vendored-github.com-chai2010-webp-libwebp-1.4.0-4fb52bde06ae-2-PATENTS), [`go-vendored-github.com-chai2010-webp-libwebp-1.4.0-4fb52bde06ae-3-AUTHORS`](THIRD_PARTY_LICENSES/go-vendored-github.com-chai2010-webp-libwebp-1.4.0-4fb52bde06ae-3-AUTHORS) |

## Runtime npm Packages

| Package | Version | License | Scope | Retained documents |
| --- | --- | --- | --- | --- |

## Production Browser Bundle Build Components

| Component | Version | License | Scope | Upstream | Retained documents |
| --- | --- | --- | --- | --- | --- |
| esbuild | 0.25.4 | MIT | browser-production-bundle | [source](https://github.com/evanw/esbuild) | [`npm-build-esbuild-0.25.4-95852f084dcf-1-esbuild-0.25.4-LICENSE.md`](THIRD_PARTY_LICENSES/npm-build-esbuild-0.25.4-95852f084dcf-1-esbuild-0.25.4-LICENSE.md) |
| rollup | 4.60.4 | MIT | browser-production-bundle | [source](https://github.com/rollup/rollup) | [`npm-build-rollup-4.60.4-18d2319ddf3e-1-rollup-4.60.4-LICENSE.md`](THIRD_PARTY_LICENSES/npm-build-rollup-4.60.4-18d2319ddf3e-1-rollup-4.60.4-LICENSE.md) |
| vite | 6.4.3 | MIT | browser-production-bundle | [source](https://github.com/vitejs/vite) | [`npm-build-vite-6.4.3-4fbd07552a3a-1-vite-6.4.3-LICENSE.md`](THIRD_PARTY_LICENSES/npm-build-vite-6.4.3-4fbd07552a3a-1-vite-6.4.3-LICENSE.md) |

## Third-Party Asset Components

| Component | Asset files | Embedded source files | License | Upstream | Retained documents |
| --- | ---: | ---: | --- | --- | --- |
| Google Material Icons and Symbols | 73 | 2 | Apache-2.0 | [source](https://github.com/google/material-design-icons) | [`asset-Google-Material-Icons-and-Symbols-eda288bd934a-1-material-symbols-Apache-2.0.txt`](THIRD_PARTY_LICENSES/asset-Google-Material-Icons-and-Symbols-eda288bd934a-1-material-symbols-Apache-2.0.txt), [`asset-Google-Material-Icons-and-Symbols-eda288bd934a-2-material-symbols-NOTICE.txt`](THIRD_PARTY_LICENSES/asset-Google-Material-Icons-and-Symbols-eda288bd934a-2-material-symbols-NOTICE.txt) |
| Heroicons / Tailwind Labs | 0 | 1 | MIT | [source](https://github.com/tailwindlabs/heroicons) | [`asset-Heroicons-Tailwind-Labs-dac4d65f3957-1-heroicons-LICENSE.txt`](THIRD_PARTY_LICENSES/asset-Heroicons-Tailwind-Labs-dac4d65f3957-1-heroicons-LICENSE.txt) |
| Lucide Icons | 7 | 3 | ISC | [source](https://github.com/lucide-icons/lucide) | [`asset-Lucide-Icons-b785a75e951a-1-lucide-LICENSE.txt`](THIRD_PARTY_LICENSES/asset-Lucide-Icons-b785a75e951a-1-lucide-LICENSE.txt) |

## First-Party Asset Provenance

| Component | Asset files | Author | Rights holder | Publication-rights basis | License |
| --- | ---: | --- | --- | --- | --- |
| Filterest brand and fallback images | 10 | Filterest project contributors | Filterest project contributors | Maintained as original Filterest project assets under the repository-wide GPL-2.0-or-later grant; the human project owner confirmed the first-party classification and approved publication on 2026-08-30. | GPL-2.0-or-later |
| Filterest demo placeholder images | 15 | Filterest human project owner | Filterest human project owner | The author created these neutral text placeholders in Microsoft Paint without third-party source imagery and approved their redistribution with Filterest under GPL-2.0-or-later on 2026-08-30; no separate attribution is requested. | GPL-2.0-or-later |
| Filterest original interface SVGs | 22 | Filterest project contributors | Filterest project contributors | Maintained as original Filterest project assets under the repository-wide GPL-2.0-or-later grant; the human project owner confirmed the first-party classification and approved publication on 2026-08-30. | GPL-2.0-or-later |

## Asset Provenance

Every third-party and first-party asset path and SHA-256 value is explicitly reviewed in
`app/server_tools/licenses/asset_provenance.json` and copied into the hash-bound release manifest.
Every first-party group also records its author, rights holder, publication-rights
basis, and owner attestation; a generic first-party label is not accepted.
Material Icons and Symbols are attributed to Google under Apache-2.0;
the selected Lucide icons are attributed to Lucide Icons and Contributors under ISC.
Additional embedded interface geometry without a documented first-party rights basis
is conservatively covered by the retained Lucide/Feather terms without asserting exact upstream bytes.
The embedded Heroicons wrench-screwdriver geometry is attributed to Tailwind Labs under MIT.
New or changed asset bytes fail generation until their provenance row is reviewed;
static SVG path, points, primitive markup, and encoded SVG data in maintained source
also fail generation unless their complete source file has a reviewed hash-bound row;
no file defaults automatically to first-party ownership.

## Unresolved Rows

None.
