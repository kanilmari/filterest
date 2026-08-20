# Third-Party Notices

This file is generated for the current Filterest public-release candidate.
It is a dependency and bundled-asset inventory for release review; it is
not legal advice and still needs human/project approval before publication.

## Candidate

- Filterest app version: `8.36.3`
- Database version: `9.2.3`
- Go metadata source: `go list metadata with go mod download cache`
- npm metadata source: `package-lock.json with installed package.json license metadata`
- Go modules listed: `96`
- npm packages listed: `441`
- bundled asset files listed: `136`
- dependency rows still requiring license review: `0`

## Review Notes

- Verify this file against the exact generated commit that will be reviewed
  for publication.
- Check every `review-required` row before public release.
- Keep trademark, project license, and contribution-term approval separate
  from this dependency inventory.
- If dependency versions or bundled assets change, regenerate this file from
  the final exported tree before approval.

## License Summary

### Go Modules

- `Apache-2.0`: 37
- `BSD-style`: 32
- `ISC`: 1
- `MIT`: 25
- `MPL-2.0`: 1

### npm Packages

- `(MIT OR CC0-1.0)`: 1
- `0BSD`: 1
- `Apache-2.0`: 41
- `BSD-2-Clause`: 9
- `BSD-3-Clause`: 12
- `BlueOak-1.0.0`: 5
- `CC0-1.0`: 1
- `ISC`: 22
- `MIT`: 342
- `MIT-0`: 3
- `MPL-2.0`: 3
- `Python-2.0`: 1

### Bundled Assets

- `.ico`: 1
- `.jpg`: 22
- `.png`: 14
- `.svg`: 99

## Go Modules

| Module | Version | License hint | Evidence |
| --- | --- | --- | --- |
| ariga.io/atlas | v0.19.1-0.20240203083654-5948b60a8e43 | Apache-2.0 | LICENSE |
| cloud.google.com/go/auth | v0.7.2 | Apache-2.0 | LICENSE |
| cloud.google.com/go/auth/oauth2adapt | v0.2.3 | Apache-2.0 | LICENSE |
| cloud.google.com/go/compute/metadata | v0.5.0 | Apache-2.0 | LICENSE |
| entgo.io/ent | v0.13.1 | Apache-2.0 | LICENSE |
| github.com/agext/levenshtein | v1.2.1 | Apache-2.0 | LICENSE |
| github.com/ankane/disco-go | v0.1.0 | MIT | LICENSE.txt |
| github.com/anthropics/anthropic-sdk-go | v1.19.0 | MIT | LICENSE |
| github.com/apparentlymart/go-textseg/v13 | v13.0.0 | Apache-2.0 | LICENSE |
| github.com/aws/aws-sdk-go-v2 | v1.30.3 | Apache-2.0 | LICENSE.txt |
| github.com/aws/aws-sdk-go-v2/aws/protocol/eventstream | v1.6.3 | Apache-2.0 | LICENSE.txt |
| github.com/aws/aws-sdk-go-v2/config | v1.27.27 | Apache-2.0 | LICENSE.txt |
| github.com/aws/aws-sdk-go-v2/credentials | v1.17.27 | Apache-2.0 | LICENSE.txt |
| github.com/aws/aws-sdk-go-v2/feature/ec2/imds | v1.16.11 | Apache-2.0 | LICENSE.txt |
| github.com/aws/aws-sdk-go-v2/internal/configsources | v1.3.15 | Apache-2.0 | LICENSE.txt |
| github.com/aws/aws-sdk-go-v2/internal/endpoints/v2 | v2.6.15 | Apache-2.0 | LICENSE.txt |
| github.com/aws/aws-sdk-go-v2/internal/ini | v1.8.0 | Apache-2.0 | LICENSE.txt |
| github.com/aws/aws-sdk-go-v2/service/internal/accept-encoding | v1.11.3 | Apache-2.0 | LICENSE.txt |
| github.com/aws/aws-sdk-go-v2/service/internal/presigned-url | v1.11.17 | Apache-2.0 | LICENSE.txt |
| github.com/aws/aws-sdk-go-v2/service/sso | v1.22.4 | Apache-2.0 | LICENSE.txt |
| github.com/aws/aws-sdk-go-v2/service/ssooidc | v1.26.4 | Apache-2.0 | LICENSE.txt |
| github.com/aws/aws-sdk-go-v2/service/sts | v1.30.3 | Apache-2.0 | LICENSE.txt |
| github.com/aws/smithy-go | v1.20.3 | Apache-2.0 | LICENSE |
| github.com/chai2010/webp | v1.4.0 | BSD-style | LICENSE |
| github.com/davecgh/go-spew | v1.1.1 | ISC | LICENSE |
| github.com/disintegration/imaging | v1.6.2 | MIT | LICENSE |
| github.com/felixge/httpsnoop | v1.0.4 | MIT | LICENSE.txt |
| github.com/go-logr/logr | v1.4.2 | Apache-2.0 | LICENSE |
| github.com/go-logr/stdr | v1.2.2 | Apache-2.0 | LICENSE |
| github.com/go-openapi/inflect | v0.19.0 | MIT | LICENCE |
| github.com/go-pg/pg/v10 | v10.11.0 | BSD-style | LICENSE |
| github.com/go-pg/zerochecker | v0.2.0 | BSD-style | LICENSE |
| github.com/golang/groupcache | v0.0.0-20210331224755-41bb18bfe9da | Apache-2.0 | LICENSE |
| github.com/golang/protobuf | v1.5.4 | BSD-style | LICENSE |
| github.com/google/go-cmp | v0.6.0 | BSD-style | LICENSE |
| github.com/google/gofuzz | v1.2.0 | Apache-2.0 | LICENSE |
| github.com/google/s2a-go | v0.1.7 | Apache-2.0 | LICENSE.md |
| github.com/google/uuid | v1.6.0 | BSD-style | LICENSE |
| github.com/googleapis/enterprise-certificate-proxy | v0.3.2 | Apache-2.0 | LICENSE |
| github.com/gorilla/securecookie | v1.1.2 | BSD-style | LICENSE |
| github.com/gorilla/sessions | v1.4.0 | BSD-style | LICENSE |
| github.com/hashicorp/hcl/v2 | v2.13.0 | MPL-2.0 | LICENSE |
| github.com/jackc/pgpassfile | v1.0.0 | MIT | LICENSE |
| github.com/jackc/pgservicefile | v0.0.0-20240606120523-5a60cdf6a761 | MIT | LICENSE |
| github.com/jackc/pgx/v5 | v5.6.0 | MIT | LICENSE |
| github.com/jackc/puddle/v2 | v2.2.1 | MIT | LICENSE |
| github.com/jinzhu/inflection | v1.0.0 | MIT | LICENSE |
| github.com/jinzhu/now | v1.1.5 | MIT | License |
| github.com/jmoiron/sqlx | v1.3.5 | MIT | LICENSE |
| github.com/joho/godotenv | v1.5.1 | MIT | LICENCE |
| github.com/lib/pq | v1.10.9 | MIT | LICENSE.md |
| github.com/mitchellh/go-wordwrap | v0.0.0-20150314170334-ad45545899c7 | MIT | LICENSE.md |
| github.com/pgvector/pgvector-go | v0.2.3 | MIT | LICENSE.txt |
| github.com/pmezard/go-difflib | v1.0.0 | BSD-style | LICENSE |
| github.com/rogpeppe/go-internal | v1.9.0 | BSD-style | LICENSE |
| github.com/sashabaranov/go-openai | v1.36.1 | Apache-2.0 | LICENSE |
| github.com/stretchr/testify | v1.8.4 | MIT | LICENSE |
| github.com/tidwall/gjson | v1.18.0 | MIT | LICENSE |
| github.com/tidwall/match | v1.1.1 | MIT | LICENSE |
| github.com/tidwall/pretty | v1.2.1 | MIT | LICENSE |
| github.com/tidwall/sjson | v1.2.5 | MIT | LICENSE |
| github.com/tmthrgd/go-hex | v0.0.0-20190904060850-447a3041c3bc | BSD-style | LICENSE |
| github.com/uptrace/bun | v1.1.12 | BSD-style | LICENSE |
| github.com/uptrace/bun/dialect/pgdialect | v1.1.12 | BSD-style | LICENSE |
| github.com/uptrace/bun/driver/pgdriver | v1.1.12 | BSD-style | LICENSE |
| github.com/vmihailenco/bufpool | v0.1.11 | MIT | LICENSE |
| github.com/vmihailenco/msgpack/v5 | v5.3.5 | BSD-style | LICENSE |
| github.com/vmihailenco/tagparser | v0.1.2 | BSD-style | LICENSE |
| github.com/vmihailenco/tagparser/v2 | v2.0.0 | BSD-style | LICENSE |
| github.com/zclconf/go-cty | v1.8.0 | MIT | LICENSE |
| go.opencensus.io | v0.24.0 | Apache-2.0 | LICENSE |
| go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc | v0.49.0 | Apache-2.0 | LICENSE |
| go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp | v0.49.0 | Apache-2.0 | LICENSE |
| go.opentelemetry.io/otel | v1.24.0 | Apache-2.0 | LICENSE |
| go.opentelemetry.io/otel/metric | v1.24.0 | Apache-2.0 | LICENSE |
| go.opentelemetry.io/otel/trace | v1.24.0 | Apache-2.0 | LICENSE |
| golang.org/x/crypto | v0.40.0 | BSD-style | LICENSE |
| golang.org/x/image | v0.43.0 | BSD-style | LICENSE |
| golang.org/x/mod | v0.36.0 | BSD-style | LICENSE |
| golang.org/x/net | v0.41.0 | BSD-style | LICENSE |
| golang.org/x/oauth2 | v0.30.0 | BSD-style | LICENSE |
| golang.org/x/sync | v0.21.0 | BSD-style | LICENSE |
| golang.org/x/sys | v0.34.0 | BSD-style | LICENSE |
| golang.org/x/term | v0.33.0 | BSD-style | LICENSE |
| golang.org/x/text | v0.38.0 | BSD-style | LICENSE |
| golang.org/x/time | v0.5.0 | BSD-style | LICENSE |
| golang.org/x/tools | v0.45.0 | BSD-style | LICENSE |
| golang.org/x/xerrors | v0.0.0-20200804184101-5ec99f83aff1 | BSD-style | LICENSE |
| google.golang.org/api | v0.189.0 | BSD-style | LICENSE |
| google.golang.org/genproto/googleapis/rpc | v0.0.0-20240722135656-d784300faade | Apache-2.0 | LICENSE |
| google.golang.org/grpc | v1.64.1 | Apache-2.0 | LICENSE |
| google.golang.org/protobuf | v1.34.2 | BSD-style | LICENSE |
| gopkg.in/yaml.v3 | v3.0.1 | Apache-2.0 | LICENSE |
| gorm.io/driver/postgres | v1.5.4 | MIT | License |
| gorm.io/gorm | v1.25.5 | MIT | LICENSE |
| mellium.im/sasl | v0.3.1 | BSD-style | LICENSE |

