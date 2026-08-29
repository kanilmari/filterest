# Third-Party Notices

This generated inventory covers what the Filterest release distributes:
compiled Go modules, runtime npm packages, and third-party public assets.
Complete upstream legal and attribution document bytes are retained under
`THIRD_PARTY_LICENSES/` and bound here through its manifest.

## Candidate

- Filterest app version: `9.0.1`
- Database version: `9.6.7`
- Project source license: `GPL-2.0-or-later`
- Combined release-binary license: `GPL-3.0-or-later`
- License bundle manifest SHA-256: `c2e37b2bd3ae3db625b998aa6d16c128d7c48fb87f485023fb67fd90e4de9fd4`
- Go metadata source: `GOOS=linux GOARCH=amd64 CGO_ENABLED=1 go list -tags 'netgo osusergo' -deps metadata plus compiled vendored components and Go toolchain`
- npm metadata source: `package-lock.json production dependency graph`
- compiled Go modules listed: `17`
- compiled Go runtime or vendored components listed: `2`
- runtime npm packages listed: `0`
- third-party asset files listed: `80`
- source files containing third-party icon geometry: `2`
- first-party asset files recorded: `57`
- retained legal and attribution documents: `28`
- unresolved third-party rows: `0`

Development-only npm packages are referenced by `app/package-lock.json` but are
not copied into the source repository or release assets. Their installed packages
carry their own license files; they are therefore outside this distribution bundle.

Filterest's own source is GPL-2.0-or-later. Because the compiled release includes
Apache-2.0 components, the combined binaries are conveyed under GPL-3.0-or-later.

## Dependency License Summary

- `Apache-2.0`: 1
- `BSD-3-Clause`: 9
- `MIT`: 9

## Compiled Go Modules

