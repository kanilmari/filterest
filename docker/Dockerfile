# ==============================================================================
# Dockerfile: Multi-stage build for Filterest
# Stages: 1) Frontend build (Node.js), 2) Backend build (Go), 3) Production runtime
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Frontend Build (Node.js + Vite)
# ------------------------------------------------------------------------------
FROM node:24-alpine AS frontend-builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm ci --only=production=false

# Copy frontend source (vite.config.mjs is inside frontend/)
COPY frontend/ ./frontend/
COPY server_tools/lib/easelect_private_paths.mjs ./server_tools/lib/easelect_private_paths.mjs

# Build frontend for production
RUN npm run build

# ------------------------------------------------------------------------------
# Stage 2: Backend Build (Go)
# ------------------------------------------------------------------------------
FROM golang:1.26.5-alpine3.24 AS backend-builder

# Install build dependencies for the CGO-backed WebP encoder.
RUN apk add --no-cache \
    git=2.54.0-r0 \
    ca-certificates=20260611-r0 \
    gcc=15.2.0-r5 \
    musl-dev=1.2.6-r2 \
    libwebp-dev=1.6.0-r0

WORKDIR /app

# Copy go mod and sum files first (for caching)
COPY go.mod go.sum ./

# Download dependencies
RUN go mod download

# Copy backend source. Use a wildcard so private root-level registration files
# are included when present, while exported builds with only main.go still work.
COPY *.go ./
COPY backend/ ./backend/

# Build the application with production flag baked in
# Security: This binary can NEVER run in dev mode, even if ENVIRONMENT_TYPE=dev is set
RUN CGO_ENABLED=1 GOOS=linux go build -ldflags="-w -s -X main.buildEnv=prod" -o easelect .

# ------------------------------------------------------------------------------
# Stage 3: Production Runtime
# ------------------------------------------------------------------------------
FROM alpine:3.24

WORKDIR /app

ARG EASELECT_APP_VERSION=unknown
ARG EASELECT_DB_VERSION=unknown
ARG EASELECT_GIT_COMMIT=unknown
ARG EASELECT_RUNTIME_UID=1000
ARG EASELECT_RUNTIME_GID=1000

# The protected admin version panel reports this reviewed execution-mode enum.
ENV EASELECT_RUNTIME_MODE=docker

LABEL easelect.version_contract="1" \
      easelect.app_version="${EASELECT_APP_VERSION}" \
      easelect.db_version="${EASELECT_DB_VERSION}" \
      easelect.git_commit="${EASELECT_GIT_COMMIT}" \
      org.opencontainers.image.version="${EASELECT_APP_VERSION}" \
      org.opencontainers.image.revision="${EASELECT_GIT_COMMIT}"

# Install runtime dependencies
RUN apk add --no-cache \
    ca-certificates=20260611-r0 \
    bash=5.3.9-r1 \
    tzdata=2026c-r0 \
    libwebp=1.6.0-r0

# Create non-root user for security
RUN case "${EASELECT_RUNTIME_UID}:${EASELECT_RUNTIME_GID}" in \
        *[!0-9:]*|:*|*:) printf 'runtime UID/GID must be numeric\n' >&2; exit 1 ;; \
    esac && \
    [ "${EASELECT_RUNTIME_UID}" -ge 1000 ] && \
    [ "${EASELECT_RUNTIME_GID}" -ge 1000 ] && \
    addgroup -g "${EASELECT_RUNTIME_GID}" -S easelect && \
    adduser -u "${EASELECT_RUNTIME_UID}" -S easelect -G easelect

# Copy binary from backend builder
COPY --from=backend-builder /app/easelect .

# Copy frontend source for development mode (unbuilt assets)
COPY frontend/ ./frontend/

# Copy built frontend bundles last so tracked source dist cannot shadow the fresh build.
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Copy documentation and data
COPY docs/ ./docs/
# Copy migrations so existing production databases can receive reviewed schema updates.
COPY server_tools/migrations/ ./server_tools/migrations/
COPY VERSION_* ./
RUN app_file=""; app_version="${EASELECT_APP_VERSION}"; \
    if [ -f VERSION_EASELECT ]; then app_file="VERSION_EASELECT"; app_version="$(cat VERSION_EASELECT)"; \
    elif [ -f VERSION_APP ]; then app_file="VERSION_APP"; app_version="$(cat VERSION_APP)"; fi; \
    db_version="${EASELECT_DB_VERSION}"; \
    if [ -f VERSION_DB ]; then db_version="$(cat VERSION_DB)"; fi; \
    { \
      printf 'VERSION_CONTRACT=1\n'; \
      printf 'APP_VERSION=%s\n' "$app_version"; \
      printf 'APP_VERSION_FILE=%s\n' "$app_file"; \
      printf 'DB_VERSION=%s\n' "$db_version"; \
      printf 'GIT_COMMIT=%s\n' "${EASELECT_GIT_COMMIT}"; \
    } > easelect-runtime.env

# Create directories for runtime data
RUN mkdir -p storage storage_deleted db_backups && \
    chown -R easelect:easelect /app

# Switch to non-root user
USER easelect

# Expose port
EXPOSE 8082

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8082/health || exit 1

# Run the application
CMD ["./easelect"]
