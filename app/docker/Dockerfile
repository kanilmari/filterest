# Builds the standalone public Filterest application image.
# Connects canonical backend and frontend source to one non-root runtime image.
# Keeps a transferred source folder buildable without embedding-product content.
# The companion Compose contract supplies its database and persistent volumes.
FROM node:24-alpine AS frontend-builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY frontend/ ./frontend/
COPY server_tools/lib/easelect_private_paths.mjs ./server_tools/lib/easelect_private_paths.mjs
RUN npm run build

FROM golang:1.26.5-alpine3.24 AS backend-builder

RUN apk add --no-cache \
    ca-certificates=20260611-r0 \
    gcc=15.2.0-r5 \
    git=2.54.0-r0 \
    libwebp-dev=1.6.0-r0 \
    musl-dev=1.2.6-r2

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY main.go ./
COPY backend/ ./backend/
COPY server_tools/admin_credential_recovery/ ./server_tools/admin_credential_recovery/

RUN CGO_ENABLED=1 GOOS=linux go build \
    -ldflags="-w -s -X main.buildEnv=prod" \
    -o filterest .
RUN CGO_ENABLED=1 GOOS=linux go build \
    -ldflags="-w -s" \
    -o filterest-admin-recovery ./server_tools/admin_credential_recovery

# Selects the derived release identity when a generated public checkout has it.
# Canonical source-only copies may omit it; those images stay usable but report
# only unverified VERSION markers instead of inventing a release identity.
FROM alpine:3.24 AS release-identity-selector

WORKDIR /release-identity

COPY . /source
RUN mkdir -p ./selected && \
    if [ -f /source/BUILD_IDENTITY.json ] && [ ! -L /source/BUILD_IDENTITY.json ]; then \
        cp /source/BUILD_IDENTITY.json ./selected/BUILD_IDENTITY.json; \
    elif [ -e /source/BUILD_IDENTITY.json ] || [ -L /source/BUILD_IDENTITY.json ]; then \
        printf 'BUILD_IDENTITY.json must be a regular file\n' >&2; \
        exit 1; \
    fi

FROM alpine:3.24

WORKDIR /filterest/app

ARG FILTEREST_APP_VERSION=unknown
ARG FILTEREST_DB_VERSION=unknown
ARG FILTEREST_GIT_COMMIT=unknown
ARG FILTEREST_RUNTIME_UID=1000
ARG FILTEREST_RUNTIME_GID=1000

ENV EASELECT_RUNTIME_MODE=docker \
    FILTEREST_ROOT=/filterest \
    FILTEREST_APPLICATION_ROOT=/filterest/app

LABEL org.opencontainers.image.title="Filterest" \
      org.opencontainers.image.version="${FILTEREST_APP_VERSION}" \
      org.opencontainers.image.revision="${FILTEREST_GIT_COMMIT}" \
      filterest.db_version="${FILTEREST_DB_VERSION}"

RUN apk add --no-cache \
    bash=5.3.9-r1 \
    ca-certificates=20260611-r0 \
    libwebp=1.6.0-r0 \
    tzdata=2026c-r0

RUN case "${FILTEREST_RUNTIME_UID}:${FILTEREST_RUNTIME_GID}" in \
        *[!0-9:]*|:*|*:) printf 'runtime UID/GID must be numeric\n' >&2; exit 1 ;; \
    esac && \
    [ "${FILTEREST_RUNTIME_UID}" -ge 1 ] && \
    [ "${FILTEREST_RUNTIME_GID}" -ge 1 ] && \
    runtime_group="$(awk -F: -v gid="${FILTEREST_RUNTIME_GID}" '$3 == gid { print $1; exit }' /etc/group)" && \
    if [ -z "$runtime_group" ]; then \
        addgroup -g "${FILTEREST_RUNTIME_GID}" -S filterest; \
        runtime_group=filterest; \
    fi && \
    adduser -u "${FILTEREST_RUNTIME_UID}" -S filterest -G "$runtime_group"

COPY --from=backend-builder /app/filterest ./filterest
COPY --from=backend-builder /app/filterest-admin-recovery ./filterest-admin-recovery
COPY frontend/ ./frontend/
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist
COPY docs/ ./docs/
COPY go.mod ./go.mod
COPY --from=release-identity-selector /release-identity/selected/ ./
RUN mkdir -p ./server_tools/versioning
COPY server_tools/versioning/release_ledger.v1.jsonl ./server_tools/versioning/release_ledger.v1.jsonl
COPY VERSION_* ./
COPY docker/docker-entrypoint.sh ./docker/docker-entrypoint.sh

RUN mkdir -p \
        /filterest/config \
        /filterest/keys/tls \
        /filterest/projects \
        /filterest/data/storage \
        /filterest/data/storage_deleted \
        /filterest/data/runtime \
        /filterest/backups && \
    chmod -R a-w /filterest/app

USER filterest

EXPOSE 8082

HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=12 \
    CMD if [ "${FILTEREST_LOCAL_TLS:-}" = "true" ] || [ "${FILTEREST_LOCAL_TLS:-}" = "1" ]; then \
          wget --no-verbose --tries=1 --spider --no-check-certificate https://127.0.0.1:8082/health; \
        else \
          wget --no-verbose --tries=1 --spider http://127.0.0.1:8082/health; \
        fi

ENTRYPOINT ["/filterest/app/docker/docker-entrypoint.sh"]
CMD ["/filterest/app/filterest"]
