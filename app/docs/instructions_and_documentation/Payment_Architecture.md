# Payment Architecture

Filterest embeds a Revolut Merchant API integration as a core component, available to all hosted applications.

See also: **Security.md § 8 — Payment Security (maintained in the private maintenance shell)** for the security model.

---

## Overview

The payment gateway lives in `filterest/app/backend/core_components/payment_gateway/` and is registered for every app instance in `filterest/app/backend/core_components/router/router_for_apps.go`. It is not app-specific — any Filterest application can create payments by calling the shared API endpoints.

---

## Endpoints

| Method | Path | Handler | Auth model |
|--------|------|---------|-----------|
| `POST` | `/api/payments/create` | `CreatePaymentHandler` | `PublicProfile` — bearer `MCP_SERVICE_TOKEN` (narrow explicit-dev fallback only when unset) |
| `POST` | `/api/payments/webhook` | `WebhookHandler` | `PublicProfile` — timestamped Revolut v1 HMAC-SHA256 verification |
| `GET` | `/api/payments/{token}/status` | `GetPaymentStatusHandler` | `PublicProfile` — opaque UUID token is the credential |

All three routes use `PublicProfile` in `filterest/app/backend/pipeline/route_profiles.go` (lines 101–104), meaning Filterest's session/CSRF middleware is not applied. Each endpoint enforces its own authentication mechanism.

---

## Request Flow: Payment Creation

```
Client → POST /api/payments/create
         ↓
  CreatePaymentHandler
         ↓
  Service-token authentication, 64 KiB body limit, and single-JSON-value validation
  Reject caller-controlled callback_url fields
         ↓
  RevolutClient.CreateOrder → POST https://merchant.revolut.com/api/orders
         ↓
  INSERT INTO payments (status='pending', revolut_order_id, revolut_checkout_url, payment_token=gen_random_uuid())
         ↓
  Response: { payment_id, payment_token, checkout_url, status: "pending" }
```

The caller redirects the end user to `checkout_url`. The `payment_token` (a
UUID) is the only credential needed for subsequent status checks. A database
insert failure fails the request; an unpersisted provider order is never
returned as a usable checkout.

---

## Request Flow: Payment Status

```
Client → GET /api/payments/{token}/status
         ↓
  SELECT from payments WHERE payment_token = $1
         ↓
  [if status is pending/authorised AND revolut_order_id present]
    RevolutClient.GetOrder → GET /api/orders/{revolut_order_id}
    Apply the provider state only through the forward-only transition predicate
    Set paid_at and deliver the app callback only for completed
         ↓
  Response: { payment_id, payment_token, status, amount_cents, currency, paid_at, revolut_order_id, created_at }
```

This live-check pattern means status is eventually consistent without requiring a working webhook.

---

## Request Flow: Webhook

```
Revolut → POST /api/payments/webhook
           ↓
  Read a bounded body and require one Revolut-Request-Timestamp header
  Verify Revolut-Signature v1 HMAC over "v1.<timestamp>.<raw body>"
  Reject stale/future timestamps outside the five-minute tolerance
  Fail closed if REVOLUT_WEBHOOK_SECRET is not set → 500
           ↓
  Parse WebhookPayload { event, order_id }
  Map ORDER_AUTHORISED / COMPLETED / FAILED / CANCELLED to local status
           ↓
  UPDATE payments only when the explicit forward-only predicate allows it
           ↓
  If event is completed, resolve callback from persisted app_name and
  server-owned origin configuration, then deliver synchronously
  Duplicate completed delivery retries the idempotent app claim
           ↓
  200 OK on success; 502 on callback failure so the provider retries
```

---

## Database Schema