| Module | Version | License | Scope | Retained documents |
| --- | --- | --- | --- | --- |
| github.com/anthropics/anthropic-sdk-go | v1.19.0 | MIT | release-binary | [`go-github.com-anthropics-anthropic-sdk-go-v1.19.0-faf6ca380dee-1-LICENSE`](THIRD_PARTY_LICENSES/go-github.com-anthropics-anthropic-sdk-go-v1.19.0-faf6ca380dee-1-LICENSE) |
| github.com/chai2010/webp | v1.4.0 | BSD-3-Clause | release-binary | [`go-github.com-chai2010-webp-v1.4.0-82ebf916fa54-1-LICENSE`](THIRD_PARTY_LICENSES/go-github.com-chai2010-webp-v1.4.0-82ebf916fa54-1-LICENSE) |
| github.com/disintegration/imaging | v1.6.2 | MIT | release-binary | [`go-github.com-disintegration-imaging-v1.6.2-a519053e1eec-1-LICENSE`](THIRD_PARTY_LICENSES/go-github.com-disintegration-imaging-v1.6.2-a519053e1eec-1-LICENSE) |
| github.com/google/uuid | v1.6.0 | BSD-3-Clause | release-binary | [`go-github.com-google-uuid-v1.6.0-0bbb5769d1c9-1-LICENSE`](THIRD_PARTY_LICENSES/go-github.com-google-uuid-v1.6.0-0bbb5769d1c9-1-LICENSE) |
| github.com/gorilla/securecookie | v1.1.2 | BSD-3-Clause | release-binary | [`go-github.com-gorilla-securecookie-v1.1.2-69e1cb231393-1-LICENSE`](THIRD_PARTY_LICENSES/go-github.com-gorilla-securecookie-v1.1.2-69e1cb231393-1-LICENSE) |
| github.com/gorilla/sessions | v1.4.0 | BSD-3-Clause | release-binary | [`go-github.com-gorilla-sessions-v1.4.0-86715e2102b4-1-LICENSE`](THIRD_PARTY_LICENSES/go-github.com-gorilla-sessions-v1.4.0-86715e2102b4-1-LICENSE) |
| github.com/joho/godotenv | v1.5.1 | MIT | release-binary | [`go-github.com-joho-godotenv-v1.5.1-d3250180717e-1-LICENCE`](THIRD_PARTY_LICENSES/go-github.com-joho-godotenv-v1.5.1-d3250180717e-1-LICENCE) |
| github.com/lib/pq | v1.10.9 | MIT | release-binary | [`go-github.com-lib-pq-v1.10.9-2f943f85f11a-1-LICENSE.md`](THIRD_PARTY_LICENSES/go-github.com-lib-pq-v1.10.9-2f943f85f11a-1-LICENSE.md) |
| github.com/pgvector/pgvector-go | v0.2.3 | MIT | release-binary | [`go-github.com-pgvector-pgvector-go-v0.2.3-02a5f6b317a4-1-LICENSE.txt`](THIRD_PARTY_LICENSES/go-github.com-pgvector-pgvector-go-v0.2.3-02a5f6b317a4-1-LICENSE.txt) |
| github.com/sashabaranov/go-openai | v1.36.1 | Apache-2.0 | release-binary | [`go-github.com-sashabaranov-go-openai-v1.36.1-389af7d4b752-1-LICENSE`](THIRD_PARTY_LICENSES/go-github.com-sashabaranov-go-openai-v1.36.1-389af7d4b752-1-LICENSE) |
| github.com/tidwall/gjson | v1.18.0 | MIT | release-binary | [`go-github.com-tidwall-gjson-v1.18.0-6d44db203e82-1-LICENSE`](THIRD_PARTY_LICENSES/go-github.com-tidwall-gjson-v1.18.0-6d44db203e82-1-LICENSE) |
| github.com/tidwall/match | v1.1.1 | MIT | release-binary | [`go-github.com-tidwall-match-v1.1.1-98ebc616cb44-1-LICENSE`](THIRD_PARTY_LICENSES/go-github.com-tidwall-match-v1.1.1-98ebc616cb44-1-LICENSE) |
| github.com/tidwall/pretty | v1.2.1 | MIT | release-binary | [`go-github.com-tidwall-pretty-v1.2.1-bbab3931ba1a-1-LICENSE`](THIRD_PARTY_LICENSES/go-github.com-tidwall-pretty-v1.2.1-bbab3931ba1a-1-LICENSE) |
| github.com/tidwall/sjson | v1.2.5 | MIT | release-binary | [`go-github.com-tidwall-sjson-v1.2.5-5bb783e1f317-1-LICENSE`](THIRD_PARTY_LICENSES/go-github.com-tidwall-sjson-v1.2.5-5bb783e1f317-1-LICENSE) |
| golang.org/x/crypto | v0.40.0 | BSD-3-Clause | release-binary | [`go-golang.org-x-crypto-v0.40.0-bb9f020887de-1-LICENSE`](THIRD_PARTY_LICENSES/go-golang.org-x-crypto-v0.40.0-bb9f020887de-1-LICENSE), [`go-golang.org-x-crypto-v0.40.0-bb9f020887de-2-PATENTS`](THIRD_PARTY_LICENSES/go-golang.org-x-crypto-v0.40.0-bb9f020887de-2-PATENTS) |
| golang.org/x/image | v0.43.0 | BSD-3-Clause | release-binary | [`go-golang.org-x-image-v0.43.0-225f7a2ce8c1-1-LICENSE`](THIRD_PARTY_LICENSES/go-golang.org-x-image-v0.43.0-225f7a2ce8c1-1-LICENSE), [`go-golang.org-x-image-v0.43.0-225f7a2ce8c1-2-PATENTS`](THIRD_PARTY_LICENSES/go-golang.org-x-image-v0.43.0-225f7a2ce8c1-2-PATENTS) |
| golang.org/x/sys | v0.34.0 | BSD-3-Clause | release-binary | [`go-golang.org-x-sys-v0.34.0-8ab87b41b5af-1-LICENSE`](THIRD_PARTY_LICENSES/go-golang.org-x-sys-v0.34.0-8ab87b41b5af-1-LICENSE), [`go-golang.org-x-sys-v0.34.0-8ab87b41b5af-2-PATENTS`](THIRD_PARTY_LICENSES/go-golang.org-x-sys-v0.34.0-8ab87b41b5af-2-PATENTS) |