## npm Packages

| Package | Version | License | Evidence |
| --- | --- | --- | --- |
| @apm-js-collab/code-transformer | 0.18.1 | Apache-2.0 | node_modules/@apm-js-collab/code-transformer (package-lock.json) |
| @apm-js-collab/code-transformer-bundler-plugins | 0.7.1 | MIT | node_modules/@apm-js-collab/code-transformer-bundler-plugins (package-lock.json) |
| @apm-js-collab/tracing-hooks | 0.13.0 | Apache-2.0 | node_modules/@apm-js-collab/tracing-hooks (package-lock.json) |
| @asamuzakjp/css-color | 5.0.1 | MIT | node_modules/@asamuzakjp/css-color (package-lock.json) |
| @asamuzakjp/dom-selector | 7.0.4 | MIT | node_modules/@asamuzakjp/dom-selector (package-lock.json) |
| @asamuzakjp/nwsapi | 2.3.9 | MIT | node_modules/@asamuzakjp/nwsapi (package-lock.json) |
| @axe-core/playwright | 4.11.3 | MPL-2.0 | node_modules/@axe-core/playwright (package-lock.json) |
| @babel/code-frame | 7.26.2 | MIT | node_modules/@babel/code-frame (package-lock.json) |
| @babel/helper-validator-identifier | 7.25.9 | MIT | node_modules/@babel/helper-validator-identifier (package-lock.json) |
| @bramus/specificity | 2.4.2 | MIT | node_modules/@bramus/specificity (package-lock.json) |
| @csstools/color-helpers | 6.0.2 | MIT-0 | node_modules/@csstools/color-helpers (package-lock.json) |
| @csstools/css-calc | 3.1.1 | MIT | node_modules/@asamuzakjp/css-color/node_modules/@csstools/css-calc (package-lock.json) |
| @csstools/css-color-parser | 4.0.2 | MIT | node_modules/@asamuzakjp/css-color/node_modules/@csstools/css-color-parser (package-lock.json) |
| @csstools/css-parser-algorithms | 3.0.4 | MIT | node_modules/@csstools/css-parser-algorithms (package-lock.json) |
| @csstools/css-parser-algorithms | 4.0.0 | MIT | node_modules/@asamuzakjp/css-color/node_modules/@csstools/css-parser-algorithms (package-lock.json) |
| @csstools/css-syntax-patches-for-csstree | 1.1.1 | MIT-0 | node_modules/@csstools/css-syntax-patches-for-csstree (package-lock.json) |
| @csstools/css-tokenizer | 3.0.3 | MIT | node_modules/@csstools/css-tokenizer (package-lock.json) |
| @csstools/css-tokenizer | 4.0.0 | MIT | node_modules/@asamuzakjp/css-color/node_modules/@csstools/css-tokenizer (package-lock.json) |
| @csstools/media-query-list-parser | 4.0.2 | MIT | node_modules/@csstools/media-query-list-parser (package-lock.json) |
| @csstools/selector-specificity | 5.0.0 | MIT-0 | node_modules/@csstools/selector-specificity (package-lock.json) |
| @dual-bundle/import-meta-resolve | 4.1.0 | MIT | node_modules/@dual-bundle/import-meta-resolve (package-lock.json) |
| @emnapi/core | 1.10.0 | MIT | node_modules/@emnapi/core (package-lock.json) |
| @emnapi/runtime | 1.10.0 | MIT | node_modules/@emnapi/runtime (package-lock.json) |
| @emnapi/wasi-threads | 1.2.1 | MIT | node_modules/@emnapi/wasi-threads (package-lock.json) |
| @esbuild/aix-ppc64 | 0.25.4 | MIT | node_modules/@esbuild/aix-ppc64 (package-lock.json) |
| @esbuild/android-arm | 0.25.4 | MIT | node_modules/@esbuild/android-arm (package-lock.json) |
| @esbuild/android-arm64 | 0.25.4 | MIT | node_modules/@esbuild/android-arm64 (package-lock.json) |
| @esbuild/android-x64 | 0.25.4 | MIT | node_modules/@esbuild/android-x64 (package-lock.json) |
| @esbuild/darwin-arm64 | 0.25.4 | MIT | node_modules/@esbuild/darwin-arm64 (package-lock.json) |
| @esbuild/darwin-x64 | 0.25.4 | MIT | node_modules/@esbuild/darwin-x64 (package-lock.json) |
| @esbuild/freebsd-arm64 | 0.25.4 | MIT | node_modules/@esbuild/freebsd-arm64 (package-lock.json) |
| @esbuild/freebsd-x64 | 0.25.4 | MIT | node_modules/@esbuild/freebsd-x64 (package-lock.json) |
| @esbuild/linux-arm | 0.25.4 | MIT | node_modules/@esbuild/linux-arm (package-lock.json) |
| @esbuild/linux-arm64 | 0.25.4 | MIT | node_modules/@esbuild/linux-arm64 (package-lock.json) |
| @esbuild/linux-ia32 | 0.25.4 | MIT | node_modules/@esbuild/linux-ia32 (package-lock.json) |
| @esbuild/linux-loong64 | 0.25.4 | MIT | node_modules/@esbuild/linux-loong64 (package-lock.json) |
| @esbuild/linux-mips64el | 0.25.4 | MIT | node_modules/@esbuild/linux-mips64el (package-lock.json) |
| @esbuild/linux-ppc64 | 0.25.4 | MIT | node_modules/@esbuild/linux-ppc64 (package-lock.json) |
| @esbuild/linux-riscv64 | 0.25.4 | MIT | node_modules/@esbuild/linux-riscv64 (package-lock.json) |
| @esbuild/linux-s390x | 0.25.4 | MIT | node_modules/@esbuild/linux-s390x (package-lock.json) |
| @esbuild/linux-x64 | 0.25.4 | MIT | node_modules/@esbuild/linux-x64 (package-lock.json) |
| @esbuild/netbsd-arm64 | 0.25.4 | MIT | node_modules/@esbuild/netbsd-arm64 (package-lock.json) |
| @esbuild/netbsd-x64 | 0.25.4 | MIT | node_modules/@esbuild/netbsd-x64 (package-lock.json) |
| @esbuild/openbsd-arm64 | 0.25.4 | MIT | node_modules/@esbuild/openbsd-arm64 (package-lock.json) |
| @esbuild/openbsd-x64 | 0.25.4 | MIT | node_modules/@esbuild/openbsd-x64 (package-lock.json) |
| @esbuild/sunos-x64 | 0.25.4 | MIT | node_modules/@esbuild/sunos-x64 (package-lock.json) |
| @esbuild/win32-arm64 | 0.25.4 | MIT | node_modules/@esbuild/win32-arm64 (package-lock.json) |
| @esbuild/win32-ia32 | 0.25.4 | MIT | node_modules/@esbuild/win32-ia32 (package-lock.json) |
| @esbuild/win32-x64 | 0.25.4 | MIT | node_modules/@esbuild/win32-x64 (package-lock.json) |
| @eslint-community/eslint-utils | 4.9.1 | MIT | node_modules/@eslint-community/eslint-utils (package-lock.json) |
| @eslint-community/regexpp | 4.12.2 | MIT | node_modules/@eslint-community/regexpp (package-lock.json) |
| @eslint/config-array | 0.23.5 | Apache-2.0 | node_modules/@eslint/config-array (package-lock.json) |
| @eslint/config-helpers | 0.7.0 | Apache-2.0 | node_modules/@eslint/config-helpers (package-lock.json) |
| @eslint/core | 1.2.1 | Apache-2.0 | node_modules/@eslint/core (package-lock.json) |
| @eslint/js | 10.0.1 | MIT | node_modules/@eslint/js (package-lock.json) |
| @eslint/object-schema | 3.0.5 | Apache-2.0 | node_modules/@eslint/object-schema (package-lock.json) |
| @eslint/plugin-kit | 0.7.2 | Apache-2.0 | node_modules/@eslint/plugin-kit (package-lock.json) |
| @exodus/bytes | 1.15.0 | MIT | node_modules/@exodus/bytes (package-lock.json) |
| @formatjs/ecma402-abstract | 2.3.6 | MIT | node_modules/@formatjs/ecma402-abstract (package-lock.json) |
| @formatjs/fast-memoize | 2.2.7 | MIT | node_modules/@formatjs/fast-memoize (package-lock.json) |
| @formatjs/icu-messageformat-parser | 2.11.4 | MIT | node_modules/@formatjs/icu-messageformat-parser (package-lock.json) |
| @formatjs/icu-skeleton-parser | 1.8.16 | MIT | node_modules/@formatjs/icu-skeleton-parser (package-lock.json) |
| @formatjs/intl-localematcher | 0.6.2 | MIT | node_modules/@formatjs/intl-localematcher (package-lock.json) |
| @humanfs/core | 0.19.1 | Apache-2.0 | node_modules/@humanfs/core (package.json license) |
| @humanfs/node | 0.16.6 | Apache-2.0 | node_modules/@humanfs/node (package.json license) |
| @humanwhocodes/module-importer | 1.0.1 | Apache-2.0 | node_modules/@humanwhocodes/module-importer (package.json license) |
| @humanwhocodes/retry | 0.3.1 | Apache-2.0 | node_modules/@humanfs/node/node_modules/@humanwhocodes/retry (package.json license) |
| @humanwhocodes/retry | 0.4.3 | Apache-2.0 | node_modules/@humanwhocodes/retry (package-lock.json) |
| @jridgewell/sourcemap-codec | 1.5.5 | MIT | node_modules/@jridgewell/sourcemap-codec (package-lock.json) |
| @keyv/serialize | 1.0.2 | MIT | node_modules/@keyv/serialize (package-lock.json) |
| @napi-rs/wasm-runtime | 1.1.6 | MIT | node_modules/@napi-rs/wasm-runtime (package-lock.json) |
| @nodelib/fs.scandir | 2.1.5 | MIT | node_modules/@nodelib/fs.scandir (package-lock.json) |
| @nodelib/fs.stat | 2.0.5 | MIT | node_modules/@nodelib/fs.stat (package-lock.json) |
| @nodelib/fs.walk | 1.2.8 | MIT | node_modules/@nodelib/fs.walk (package-lock.json) |
| @opentelemetry/api | 1.9.1 | Apache-2.0 | node_modules/@opentelemetry/api (package-lock.json) |
| @opentelemetry/api-logs | 0.220.0 | Apache-2.0 | node_modules/@opentelemetry/api-logs (package-lock.json) |
| @opentelemetry/core | 2.10.0 | Apache-2.0 | node_modules/@opentelemetry/core (package-lock.json) |
| @opentelemetry/instrumentation | 0.220.0 | Apache-2.0 | node_modules/@opentelemetry/instrumentation (package-lock.json) |
| @opentelemetry/resources | 2.10.0 | Apache-2.0 | node_modules/@opentelemetry/resources (package-lock.json) |
| @opentelemetry/sdk-trace | 2.10.0 | Apache-2.0 | node_modules/@opentelemetry/sdk-trace (package-lock.json) |
| @opentelemetry/sdk-trace-base | 2.10.0 | Apache-2.0 | node_modules/@opentelemetry/sdk-trace-base (package-lock.json) |
| @opentelemetry/semantic-conventions | 1.43.0 | Apache-2.0 | node_modules/@opentelemetry/semantic-conventions (package-lock.json) |
| @paulirish/trace_engine | 0.0.65 | BSD-3-Clause | node_modules/@paulirish/trace_engine (package-lock.json) |
| @playwright/test | 1.56.1 | Apache-2.0 | node_modules/@playwright/test (package-lock.json) |
| @puppeteer/browsers | 3.0.6 | Apache-2.0 | node_modules/@puppeteer/browsers (package-lock.json) |
| @rollup/rollup-android-arm-eabi | 4.60.4 | MIT | node_modules/@rollup/rollup-android-arm-eabi (package-lock.json) |
| @rollup/rollup-android-arm64 | 4.60.4 | MIT | node_modules/@rollup/rollup-android-arm64 (package-lock.json) |
| @rollup/rollup-darwin-arm64 | 4.60.4 | MIT | node_modules/@rollup/rollup-darwin-arm64 (package-lock.json) |
| @rollup/rollup-darwin-x64 | 4.60.4 | MIT | node_modules/@rollup/rollup-darwin-x64 (package-lock.json) |
| @rollup/rollup-freebsd-arm64 | 4.60.4 | MIT | node_modules/@rollup/rollup-freebsd-arm64 (package-lock.json) |
| @rollup/rollup-freebsd-x64 | 4.60.4 | MIT | node_modules/@rollup/rollup-freebsd-x64 (package-lock.json) |
| @rollup/rollup-linux-arm-gnueabihf | 4.60.4 | MIT | node_modules/@rollup/rollup-linux-arm-gnueabihf (package-lock.json) |
| @rollup/rollup-linux-arm-musleabihf | 4.60.4 | MIT | node_modules/@rollup/rollup-linux-arm-musleabihf (package-lock.json) |
| @rollup/rollup-linux-arm64-gnu | 4.60.4 | MIT | node_modules/@rollup/rollup-linux-arm64-gnu (package-lock.json) |
| @rollup/rollup-linux-arm64-musl | 4.60.4 | MIT | node_modules/@rollup/rollup-linux-arm64-musl (package-lock.json) |
| @rollup/rollup-linux-loong64-gnu | 4.60.4 | MIT | node_modules/@rollup/rollup-linux-loong64-gnu (package-lock.json) |
| @rollup/rollup-linux-loong64-musl | 4.60.4 | MIT | node_modules/@rollup/rollup-linux-loong64-musl (package-lock.json) |
| @rollup/rollup-linux-ppc64-gnu | 4.60.4 | MIT | node_modules/@rollup/rollup-linux-ppc64-gnu (package-lock.json) |
| @rollup/rollup-linux-ppc64-musl | 4.60.4 | MIT | node_modules/@rollup/rollup-linux-ppc64-musl (package-lock.json) |
| @rollup/rollup-linux-riscv64-gnu | 4.60.4 | MIT | node_modules/@rollup/rollup-linux-riscv64-gnu (package-lock.json) |
| @rollup/rollup-linux-riscv64-musl | 4.60.4 | MIT | node_modules/@rollup/rollup-linux-riscv64-musl (package-lock.json) |
| @rollup/rollup-linux-s390x-gnu | 4.60.4 | MIT | node_modules/@rollup/rollup-linux-s390x-gnu (package-lock.json) |
| @rollup/rollup-linux-x64-gnu | 4.60.4 | MIT | node_modules/@rollup/rollup-linux-x64-gnu (package-lock.json) |
| @rollup/rollup-linux-x64-musl | 4.60.4 | MIT | node_modules/@rollup/rollup-linux-x64-musl (package-lock.json) |
| @rollup/rollup-openbsd-x64 | 4.60.4 | MIT | node_modules/@rollup/rollup-openbsd-x64 (package-lock.json) |
| @rollup/rollup-openharmony-arm64 | 4.60.4 | MIT | node_modules/@rollup/rollup-openharmony-arm64 (package-lock.json) |
| @rollup/rollup-win32-arm64-msvc | 4.60.4 | MIT | node_modules/@rollup/rollup-win32-arm64-msvc (package-lock.json) |
| @rollup/rollup-win32-ia32-msvc | 4.60.4 | MIT | node_modules/@rollup/rollup-win32-ia32-msvc (package-lock.json) |
| @rollup/rollup-win32-x64-gnu | 4.60.4 | MIT | node_modules/@rollup/rollup-win32-x64-gnu (package-lock.json) |
| @rollup/rollup-win32-x64-msvc | 4.60.4 | MIT | node_modules/@rollup/rollup-win32-x64-msvc (package-lock.json) |
| @sentry/conventions | 0.16.0 | MIT | node_modules/@sentry/conventions (package-lock.json) |
| @sentry/core | 10.68.0 | MIT | node_modules/@sentry/core (package-lock.json) |
| @sentry/node | 10.68.0 | MIT | node_modules/@sentry/node (package-lock.json) |
| @sentry/node-core | 10.68.0 | MIT | node_modules/@sentry/node-core (package-lock.json) |
| @sentry/opentelemetry | 10.68.0 | MIT | node_modules/@sentry/opentelemetry (package-lock.json) |
| @sentry/server-utils | 10.68.0 | MIT | node_modules/@sentry/server-utils (package-lock.json) |
| @standard-schema/spec | 1.1.0 | MIT | node_modules/@standard-schema/spec (package-lock.json) |
| @tybys/wasm-util | 0.10.3 | MIT | node_modules/@tybys/wasm-util (package-lock.json) |
| @types/chai | 5.2.3 | MIT | node_modules/@types/chai (package-lock.json) |
| @types/deep-eql | 4.0.2 | MIT | node_modules/@types/deep-eql (package-lock.json) |
| @types/esrecurse | 4.3.1 | MIT | node_modules/@types/esrecurse (package-lock.json) |
| @types/estree | 1.0.8 | MIT | node_modules/@types/estree (package-lock.json) |
| @types/json-schema | 7.0.15 | MIT | node_modules/@types/json-schema (package-lock.json) |
| @types/node | 24.9.1 | MIT | node_modules/@types/node (package-lock.json) |
| @typescript-eslint/types | 8.65.0 | MIT | node_modules/@typescript-eslint/types (package-lock.json) |
| @unrs/resolver-binding-android-arm-eabi | 1.12.2 | MIT | node_modules/@unrs/resolver-binding-android-arm-eabi (package-lock.json) |
| @unrs/resolver-binding-android-arm64 | 1.12.2 | MIT | node_modules/@unrs/resolver-binding-android-arm64 (package-lock.json) |
| @unrs/resolver-binding-darwin-arm64 | 1.12.2 | MIT | node_modules/@unrs/resolver-binding-darwin-arm64 (package-lock.json) |
| @unrs/resolver-binding-darwin-x64 | 1.12.2 | MIT | node_modules/@unrs/resolver-binding-darwin-x64 (package-lock.json) |
| @unrs/resolver-binding-freebsd-x64 | 1.12.2 | MIT | node_modules/@unrs/resolver-binding-freebsd-x64 (package-lock.json) |
| @unrs/resolver-binding-linux-arm-gnueabihf | 1.12.2 | MIT | node_modules/@unrs/resolver-binding-linux-arm-gnueabihf (package-lock.json) |
| @unrs/resolver-binding-linux-arm-musleabihf | 1.12.2 | MIT | node_modules/@unrs/resolver-binding-linux-arm-musleabihf (package-lock.json) |
| @unrs/resolver-binding-linux-arm64-gnu | 1.12.2 | MIT | node_modules/@unrs/resolver-binding-linux-arm64-gnu (package-lock.json) |
| @unrs/resolver-binding-linux-arm64-musl | 1.12.2 | MIT | node_modules/@unrs/resolver-binding-linux-arm64-musl (package-lock.json) |
| @unrs/resolver-binding-linux-loong64-gnu | 1.12.2 | MIT | node_modules/@unrs/resolver-binding-linux-loong64-gnu (package-lock.json) |
| @unrs/resolver-binding-linux-loong64-musl | 1.12.2 | MIT | node_modules/@unrs/resolver-binding-linux-loong64-musl (package-lock.json) |
| @unrs/resolver-binding-linux-ppc64-gnu | 1.12.2 | MIT | node_modules/@unrs/resolver-binding-linux-ppc64-gnu (package-lock.json) |
| @unrs/resolver-binding-linux-riscv64-gnu | 1.12.2 | MIT | node_modules/@unrs/resolver-binding-linux-riscv64-gnu (package-lock.json) |
| @unrs/resolver-binding-linux-riscv64-musl | 1.12.2 | MIT | node_modules/@unrs/resolver-binding-linux-riscv64-musl (package-lock.json) |
| @unrs/resolver-binding-linux-s390x-gnu | 1.12.2 | MIT | node_modules/@unrs/resolver-binding-linux-s390x-gnu (package-lock.json) |
| @unrs/resolver-binding-linux-x64-gnu | 1.12.2 | MIT | node_modules/@unrs/resolver-binding-linux-x64-gnu (package-lock.json) |
| @unrs/resolver-binding-linux-x64-musl | 1.12.2 | MIT | node_modules/@unrs/resolver-binding-linux-x64-musl (package-lock.json) |
| @unrs/resolver-binding-openharmony-arm64 | 1.12.2 | MIT | node_modules/@unrs/resolver-binding-openharmony-arm64 (package-lock.json) |
| @unrs/resolver-binding-wasm32-wasi | 1.12.2 | MIT | node_modules/@unrs/resolver-binding-wasm32-wasi (package-lock.json) |
| @unrs/resolver-binding-win32-arm64-msvc | 1.12.2 | MIT | node_modules/@unrs/resolver-binding-win32-arm64-msvc (package-lock.json) |
| @unrs/resolver-binding-win32-ia32-msvc | 1.12.2 | MIT | node_modules/@unrs/resolver-binding-win32-ia32-msvc (package-lock.json) |
| @unrs/resolver-binding-win32-x64-msvc | 1.12.2 | MIT | node_modules/@unrs/resolver-binding-win32-x64-msvc (package-lock.json) |
| @vitest/expect | 4.1.0 | MIT | node_modules/@vitest/expect (package-lock.json) |
| @vitest/mocker | 4.1.0 | MIT | node_modules/@vitest/mocker (package-lock.json) |
| @vitest/pretty-format | 4.1.0 | MIT | node_modules/@vitest/pretty-format (package-lock.json) |
| @vitest/runner | 4.1.0 | MIT | node_modules/@vitest/runner (package-lock.json) |
| @vitest/snapshot | 4.1.0 | MIT | node_modules/@vitest/snapshot (package-lock.json) |
| @vitest/spy | 4.1.0 | MIT | node_modules/@vitest/spy (package-lock.json) |
| @vitest/utils | 4.1.0 | MIT | node_modules/@vitest/utils (package-lock.json) |
| acorn | 8.17.0 | MIT | node_modules/acorn (package-lock.json) |
| acorn-jsx | 5.3.2 | MIT | node_modules/acorn-jsx (package-lock.json) |
| ajv | 6.15.0 | MIT | node_modules/ajv (package-lock.json) |
| ajv | 8.20.0 | MIT | node_modules/table/node_modules/ajv (package-lock.json) |
| ansi-colors | 4.1.3 | MIT | node_modules/ansi-colors (package-lock.json) |
| ansi-regex | 5.0.1 | MIT | node_modules/ansi-regex (package-lock.json) |
| ansi-regex | 6.2.2 | MIT | node_modules/@puppeteer/browsers/node_modules/ansi-regex (package-lock.json) |
| ansi-styles | 4.3.0 | MIT | node_modules/ansi-styles (package.json license) |
| ansi-styles | 6.2.3 | MIT | node_modules/@puppeteer/browsers/node_modules/ansi-styles (package-lock.json) |
| argparse | 2.0.1 | Python-2.0 | node_modules/argparse (package.json license) |
| array-union | 2.1.0 | MIT | node_modules/array-union (package-lock.json) |
| assertion-error | 2.0.1 | MIT | node_modules/assertion-error (package-lock.json) |
| astral-regex | 2.0.0 | MIT | node_modules/astral-regex (package-lock.json) |
| astring | 1.9.0 | MIT | node_modules/astring (package-lock.json) |
| atomically | 2.1.1 | MIT | node_modules/atomically (package-lock.json) |
| axe-core | 4.11.4 | MPL-2.0 | node_modules/axe-core (package-lock.json) |
| axe-core | 4.12.1 | MPL-2.0 | node_modules/lighthouse/node_modules/axe-core (package-lock.json) |
| balanced-match | 2.0.0 | MIT | node_modules/stylelint/node_modules/balanced-match (package-lock.json) |
| balanced-match | 4.0.4 | MIT | node_modules/balanced-match (package-lock.json) |
| base64-js | 1.5.1 | MIT | node_modules/base64-js (package-lock.json) |
| bidi-js | 1.0.3 | MIT | node_modules/bidi-js (package-lock.json) |
| brace-expansion | 5.0.9 | MIT | node_modules/brace-expansion (package-lock.json) |
| braces | 3.0.3 | MIT | node_modules/braces (package-lock.json) |
| buffer | 6.0.3 | MIT | node_modules/buffer (package-lock.json) |
| cacheable | 1.8.8 | MIT | node_modules/cacheable (package-lock.json) |
| callsites | 3.1.0 | MIT | node_modules/callsites (package.json license) |
| chai | 6.2.2 | MIT | node_modules/chai (package-lock.json) |
| chrome-launcher | 1.2.1 | Apache-2.0 | node_modules/chrome-launcher (package-lock.json) |
| chromium-bidi | 16.0.1 | Apache-2.0 | node_modules/chromium-bidi (package-lock.json) |
| cjs-module-lexer | 2.2.0 | MIT | node_modules/cjs-module-lexer (package-lock.json) |
| cliui | 8.0.1 | ISC | node_modules/cliui (package-lock.json) |
| cliui | 9.0.1 | ISC | node_modules/@puppeteer/browsers/node_modules/cliui (package-lock.json) |
| color-convert | 2.0.1 | MIT | node_modules/color-convert (package.json license) |
| color-name | 1.1.4 | MIT | node_modules/color-name (package.json license) |
| colord | 2.9.3 | MIT | node_modules/colord (package-lock.json) |
| comment-parser | 1.4.7 | MIT | node_modules/comment-parser (package-lock.json) |
| configstore | 7.1.0 | BSD-2-Clause | node_modules/configstore (package-lock.json) |
| convert-source-map | 2.0.0 | MIT | node_modules/convert-source-map (package-lock.json) |
| cosmiconfig | 9.0.0 | MIT | node_modules/cosmiconfig (package-lock.json) |
| cross-spawn | 7.0.6 | MIT | node_modules/cross-spawn (package.json license) |
| csp_evaluator | 1.1.8 | Apache-2.0 | node_modules/csp_evaluator (package-lock.json) |
| css-functions-list | 3.2.3 | MIT | node_modules/css-functions-list (package-lock.json) |
| css-tree | 3.2.1 | MIT | node_modules/css-tree (package-lock.json) |
| cssesc | 3.0.0 | MIT | node_modules/cssesc (package-lock.json) |
| data-urls | 7.0.0 | MIT | node_modules/data-urls (package-lock.json) |
| debug | 4.4.3 | MIT | node_modules/debug (package-lock.json) |
| decimal.js | 10.6.0 | MIT | node_modules/decimal.js (package-lock.json) |
| deep-is | 0.1.4 | MIT | node_modules/deep-is (package.json license) |
| define-lazy-prop | 2.0.0 | MIT | node_modules/define-lazy-prop (package-lock.json) |
| devtools-protocol | 0.0.1638949 | BSD-3-Clause | node_modules/puppeteer-core/node_modules/devtools-protocol (package-lock.json) |
| devtools-protocol | 0.0.1663043 | BSD-3-Clause | node_modules/devtools-protocol (package-lock.json) |
| dir-glob | 3.0.1 | MIT | node_modules/dir-glob (package-lock.json) |
| dot-prop | 9.0.0 | MIT | node_modules/dot-prop (package-lock.json) |
| emoji-regex | 10.6.0 | MIT | node_modules/@puppeteer/browsers/node_modules/emoji-regex (package-lock.json) |
| emoji-regex | 8.0.0 | MIT | node_modules/emoji-regex (package-lock.json) |
| enquirer | 2.4.1 | MIT | node_modules/enquirer (package-lock.json) |
| entities | 6.0.1 | BSD-2-Clause | node_modules/entities (package-lock.json) |
| env-paths | 2.2.1 | MIT | node_modules/env-paths (package-lock.json) |
| error-ex | 1.3.2 | MIT | node_modules/error-ex (package-lock.json) |
| es-module-lexer | 2.3.1 | MIT | node_modules/es-module-lexer (package-lock.json) |
| esbuild | 0.25.4 | MIT | node_modules/esbuild (package-lock.json) |
| escalade | 3.2.0 | MIT | node_modules/escalade (package-lock.json) |
| escape-string-regexp | 4.0.0 | MIT | node_modules/escape-string-regexp (package.json license) |
| eslint | 10.8.0 | MIT | node_modules/eslint (package-lock.json) |
| eslint-import-context | 0.1.9 | MIT | node_modules/eslint-import-context (package-lock.json) |
| eslint-plugin-import-x | 4.17.1 | MIT | node_modules/eslint-plugin-import-x (package-lock.json) |
| eslint-scope | 9.1.2 | BSD-2-Clause | node_modules/eslint-scope (package-lock.json) |
| eslint-visitor-keys | 3.4.3 | Apache-2.0 | node_modules/@eslint-community/eslint-utils/node_modules/eslint-visitor-keys (package-lock.json) |
| eslint-visitor-keys | 5.0.1 | Apache-2.0 | node_modules/eslint-visitor-keys (package-lock.json) |
| espree | 11.2.0 | BSD-2-Clause | node_modules/espree (package-lock.json) |
| esquery | 1.7.0 | BSD-3-Clause | node_modules/esquery (package-lock.json) |
| esrecurse | 4.3.0 | BSD-2-Clause | node_modules/esrecurse (package-lock.json) |
| estraverse | 5.3.0 | BSD-2-Clause | node_modules/estraverse (package.json license) |
| estree-walker | 3.0.3 | MIT | node_modules/estree-walker (package-lock.json) |
| esutils | 2.0.3 | BSD-2-Clause | node_modules/esutils (package.json license) |
| expect-type | 1.3.0 | Apache-2.0 | node_modules/expect-type (package-lock.json) |
| fast-deep-equal | 3.1.3 | MIT | node_modules/fast-deep-equal (package.json license) |
| fast-glob | 3.3.3 | MIT | node_modules/fast-glob (package-lock.json) |
| fast-json-stable-stringify | 2.1.0 | MIT | node_modules/fast-json-stable-stringify (package-lock.json) |
| fast-levenshtein | 2.0.6 | MIT | node_modules/fast-levenshtein (package.json license) |
| fast-uri | 3.1.5 | BSD-3-Clause | node_modules/fast-uri (package-lock.json) |
| fastest-levenshtein | 1.0.16 | MIT | node_modules/fastest-levenshtein (package-lock.json) |
| fastq | 1.19.0 | ISC | node_modules/fastq (package-lock.json) |
| fdir | 6.4.4 | MIT | node_modules/vite/node_modules/fdir (package-lock.json) |
| fdir | 6.5.0 | MIT | node_modules/tinyglobby/node_modules/fdir (package-lock.json) |
| file-entry-cache | 10.0.6 | MIT | node_modules/stylelint/node_modules/file-entry-cache (package-lock.json) |
| file-entry-cache | 8.0.0 | MIT | node_modules/file-entry-cache (package.json license) |
| fill-range | 7.1.1 | MIT | node_modules/fill-range (package-lock.json) |
| find-up | 5.0.0 | MIT | node_modules/find-up (package.json license) |
| flat-cache | 4.0.1 | MIT | node_modules/flat-cache (package.json license) |
| flat-cache | 6.1.6 | MIT | node_modules/stylelint/node_modules/flat-cache (package-lock.json) |
| flatted | 3.4.2 | ISC | node_modules/flatted (package-lock.json) |
| fsevents | 2.3.2 | MIT | node_modules/playwright/node_modules/fsevents (package-lock.json) |
| fsevents | 2.3.3 | MIT | node_modules/fsevents (package-lock.json) |
| get-caller-file | 2.0.5 | ISC | node_modules/get-caller-file (package-lock.json) |
| get-east-asian-width | 1.6.0 | MIT | node_modules/get-east-asian-width (package-lock.json) |
| get-tsconfig | 4.14.0 | MIT | node_modules/get-tsconfig (package-lock.json) |
| glob | 13.0.6 | BlueOak-1.0.0 | node_modules/glob (package-lock.json) |
| glob-parent | 5.1.2 | ISC | node_modules/fast-glob/node_modules/glob-parent (package-lock.json) |
| glob-parent | 6.0.2 | ISC | node_modules/glob-parent (package.json license) |
| global-modules | 2.0.0 | MIT | node_modules/global-modules (package-lock.json) |
| global-prefix | 3.0.0 | MIT | node_modules/global-prefix (package-lock.json) |
| globals | 15.15.0 | MIT | node_modules/globals (package-lock.json) |
| globby | 11.1.0 | MIT | node_modules/globby (package-lock.json) |
| globjoin | 0.1.4 | MIT | node_modules/globjoin (package-lock.json) |
| graceful-fs | 4.2.11 | ISC | node_modules/graceful-fs (package-lock.json) |
| has-flag | 4.0.0 | MIT | node_modules/has-flag (package.json license) |
| hookified | 1.7.1 | MIT | node_modules/hookified (package-lock.json) |
| html-encoding-sniffer | 6.0.0 | MIT | node_modules/html-encoding-sniffer (package-lock.json) |
| html-tags | 3.3.1 | MIT | node_modules/html-tags (package-lock.json) |
| http-link-header | 1.1.3 | MIT | node_modules/http-link-header (package-lock.json) |
| ieee754 | 1.2.1 | BSD-3-Clause | node_modules/ieee754 (package-lock.json) |
| ignore | 5.3.2 | MIT | node_modules/ignore (package.json license) |
| ignore | 7.0.3 | MIT | node_modules/stylelint/node_modules/ignore (package-lock.json) |
| image-ssim | 0.2.0 | MIT | node_modules/image-ssim (package-lock.json) |
| import-fresh | 3.3.1 | MIT | node_modules/import-fresh (package.json license) |
| import-in-the-middle | 3.3.2 | Apache-2.0 | node_modules/import-in-the-middle (package-lock.json) |
| imurmurhash | 0.1.4 | MIT | node_modules/imurmurhash (package.json license) |
| ini | 1.3.8 | ISC | node_modules/ini (package-lock.json) |
| intl-messageformat | 10.7.18 | BSD-3-Clause | node_modules/intl-messageformat (package-lock.json) |
| is-arrayish | 0.2.1 | MIT | node_modules/is-arrayish (package-lock.json) |
| is-docker | 2.2.1 | MIT | node_modules/is-docker (package-lock.json) |
| is-extglob | 2.1.1 | MIT | node_modules/is-extglob (package.json license) |
| is-fullwidth-code-point | 3.0.0 | MIT | node_modules/is-fullwidth-code-point (package-lock.json) |
| is-glob | 4.0.3 | MIT | node_modules/is-glob (package.json license) |
| is-number | 7.0.0 | MIT | node_modules/is-number (package-lock.json) |
| is-plain-object | 5.0.0 | MIT | node_modules/is-plain-object (package-lock.json) |
| is-potential-custom-element-name | 1.0.1 | MIT | node_modules/is-potential-custom-element-name (package-lock.json) |
| is-wsl | 2.2.0 | MIT | node_modules/is-wsl (package-lock.json) |
| isexe | 2.0.0 | ISC | node_modules/isexe (package.json license) |
| jpeg-js | 0.4.4 | BSD-3-Clause | node_modules/jpeg-js (package-lock.json) |
| js-library-detector | 6.7.0 | MIT | node_modules/js-library-detector (package-lock.json) |
| js-tokens | 4.0.0 | MIT | node_modules/js-tokens (package-lock.json) |
| js-yaml | 4.3.1 | MIT | node_modules/js-yaml (package-lock.json) |
| jsdom | 29.0.1 | MIT | node_modules/jsdom (package-lock.json) |
| json-buffer | 3.0.1 | MIT | node_modules/json-buffer (package.json license) |
| json-parse-even-better-errors | 2.3.1 | MIT | node_modules/json-parse-even-better-errors (package-lock.json) |
| json-schema-traverse | 0.4.1 | MIT | node_modules/json-schema-traverse (package-lock.json) |
| json-schema-traverse | 1.0.0 | MIT | node_modules/table/node_modules/json-schema-traverse (package-lock.json) |
| json-stable-stringify-without-jsonify | 1.0.1 | MIT | node_modules/json-stable-stringify-without-jsonify (package.json license) |
| keyv | 4.5.4 | MIT | node_modules/keyv (package.json license) |
| keyv | 5.2.3 | MIT | node_modules/cacheable/node_modules/keyv (package-lock.json) |
| kind-of | 6.0.3 | MIT | node_modules/kind-of (package-lock.json) |
| known-css-properties | 0.35.0 | MIT | node_modules/known-css-properties (package-lock.json) |
| legacy-javascript | 0.0.1 | Apache-2.0 | node_modules/legacy-javascript (package-lock.json) |
| levn | 0.4.1 | MIT | node_modules/levn (package.json license) |
| lighthouse | 13.4.1 | Apache-2.0 | node_modules/lighthouse (package-lock.json) |
| lighthouse-logger | 2.0.2 | Apache-2.0 | node_modules/lighthouse-logger (package-lock.json) |
| lighthouse-stack-packs | 1.12.3 | Apache-2.0 | node_modules/lighthouse-stack-packs (package-lock.json) |
| lines-and-columns | 1.2.4 | MIT | node_modules/lines-and-columns (package-lock.json) |
| locate-path | 6.0.0 | MIT | node_modules/locate-path (package.json license) |
| lodash-es | 4.18.1 | MIT | node_modules/lodash-es (package-lock.json) |
| lodash.truncate | 4.4.2 | MIT | node_modules/lodash.truncate (package-lock.json) |
| lookup-closest-locale | 6.2.0 | MIT | node_modules/lookup-closest-locale (package-lock.json) |
| lru-cache | 11.2.7 | BlueOak-1.0.0 | node_modules/lru-cache (package-lock.json) |
| magic-string | 0.30.21 | MIT | node_modules/magic-string (package-lock.json) |
| marky | 1.3.0 | Apache-2.0 | node_modules/marky (package-lock.json) |
| mathml-tag-names | 2.1.3 | MIT | node_modules/mathml-tag-names (package-lock.json) |
| mdn-data | 2.27.1 | CC0-1.0 | node_modules/mdn-data (package-lock.json) |
| meow | 13.2.0 | MIT | node_modules/meow (package-lock.json) |
| merge2 | 1.4.1 | MIT | node_modules/merge2 (package-lock.json) |
| meriyah | 6.1.4 | ISC | node_modules/meriyah (package-lock.json) |
| micromatch | 4.0.8 | MIT | node_modules/micromatch (package-lock.json) |
| minimatch | 10.2.5 | BlueOak-1.0.0 | node_modules/glob/node_modules/minimatch (package-lock.json) |
| minipass | 7.1.3 | BlueOak-1.0.0 | node_modules/minipass (package-lock.json) |
| mitt | 3.0.1 | MIT | node_modules/mitt (package-lock.json) |
| modern-tar | 0.7.7 | MIT | node_modules/modern-tar (package-lock.json) |
| module-details-from-path | 1.0.4 | MIT | node_modules/module-details-from-path (package-lock.json) |
| ms | 2.1.3 | MIT | node_modules/ms (package.json license) |
| nanoid | 3.3.18 | MIT | node_modules/nanoid (package-lock.json) |
| napi-postinstall | 0.3.4 | MIT | node_modules/napi-postinstall (package-lock.json) |
| natural-compare | 1.4.0 | MIT | node_modules/natural-compare (package.json license) |
| normalize-path | 3.0.0 | MIT | node_modules/normalize-path (package-lock.json) |
| obug | 2.1.1 | MIT | node_modules/obug (package-lock.json) |
| open | 8.4.2 | MIT | node_modules/open (package-lock.json) |
| optionator | 0.9.4 | MIT | node_modules/optionator (package.json license) |
| p-limit | 3.1.0 | MIT | node_modules/p-limit (package.json license) |
| p-locate | 5.0.0 | MIT | node_modules/p-locate (package.json license) |
| parent-module | 1.0.1 | MIT | node_modules/parent-module (package.json license) |
| parse-json | 5.2.0 | MIT | node_modules/parse-json (package-lock.json) |
| parse5 | 8.0.0 | MIT | node_modules/parse5 (package-lock.json) |
| path-exists | 4.0.0 | MIT | node_modules/path-exists (package.json license) |
| path-key | 3.1.1 | MIT | node_modules/path-key (package.json license) |
| path-scurry | 2.0.2 | BlueOak-1.0.0 | node_modules/path-scurry (package-lock.json) |
| path-type | 4.0.0 | MIT | node_modules/path-type (package-lock.json) |
| pathe | 2.0.3 | MIT | node_modules/pathe (package-lock.json) |
| picocolors | 1.1.1 | ISC | node_modules/picocolors (package-lock.json) |
| picomatch | 2.3.2 | MIT | node_modules/picomatch (package-lock.json) |
| picomatch | 4.0.4 | MIT | node_modules/vitest/node_modules/picomatch (package-lock.json) |
| playwright | 1.56.1 | Apache-2.0 | node_modules/playwright (package-lock.json) |
| playwright-core | 1.56.1 | Apache-2.0 | node_modules/playwright-core (package-lock.json) |
| postcss | 8.5.23 | MIT | node_modules/postcss (package-lock.json) |
| postcss-resolve-nested-selector | 0.1.6 | MIT | node_modules/postcss-resolve-nested-selector (package-lock.json) |
| postcss-safe-parser | 7.0.1 | MIT | node_modules/postcss-safe-parser (package-lock.json) |
| postcss-selector-parser | 7.1.0 | MIT | node_modules/postcss-selector-parser (package-lock.json) |
| postcss-value-parser | 4.2.0 | MIT | node_modules/postcss-value-parser (package-lock.json) |
| prelude-ls | 1.2.1 | MIT | node_modules/prelude-ls (package.json license) |
| punycode | 2.3.1 | MIT | node_modules/punycode (package.json license) |
| puppeteer-core | 25.3.0 | Apache-2.0 | node_modules/puppeteer-core (package-lock.json) |
| queue-microtask | 1.2.3 | MIT | node_modules/queue-microtask (package-lock.json) |
| require-directory | 2.1.1 | MIT | node_modules/require-directory (package-lock.json) |
| require-from-string | 2.0.2 | MIT | node_modules/require-from-string (package-lock.json) |
| require-in-the-middle | 8.0.1 | MIT | node_modules/require-in-the-middle (package-lock.json) |
| resolve-from | 4.0.0 | MIT | node_modules/resolve-from (package.json license) |
| resolve-from | 5.0.0 | MIT | node_modules/stylelint/node_modules/resolve-from (package-lock.json) |
| resolve-pkg-maps | 1.0.0 | MIT | node_modules/resolve-pkg-maps (package-lock.json) |
| reusify | 1.0.4 | MIT | node_modules/reusify (package-lock.json) |
| robots-parser | 3.0.1 | MIT | node_modules/robots-parser (package-lock.json) |
| rollup | 4.60.4 | MIT | node_modules/rollup (package-lock.json) |
| run-parallel | 1.2.0 | MIT | node_modules/run-parallel (package-lock.json) |
| saxes | 6.0.0 | ISC | node_modules/saxes (package-lock.json) |
| semifies | 1.0.0 | Apache-2.0 | node_modules/semifies (package-lock.json) |
| semver | 7.8.5 | ISC | node_modules/eslint-plugin-import-x/node_modules/semver (package-lock.json) |
| shebang-command | 2.0.0 | MIT | node_modules/shebang-command (package.json license) |
| shebang-regex | 3.0.0 | MIT | node_modules/shebang-regex (package.json license) |
| siginfo | 2.0.0 | ISC | node_modules/siginfo (package-lock.json) |
| signal-exit | 4.1.0 | ISC | node_modules/signal-exit (package-lock.json) |
| slash | 3.0.0 | MIT | node_modules/slash (package-lock.json) |
| slice-ansi | 4.0.0 | MIT | node_modules/slice-ansi (package-lock.json) |
| source-map | 0.6.1 | BSD-3-Clause | node_modules/source-map (package-lock.json) |
| source-map-js | 1.2.1 | BSD-3-Clause | node_modules/source-map-js (package-lock.json) |
| speedline-core | 1.4.3 | MIT | node_modules/speedline-core (package-lock.json) |
| stable-hash-x | 0.2.0 | MIT | node_modules/stable-hash-x (package-lock.json) |
| stackback | 0.0.2 | MIT | node_modules/stackback (package-lock.json) |
| std-env | 4.0.0 | MIT | node_modules/std-env (package-lock.json) |
| string-width | 4.2.3 | MIT | node_modules/string-width (package-lock.json) |
| string-width | 7.2.0 | MIT | node_modules/@puppeteer/browsers/node_modules/string-width (package-lock.json) |
| strip-ansi | 6.0.1 | MIT | node_modules/strip-ansi (package-lock.json) |
| strip-ansi | 7.2.0 | MIT | node_modules/@puppeteer/browsers/node_modules/strip-ansi (package-lock.json) |
| stubborn-fs | 2.0.0 | MIT | node_modules/stubborn-fs (package-lock.json) |
| stubborn-utils | 1.0.2 | MIT | node_modules/stubborn-utils (package-lock.json) |
| stylelint | 16.14.1 | MIT | node_modules/stylelint (package-lock.json) |
| stylelint-config-recommended | 15.0.0 | MIT | node_modules/stylelint-config-recommended (package-lock.json) |
| stylelint-config-standard | 37.0.0 | MIT | node_modules/stylelint-config-standard (package-lock.json) |
| supports-color | 7.2.0 | MIT | node_modules/supports-color (package.json license) |
| supports-hyperlinks | 3.2.0 | MIT | node_modules/supports-hyperlinks (package-lock.json) |
| svg-tags | 1.0.0 | MIT | node_modules/svg-tags (package.json licenses) |
| symbol-tree | 3.2.4 | MIT | node_modules/symbol-tree (package-lock.json) |
| table | 6.9.0 | BSD-3-Clause | node_modules/table (package-lock.json) |
| third-party-web | 0.29.2 | MIT | node_modules/third-party-web (package-lock.json) |
| tinybench | 2.9.0 | MIT | node_modules/tinybench (package-lock.json) |
| tinyexec | 1.0.4 | MIT | node_modules/tinyexec (package-lock.json) |
| tinyglobby | 0.2.15 | MIT | node_modules/tinyglobby (package-lock.json) |
| tinyrainbow | 3.1.0 | MIT | node_modules/tinyrainbow (package-lock.json) |
| tldts | 7.0.27 | MIT | node_modules/tldts (package-lock.json) |
| tldts-core | 7.4.9 | MIT | node_modules/tldts-core (package-lock.json) |
| tldts-icann | 7.4.9 | MIT | node_modules/tldts-icann (package-lock.json) |
| to-regex-range | 5.0.1 | MIT | node_modules/to-regex-range (package-lock.json) |
| tough-cookie | 6.0.1 | BSD-3-Clause | node_modules/tough-cookie (package-lock.json) |
| tr46 | 6.0.0 | MIT | node_modules/tr46 (package-lock.json) |
| tslib | 2.8.1 | 0BSD | node_modules/tslib (package-lock.json) |
| type-check | 0.4.0 | MIT | node_modules/type-check (package.json license) |
| type-fest | 4.41.0 | (MIT OR CC0-1.0) | node_modules/type-fest (package-lock.json) |
| typed-query-selector | 2.12.2 | MIT | node_modules/typed-query-selector (package-lock.json) |
| undici | 7.29.0 | MIT | node_modules/undici (package-lock.json) |
| undici-types | 7.16.0 | MIT | node_modules/undici-types (package-lock.json) |
| unrs-resolver | 1.12.2 | MIT | node_modules/unrs-resolver (package-lock.json) |
| uri-js | 4.4.1 | BSD-2-Clause | node_modules/uri-js (package-lock.json) |
| util-deprecate | 1.0.2 | MIT | node_modules/util-deprecate (package-lock.json) |
| vite | 6.4.3 | MIT | node_modules/vite (package-lock.json) |
| vitest | 4.1.0 | MIT | node_modules/vitest (package-lock.json) |
| w3c-xmlserializer | 5.0.0 | MIT | node_modules/w3c-xmlserializer (package-lock.json) |
| web-features | 3.34.2 | Apache-2.0 | node_modules/web-features (package-lock.json) |
| webdriver-bidi-protocol | 0.4.2 | Apache-2.0 | node_modules/webdriver-bidi-protocol (package-lock.json) |
| webidl-conversions | 8.0.1 | BSD-2-Clause | node_modules/webidl-conversions (package-lock.json) |
| whatwg-mimetype | 5.0.0 | MIT | node_modules/whatwg-mimetype (package-lock.json) |
| whatwg-url | 16.0.1 | MIT | node_modules/whatwg-url (package-lock.json) |
| when-exit | 2.1.5 | MIT | node_modules/when-exit (package-lock.json) |
| which | 1.3.1 | ISC | node_modules/global-prefix/node_modules/which (package-lock.json) |
| which | 2.0.2 | ISC | node_modules/which (package.json license) |
| why-is-node-running | 2.3.0 | MIT | node_modules/why-is-node-running (package-lock.json) |
| word-wrap | 1.2.5 | MIT | node_modules/word-wrap (package.json license) |
| wrap-ansi | 7.0.0 | MIT | node_modules/wrap-ansi (package-lock.json) |
| wrap-ansi | 9.0.2 | MIT | node_modules/@puppeteer/browsers/node_modules/wrap-ansi (package-lock.json) |
| write-file-atomic | 5.0.1 | ISC | node_modules/write-file-atomic (package-lock.json) |
| ws | 7.5.11 | MIT | node_modules/ws (package-lock.json) |
| ws | 8.21.1 | MIT | node_modules/puppeteer-core/node_modules/ws (package-lock.json) |
| xdg-basedir | 5.1.0 | MIT | node_modules/xdg-basedir (package-lock.json) |
| xml-name-validator | 5.0.0 | Apache-2.0 | node_modules/xml-name-validator (package-lock.json) |
| xmlchars | 2.2.0 | MIT | node_modules/xmlchars (package-lock.json) |
| y18n | 5.0.8 | ISC | node_modules/y18n (package-lock.json) |
| yargs | 17.7.3 | MIT | node_modules/yargs (package-lock.json) |
| yargs | 18.0.0 | MIT | node_modules/@puppeteer/browsers/node_modules/yargs (package-lock.json) |
| yargs-parser | 21.1.1 | ISC | node_modules/yargs-parser (package-lock.json) |
| yargs-parser | 22.0.0 | ISC | node_modules/@puppeteer/browsers/node_modules/yargs-parser (package-lock.json) |
| yocto-queue | 0.1.0 | MIT | node_modules/yocto-queue (package.json license) |
| zod | 3.25.76 | MIT | node_modules/zod (package-lock.json) |