```sql
CREATE TABLE IF NOT EXISTS payments (
    id                    SERIAL PRIMARY KEY,
    app_name              VARCHAR(100) NOT NULL,
    external_order_id     VARCHAR(255),
    customer_email        VARCHAR(255) NOT NULL,
    amount_cents          INTEGER NOT NULL,
    currency              VARCHAR(3) NOT NULL DEFAULT 'EUR',
    status                VARCHAR(50) NOT NULL DEFAULT 'pending',  -- pending|authorised|completed|failed|cancelled
    revolut_order_id      VARCHAR(255),
    revolut_checkout_url  TEXT,
    metadata              JSONB DEFAULT '{}',
    payment_token         UUID DEFAULT gen_random_uuid(),          -- opaque credential for status checks
    paid_at               TIMESTAMPTZ,
    webhook_received_at   TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Indexes: `idx_payments_token` (payment_token), `idx_payments_revolut_order_id`, `idx_payments_app_name`.

The table is created idempotently at startup via `ensurePaymentsTable()` (payments_handlers.go:95).

### `metadata` JSONB field

The `metadata` field stores app purchase facts from `PaymentRequest.Metadata`.
`callback_url` is explicitly rejected in both the top-level request and
metadata. Callback destinations never come from caller-controlled or persisted
metadata.

---

## Configuration

| Variable | Source | Required | Purpose |
|----------|--------|----------|---------|
| `REVOLUT_MERCHANT_API_SECRET_KEY` | `revolut.env` or env | **Yes** | Bearer token for Revolut API |
| `REVOLUT_MERCHANT_API_PUBLIC_KEY` | `revolut.env` or env | No | Public key (stored, not currently used in requests) |
| `REVOLUT_WEBHOOK_SECRET` | env | **Yes** (for webhooks) | HMAC-SHA256 webhook signature key |
| `PAYMENT_CALLBACK_SECRET` | env | **Yes** (for app fulfillment callbacks) | HMAC-SHA256 key for payment-gateway → app callbacks |
| `TUKISUU_BASE_URL` | env | **Yes** for Tukisuu fulfillment | Server-owned HTTPS origin for the exact Tukisuu callback path; native dev may use only HTTP loopback, and `BASE_URL` is the fallback |
| `SANDBOX_MODE` | `revolut.env` or env | No | `true` → sandbox-merchant.revolut.com |

Config is loaded from `filterest/app/backend/core_components/payment_gateway/revolut.env` first, then falls back to already-set environment variables (for Docker deployments).

**API version:** `2024-09-01` (set via `Revolut-Api-Version` header).

---

## Payment Status Lifecycle

```
pending    → authorised → completed
pending    → completed
pending    → failed | cancelled
authorised → failed | cancelled
```

Completed, failed, and cancelled are terminal. The same SQL predicate protects
webhook and live-status updates, and `RowsAffected` is checked before an
in-memory status is reported as changed.

---

## Callback Mechanism

When a payment completes, the gateway maps persisted `app_name` to an exact
server-owned path. For Tukisuu, only
`<TUKISUU_BASE_URL or BASE_URL>/api/app/tukisuu/payment-callback` is allowed;
the configured base must be a plain HTTP(S) origin without user info, path,
query, or fragment. Plain HTTP is accepted only for loopback hosts while
`ENVIRONMENT_TYPE=dev`; production-like and remote callback origins require
HTTPS. Redirects are not followed. The synchronous delivery POSTs:

```json
{ "revolut_order_id": "<id>", "status": "completed" }
```

Delivery has a 15-second timeout. A webhook returns HTTP 502 when delivery
fails, causing a provider retry. A completed status lookup may also retry
delivery. The Tukisuu claim is idempotent, so duplicate attempts cannot grant
credit twice.

The payment gateway signs the exact JSON body with `PAYMENT_CALLBACK_SECRET` and
sends the hex HMAC-SHA256 value in `X-Filterest-Payment-Signature`. Callback
delivery fails closed when the secret is empty. Tukisuu verifies the signature,
then reloads the authoritative payment row and validates `app_name`, provider
status, amount, currency, customer email, package, and message count. A single
database statement records `metadata.tukisuu_fulfilled_at` and inserts the credit
row, so callback retries and concurrent deliveries cannot grant credit twice.

---

## Sandbox vs Production

Set `SANDBOX_MODE=true` in `revolut.env` to use `https://sandbox-merchant.revolut.com/api`. The active mode is logged at startup:

```
[payment-gateway] ✅ Initialized in SANDBOX mode
```

---

## Implementation Files

| File | Purpose |
|------|---------|
| `filterest/app/backend/core_components/payment_gateway/payments_handlers.go` | HTTP handlers, DB logic, webhook verification |
| `filterest/app/backend/core_components/payment_gateway/revolut_client.go` | Revolut API client (CreateOrder, GetOrder) |
| `filterest/app/backend/core_components/router/router_for_apps.go` | Route registration |
| `filterest/app/backend/pipeline/route_profiles.go:101–104` | Pipeline profile declarations |