## Go Runtime And Vendored Components

| Component | Version | License | Scope | Retained documents |
| --- | --- | --- | --- | --- |
| Go runtime and standard library | go1.26.5 | BSD-3-Clause | release-binary | [`go-toolchain-Go-runtime-and-standard-library-go1.26.5-666161183bab-1-LICENSE`](THIRD_PARTY_LICENSES/go-toolchain-Go-runtime-and-standard-library-go1.26.5-666161183bab-1-LICENSE), [`go-toolchain-Go-runtime-and-standard-library-go1.26.5-666161183bab-2-PATENTS`](THIRD_PARTY_LICENSES/go-toolchain-Go-runtime-and-standard-library-go1.26.5-666161183bab-2-PATENTS) |
| github.com/chai2010/webp:libwebp | 1.4.0 | BSD-3-Clause | release-binary | [`go-vendored-github.com-chai2010-webp-libwebp-1.4.0-4fb52bde06ae-1-COPYING`](THIRD_PARTY_LICENSES/go-vendored-github.com-chai2010-webp-libwebp-1.4.0-4fb52bde06ae-1-COPYING), [`go-vendored-github.com-chai2010-webp-libwebp-1.4.0-4fb52bde06ae-2-PATENTS`](THIRD_PARTY_LICENSES/go-vendored-github.com-chai2010-webp-libwebp-1.4.0-4fb52bde06ae-2-PATENTS), [`go-vendored-github.com-chai2010-webp-libwebp-1.4.0-4fb52bde06ae-3-AUTHORS`](THIRD_PARTY_LICENSES/go-vendored-github.com-chai2010-webp-libwebp-1.4.0-4fb52bde06ae-3-AUTHORS) |

## Runtime npm Packages

| Package | Version | License | Scope | Retained documents |
| --- | --- | --- | --- | --- |

## Third-Party Asset Components

| Component | Asset files | Embedded source files | License | Upstream | Retained documents |
| --- | ---: | ---: | --- | --- | --- |
| Google Material Icons and Symbols | 73 | 2 | Apache-2.0 | [source](https://github.com/google/material-design-icons) | [`asset-Google-Material-Icons-and-Symbols-eda288bd934a-1-material-symbols-Apache-2.0.txt`](THIRD_PARTY_LICENSES/asset-Google-Material-Icons-and-Symbols-eda288bd934a-1-material-symbols-Apache-2.0.txt), [`asset-Google-Material-Icons-and-Symbols-eda288bd934a-2-material-symbols-NOTICE.txt`](THIRD_PARTY_LICENSES/asset-Google-Material-Icons-and-Symbols-eda288bd934a-2-material-symbols-NOTICE.txt) |
| Lucide Icons | 7 | 0 | ISC | [source](https://github.com/lucide-icons/lucide) | [`asset-Lucide-Icons-b785a75e951a-1-lucide-LICENSE.txt`](THIRD_PARTY_LICENSES/asset-Lucide-Icons-b785a75e951a-1-lucide-LICENSE.txt) |

## Asset Provenance

Every third-party and first-party asset path and SHA-256 value is explicitly reviewed in
`app/server_tools/licenses/asset_provenance.json` and copied into the hash-bound release manifest.
Material Icons and Symbols are attributed to Google under Apache-2.0;
the selected Lucide icons are attributed to Lucide Icons and Contributors under ISC.
New or changed asset bytes fail generation until their provenance row is reviewed;
no file defaults automatically to first-party ownership.

## Unresolved Rows

None.