## Bundled Asset Inventory

| Path | Type |
| --- | --- |
| `frontend/dist/auth-tour/platform-card-view.jpg` | `.jpg` |
| `frontend/dist/auth-tour/platform-filterbar.jpg` | `.jpg` |
| `frontend/dist/auth-tour/platform-full-shell.jpg` | `.jpg` |
| `frontend/dist/auth-tour/platform-navbar.jpg` | `.jpg` |
| `frontend/dist/auth-tour/platform-table-view.jpg` | `.jpg` |
| `frontend/favicon.ico` | `.ico` |
| `frontend/favicon4E.png` | `.png` |
| `frontend/favicon4ER.png` | `.png` |
| `frontend/favicon4S.png` | `.png` |
| `frontend/favicon4SL.png` | `.png` |
| `frontend/icons/admin/card-visibility-checkbox-unchecked-icon.svg` | `.svg` |
| `frontend/icons/admin/permission-checkbox-ambiguous-icon.svg` | `.svg` |
| `frontend/icons/admin/permission-checkbox-checked-icon.svg` | `.svg` |
| `frontend/icons/admin/permission-checkbox-unchecked-icon.svg` | `.svg` |
| `frontend/icons/admin/permission-edit-icon.svg` | `.svg` |
| `frontend/icons/admin/permission-global-icon.svg` | `.svg` |
| `frontend/icons/admin/permission-table-icon.svg` | `.svg` |
| `frontend/icons/admin/permission-ui-icon.svg` | `.svg` |
| `frontend/icons/admin/permission-user-icon.svg` | `.svg` |
| `frontend/icons/auth/login-icon.svg` | `.svg` |
| `frontend/icons/auth/logout-icon.svg` | `.svg` |
| `frontend/icons/auth/password-visibility-off-icon.svg` | `.svg` |
| `frontend/icons/auth/password-visibility-on-icon.svg` | `.svg` |
| `frontend/icons/general/chat-message-icon.svg` | `.svg` |
| `frontend/icons/general/chevron-down-icon.svg` | `.svg` |
| `frontend/icons/general/dataset-search-icon.svg` | `.svg` |
| `frontend/icons/general/filter-list-icon.svg` | `.svg` |
| `frontend/icons/general/filterbar-hide-icon.svg` | `.svg` |
| `frontend/icons/general/filterbar-toggle-icon.svg` | `.svg` |
| `frontend/icons/general/minimize-panel-icon.svg` | `.svg` |
| `frontend/icons/general/modal-close-icon.svg` | `.svg` |
| `frontend/icons/general/table-tools-icon.svg` | `.svg` |
| `frontend/icons/general/trash-icon.svg` | `.svg` |
| `frontend/icons/general/user-person-icon.svg` | `.svg` |
| `frontend/icons/general/view-palette-icon.svg` | `.svg` |
| `frontend/icons/general/visible-fields-icon.svg` | `.svg` |
| `frontend/icons/navigation/language-globe-icon.svg` | `.svg` |
| `frontend/icons/navigation/nav-history-back-icon.svg` | `.svg` |
| `frontend/icons/navigation/nav-history-forward-icon.svg` | `.svg` |
| `frontend/icons/navigation/theme-dark-icon.svg` | `.svg` |
| `frontend/icons/navigation/theme-light-icon.svg` | `.svg` |
| `frontend/icons/navigation/theme-locked-dark-icon.svg` | `.svg` |
| `frontend/icons/navigation/theme-locked-light-icon.svg` | `.svg` |
| `frontend/icons/navigation/theme-system-icon.svg` | `.svg` |
| `frontend/icons/symbols/alert-circle.svg` | `.svg` |
| `frontend/icons/symbols/article.svg` | `.svg` |
| `frontend/icons/symbols/attachment.svg` | `.svg` |
| `frontend/icons/symbols/bolt-pattern.svg` | `.svg` |
| `frontend/icons/symbols/bookmark.svg` | `.svg` |
| `frontend/icons/symbols/build.svg` | `.svg` |
| `frontend/icons/symbols/building.svg` | `.svg` |
| `frontend/icons/symbols/calendar-clock.svg` | `.svg` |
| `frontend/icons/symbols/calendar.svg` | `.svg` |
| `frontend/icons/symbols/car.svg` | `.svg` |
| `frontend/icons/symbols/category.svg` | `.svg` |
| `frontend/icons/symbols/chat.svg` | `.svg` |
| `frontend/icons/symbols/check-circle.svg` | `.svg` |
| `frontend/icons/symbols/check_circle.svg` | `.svg` |
| `frontend/icons/symbols/clock.svg` | `.svg` |
| `frontend/icons/symbols/dashboard.svg` | `.svg` |
| `frontend/icons/symbols/database.svg` | `.svg` |
| `frontend/icons/symbols/description.svg` | `.svg` |
| `frontend/icons/symbols/eco.svg` | `.svg` |
| `frontend/icons/symbols/euro.svg` | `.svg` |
| `frontend/icons/symbols/file-text.svg` | `.svg` |
| `frontend/icons/symbols/folder.svg` | `.svg` |
| `frontend/icons/symbols/grid_view.svg` | `.svg` |
| `frontend/icons/symbols/group.svg` | `.svg` |
| `frontend/icons/symbols/group_filled.svg` | `.svg` |
| `frontend/icons/symbols/hash.svg` | `.svg` |
| `frontend/icons/symbols/help.svg` | `.svg` |
| `frontend/icons/symbols/home.svg` | `.svg` |
| `frontend/icons/symbols/hourglass.svg` | `.svg` |
| `frontend/icons/symbols/image.svg` | `.svg` |
| `frontend/icons/symbols/info.svg` | `.svg` |
| `frontend/icons/symbols/inventory.svg` | `.svg` |
| `frontend/icons/symbols/label.svg` | `.svg` |
| `frontend/icons/symbols/layers.svg` | `.svg` |
| `frontend/icons/symbols/link.svg` | `.svg` |
| `frontend/icons/symbols/list.svg` | `.svg` |
| `frontend/icons/symbols/location.svg` | `.svg` |
| `frontend/icons/symbols/login.svg` | `.svg` |
| `frontend/icons/symbols/logout.svg` | `.svg` |
| `frontend/icons/symbols/mail.svg` | `.svg` |
| `frontend/icons/symbols/map-pin.svg` | `.svg` |
| `frontend/icons/symbols/map.svg` | `.svg` |
| `frontend/icons/symbols/notifications.svg` | `.svg` |
| `frontend/icons/symbols/palette.svg` | `.svg` |
| `frontend/icons/symbols/payments.svg` | `.svg` |
| `frontend/icons/symbols/person.svg` | `.svg` |
| `frontend/icons/symbols/receipt.svg` | `.svg` |
| `frontend/icons/symbols/ruler.svg` | `.svg` |
| `frontend/icons/symbols/schedule.svg` | `.svg` |
| `frontend/icons/symbols/school.svg` | `.svg` |
| `frontend/icons/symbols/science.svg` | `.svg` |
| `frontend/icons/symbols/search.svg` | `.svg` |
| `frontend/icons/symbols/settings.svg` | `.svg` |
| `frontend/icons/symbols/shopping-bag.svg` | `.svg` |
| `frontend/icons/symbols/shopping_cart.svg` | `.svg` |
| `frontend/icons/symbols/star.svg` | `.svg` |
| `frontend/icons/symbols/store.svg` | `.svg` |
| `frontend/icons/symbols/table.svg` | `.svg` |
| `frontend/icons/symbols/tag.svg` | `.svg` |
| `frontend/icons/symbols/task.svg` | `.svg` |
| `frontend/icons/symbols/tune.svg` | `.svg` |
| `frontend/icons/symbols/user.svg` | `.svg` |
| `frontend/icons/symbols/warning.svg` | `.svg` |
| `frontend/icons/symbols/wrench.svg` | `.svg` |
| `frontend/imageERR.png` | `.png` |
| `frontend/public/auth-tour/platform-card-view.jpg` | `.jpg` |
| `frontend/public/auth-tour/platform-filterbar.jpg` | `.jpg` |
| `frontend/public/auth-tour/platform-full-shell.jpg` | `.jpg` |
| `frontend/public/auth-tour/platform-navbar.jpg` | `.jpg` |
| `frontend/public/auth-tour/platform-table-view.jpg` | `.jpg` |
| `frontend/reusable_components/vanilla_dropdown/chevron.svg` | `.svg` |
| `storage/10/1/1000/10_1_1.jpg` | `.jpg` |
| `storage/10/1/2160/10_1_1.jpg` | `.jpg` |
| `storage/10/1/300/10_1_1.jpg` | `.jpg` |
| `storage/10/1/original/10_1_1.jpg` | `.jpg` |
| `storage/7/1/1000/7_1_1.jpg` | `.jpg` |
| `storage/7/1/2160/7_1_1.jpg` | `.jpg` |
| `storage/7/1/300/7_1_1.jpg` | `.jpg` |
| `storage/7/1/original/7_1_1.jpg` | `.jpg` |
| `storage/8/1/1000/8_1_1.jpg` | `.jpg` |
| `storage/8/1/2160/8_1_1.jpg` | `.jpg` |
| `storage/8/1/300/8_1_1.jpg` | `.jpg` |
| `storage/8/1/original/8_1_1.jpg` | `.jpg` |
| `storage/9/1/1000/9_1_1.png` | `.png` |
| `storage/9/1/300/9_1_1.png` | `.png` |
| `storage/9/1/original/9_1_1.png` | `.png` |
| `storage/9/2/1000/9_2_1.png` | `.png` |
| `storage/9/2/300/9_2_1.png` | `.png` |
| `storage/9/2/original/9_2_1.png` | `.png` |
| `storage/9/3/1000/9_3_1.png` | `.png` |
| `storage/9/3/300/9_3_1.png` | `.png` |
| `storage/9/3/original/9_3_1.png` | `.png` |
