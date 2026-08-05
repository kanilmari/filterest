/**
 * W1_create_payment.spec.ts
 *
 * Verifies that the payment creation endpoint enforces service authentication and is wired.
 * A caller without the server's service token is rejected before gateway state is exposed.
 */

import { test, expect } from '@playwright/test';

test.describe('W1 — Create Payment', () => {
  test('payment creation endpoint reports the active gateway state', async ({ request }) => {
    const externalOrderId = `e2e-payment-${Date.now()}`;
    const serviceToken = process.env.MCP_SERVICE_TOKEN?.trim();
    const response = await request.post('/api/payments/create', {
      headers: serviceToken
        ? {
            Authorization: `Bearer ${serviceToken}`,
          }
        : undefined,
      data: {
        app_name: 'e2e',
        external_order_id: externalOrderId,
        customer_email: 'e2e@example.com',
        amount_cents: 100,
        currency: 'EUR',
        description: 'E2E payment probe',
        success_url: 'https://example.com/success',
        cancel_url: 'https://example.com/cancel',
        metadata: {},
      },
    });

    if (!serviceToken) {
      expect(response.status()).toBe(401);
      await expect(response.json()).resolves.toMatchObject({
        error: 'service_token_invalid',
      });
      return;
    }

    if (response.ok()) {
      const payload = await response.json();
      expect(payload.status).toBe('pending');
      expect(payload.payment_token).toBeTruthy();
      expect(payload.checkout_url).toMatch(/^https?:\/\//);
      return;
    }

    expect(response.status()).toBe(500);
    await expect(response.text()).resolves.toContain('payment gateway not initialized');
  });
});
