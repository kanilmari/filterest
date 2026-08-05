// payment_callback_target_test.go
// Verifies that completion callbacks use only server-owned app targets.
// Exists to prevent payment request data from becoming a stored SSRF primitive.

package payment_gateway

import (
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const (
	testPaymentCallbackAppName = "test-app"
	testPaymentCallbackBaseEnv = "TEST_PAYMENT_CALLBACK_BASE_URL"
	testPaymentCallbackPath    = "/api/app/test-payment/payment-callback"
)

func registerPaymentCallbackTargetForTest(t *testing.T) {
	t.Helper()

	paymentCallbackTargetsMu.Lock()
	previousTarget, hadPreviousTarget := paymentCallbackTargets[testPaymentCallbackAppName]
	delete(paymentCallbackTargets, testPaymentCallbackAppName)
	paymentCallbackTargetsMu.Unlock()

	if err := RegisterPaymentCallbackTarget(
		testPaymentCallbackAppName,
		[]string{testPaymentCallbackBaseEnv, "BASE_URL"},
		testPaymentCallbackPath,
	); err != nil {
		t.Fatalf("register test payment callback target: %v", err)
	}
	t.Cleanup(func() {
		paymentCallbackTargetsMu.Lock()
		defer paymentCallbackTargetsMu.Unlock()
		if hadPreviousTarget {
			paymentCallbackTargets[testPaymentCallbackAppName] = previousTarget
		} else {
			delete(paymentCallbackTargets, testPaymentCallbackAppName)
		}
	})
}

func TestCreatePaymentRejectsCallerManagedCallbackTargets(t *testing.T) {
	testCases := []struct {
		name string
		req  PaymentRequest
	}{
		{
			name: "top-level private target",
			req: PaymentRequest{
				CallbackURL: "http://127.0.0.1:5433/private",
			},
		},
		{
			name: "metadata remote target",
			req: PaymentRequest{
				Metadata: map[string]string{"callback_url": "https://attacker.example/capture"},
			},
		},
		{
			name: "metadata reserved key without a value",
			req: PaymentRequest{
				Metadata: map[string]string{"callback_url": ""},
			},
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			response, err := CreatePayment(testCase.req)
			if !errors.Is(err, ErrCallerManagedPaymentCallback) {
				t.Fatalf("CreatePayment error = %v, want ErrCallerManagedPaymentCallback", err)
			}
			if response != nil {
				t.Fatalf("CreatePayment response = %#v, want nil", response)
			}
		})
	}
}

func TestCreatePaymentHandlerRejectsCallerManagedCallbackTargetAsBadRequest(t *testing.T) {
	t.Setenv("MCP_SERVICE_TOKEN", "test-token")
	body := `{
		"app_name":"test-app",
		"customer_email":"buyer@example.com",
		"amount_cents":499,
		"metadata":{"callback_url":"http://169.254.169.254/latest/meta-data"}
	}`
	req := httptest.NewRequest(http.MethodPost, "/api/payments/create", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer test-token")
	rr := httptest.NewRecorder()

	CreatePaymentHandler(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("CreatePaymentHandler status = %d, want 400", rr.Code)
	}
	if !strings.Contains(rr.Body.String(), "callback_url_server_managed") {
		t.Fatalf("CreatePaymentHandler body = %q", rr.Body.String())
	}
}

func TestRegisterPaymentCallbackTargetRejectsUnsafeConfigurationAndDuplicates(t *testing.T) {
	testCases := []struct {
		name     string
		appName  string
		baseEnvs []string
		callback string
	}{
		{name: "empty app", appName: "", baseEnvs: []string{"BASE_URL"}, callback: "/api/callback"},
		{name: "invalid app", appName: "../private", baseEnvs: []string{"BASE_URL"}, callback: "/api/callback"},
		{name: "no origin environments", appName: "safe-app", callback: "/api/callback"},
		{name: "invalid origin environment", appName: "safe-app", baseEnvs: []string{"bad-env"}, callback: "/api/callback"},
		{name: "remote callback URL", appName: "safe-app", baseEnvs: []string{"BASE_URL"}, callback: "https://attacker.example/callback"},
		{name: "callback query", appName: "safe-app", baseEnvs: []string{"BASE_URL"}, callback: "/api/callback?next=private"},
		{name: "callback traversal", appName: "safe-app", baseEnvs: []string{"BASE_URL"}, callback: "/api/private/../callback"},
		{name: "callback backslash", appName: "safe-app", baseEnvs: []string{"BASE_URL"}, callback: `/api/private\callback`},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			if err := RegisterPaymentCallbackTarget(testCase.appName, testCase.baseEnvs, testCase.callback); err == nil {
				t.Fatal("RegisterPaymentCallbackTarget returned nil error for unsafe configuration")
			}
		})
	}

	registerPaymentCallbackTargetForTest(t)
	if err := RegisterPaymentCallbackTarget(
		testPaymentCallbackAppName,
		[]string{testPaymentCallbackBaseEnv},
		testPaymentCallbackPath,
	); err == nil {
		t.Fatal("RegisterPaymentCallbackTarget returned nil error for duplicate app")
	}
}

func TestRegisterPaymentCallbackTargetCopiesOriginEnvironmentNames(t *testing.T) {
	const appName = "copy-test-app"
	envNames := []string{"COPY_TEST_PAYMENT_BASE_URL"}
	if err := RegisterPaymentCallbackTarget(appName, envNames, "/api/copy-test/callback"); err != nil {
		t.Fatalf("RegisterPaymentCallbackTarget returned error: %v", err)
	}
	t.Cleanup(func() {
		paymentCallbackTargetsMu.Lock()
		delete(paymentCallbackTargets, appName)
		paymentCallbackTargetsMu.Unlock()
	})

	envNames[0] = "MUTATED_PAYMENT_BASE_URL"
	t.Setenv("COPY_TEST_PAYMENT_BASE_URL", "https://payments.example")
	t.Setenv("MUTATED_PAYMENT_BASE_URL", "https://attacker.example")
	callbackURL, configured, err := paymentCallbackURLForApp(appName)
	if err != nil || !configured || callbackURL != "https://payments.example/api/copy-test/callback" {
		t.Fatalf("paymentCallbackURLForApp = (%q, %v, %v), want copied origin environment", callbackURL, configured, err)
	}
}

func TestPaymentCallbackTargetRegistrySupportsConcurrentRegistrationAndReads(t *testing.T) {
	const (
		concurrentTargets = 20
		baseEnv           = "CONCURRENT_TEST_PAYMENT_BASE_URL"
	)
	t.Setenv(baseEnv, "http://127.0.0.1:8082")
	t.Setenv("ENVIRONMENT_TYPE", "dev")

	errCh := make(chan error, concurrentTargets)
	for index := 0; index < concurrentTargets; index++ {
		index := index
		go func() {
			appName := fmt.Sprintf("concurrent-app-%d", index)
			callbackPath := fmt.Sprintf("/api/concurrent/%d/callback", index)
			if err := RegisterPaymentCallbackTarget(appName, []string{baseEnv}, callbackPath); err != nil {
				errCh <- err
				return
			}
			callbackURL, configured, err := paymentCallbackURLForApp(appName)
			if err != nil || !configured || callbackURL != "http://127.0.0.1:8082"+callbackPath {
				errCh <- fmt.Errorf("target %d lookup = (%q, %v, %v)", index, callbackURL, configured, err)
				return
			}
			errCh <- nil
		}()
	}
	for index := 0; index < concurrentTargets; index++ {
		if err := <-errCh; err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() {
		paymentCallbackTargetsMu.Lock()
		defer paymentCallbackTargetsMu.Unlock()
		for index := 0; index < concurrentTargets; index++ {
			delete(paymentCallbackTargets, fmt.Sprintf("concurrent-app-%d", index))
		}
	})
}

func TestPaymentCallbackURLForAppUsesOnlyServerConfiguredOrigin(t *testing.T) {
	registerPaymentCallbackTargetForTest(t)
	t.Setenv("BASE_URL", "")

	testCases := []struct {
		name    string
		baseURL string
		envType string
		wantURL string
	}{
		{
			name:    "native private origin",
			baseURL: "http://127.0.0.1:8082",
			envType: "dev",
			wantURL: "http://127.0.0.1:8082" + testPaymentCallbackPath,
		},
		{
			name:    "production remote origin",
			baseURL: "https://payments.example",
			envType: "prod",
			wantURL: "https://payments.example" + testPaymentCallbackPath,
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Setenv(testPaymentCallbackBaseEnv, testCase.baseURL)
			t.Setenv("ENVIRONMENT_TYPE", testCase.envType)
			gotURL, configured, err := paymentCallbackURLForApp(testPaymentCallbackAppName)
			if err != nil {
				t.Fatalf("paymentCallbackURLForApp returned error: %v", err)
			}
			if !configured || gotURL != testCase.wantURL {
				t.Fatalf("paymentCallbackURLForApp = (%q, %v), want (%q, true)", gotURL, configured, testCase.wantURL)
			}
		})
	}
}

func TestPaymentCallbackURLForAppRejectsPlaintextOutsideNativeLoopbackDevelopment(t *testing.T) {
	registerPaymentCallbackTargetForTest(t)
	t.Setenv("BASE_URL", "")
	testCases := []struct {
		name    string
		baseURL string
		envType string
	}{
		{name: "production loopback", baseURL: "http://127.0.0.1:8082", envType: "prod"},
		{name: "development remote host", baseURL: "http://payments.example", envType: "dev"},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Setenv(testPaymentCallbackBaseEnv, testCase.baseURL)
			t.Setenv("ENVIRONMENT_TYPE", testCase.envType)
			callbackURL, configured, err := paymentCallbackURLForApp(testPaymentCallbackAppName)
			if err == nil || !configured || callbackURL != "" {
				t.Fatalf("paymentCallbackURLForApp = (%q, %v, %v), want configured HTTPS error", callbackURL, configured, err)
			}
		})
	}
}

func TestPaymentCallbackURLForAppRejectsInvalidServerOrigin(t *testing.T) {
	registerPaymentCallbackTargetForTest(t)
	t.Setenv("BASE_URL", "")
	for _, invalidOrigin := range []string{
		"https://user:password@payments.example",
		"https://payments.example/prefix",
		"https://payments.example?target=elsewhere",
		"file:///tmp/callback",
	} {
		t.Run(invalidOrigin, func(t *testing.T) {
			t.Setenv(testPaymentCallbackBaseEnv, invalidOrigin)
			callbackURL, configured, err := paymentCallbackURLForApp(testPaymentCallbackAppName)
			if err == nil || !configured || callbackURL != "" {
				t.Fatalf("paymentCallbackURLForApp = (%q, %v, %v), want configured error", callbackURL, configured, err)
			}
		})
	}
}

func TestPaymentCallbackURLForAppUsesBaseURLFallback(t *testing.T) {
	registerPaymentCallbackTargetForTest(t)
	t.Setenv(testPaymentCallbackBaseEnv, "")
	t.Setenv("BASE_URL", "https://easelect.example")

	callbackURL, configured, err := paymentCallbackURLForApp(testPaymentCallbackAppName)
	if err != nil || !configured || callbackURL != "https://easelect.example"+testPaymentCallbackPath {
		t.Fatalf("paymentCallbackURLForApp = (%q, %v, %v), want BASE_URL fallback", callbackURL, configured, err)
	}
}

func TestPaymentCallbackURLForAppFailsClosedWithoutServerOrigin(t *testing.T) {
	registerPaymentCallbackTargetForTest(t)
	t.Setenv(testPaymentCallbackBaseEnv, "")
	t.Setenv("BASE_URL", "")

	callbackURL, configured, err := paymentCallbackURLForApp(testPaymentCallbackAppName)
	if err == nil || !configured || callbackURL != "" {
		t.Fatalf("paymentCallbackURLForApp = (%q, %v, %v), want configured error", callbackURL, configured, err)
	}
}

func TestPaymentCallbackURLForUnknownAppIsNotConfigured(t *testing.T) {
	t.Setenv(testPaymentCallbackBaseEnv, "https://payments.example")
	callbackURL, configured, err := paymentCallbackURLForApp("untrusted-app")
	if err != nil || configured || callbackURL != "" {
		t.Fatalf("paymentCallbackURLForApp = (%q, %v, %v), want unconfigured", callbackURL, configured, err)
	}
}

func TestDeliverCompletedPaymentCallbackIgnoresPersistedMetadataTargets(t *testing.T) {
	registerPaymentCallbackTargetForTest(t)
	t.Setenv(paymentCallbackSecretEnv, "callback-test-secret")
	t.Setenv("ENVIRONMENT_TYPE", "dev")
	requestCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount++
		if r.URL.Path != testPaymentCallbackPath {
			t.Errorf("callback path = %q", r.URL.Path)
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Errorf("read callback body: %v", err)
		}
		if err := VerifyPaymentCallbackSignature(body, r.Header.Get(PaymentCallbackSignatureHeader)); err != nil {
			t.Errorf("verify callback signature: %v", err)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	t.Setenv(testPaymentCallbackBaseEnv, server.URL)

	db, drv := newWebhookTestDBWithQueryRow(0, []string{"app_name", "status"}, []driver.Value{testPaymentCallbackAppName, "completed"})
	defer db.Close()
	withDB(t, db)

	delivered, err := deliverCompletedPaymentCallback("rev-order-123")
	if err != nil {
		t.Fatalf("deliverCompletedPaymentCallback returned error: %v", err)
	}
	if !delivered || requestCount != 1 {
		t.Fatalf("delivery = (%v, %d requests), want (true, 1)", delivered, requestCount)
	}
	if len(drv.queryQueries) != 1 || strings.Contains(drv.queryQueries[0], "metadata") || !strings.Contains(drv.queryQueries[0], "app_name") {
		t.Fatalf("callback target query = %#v, want app_name only", drv.queryQueries)
	}
}

func TestDeliverCompletedPaymentCallbackDoesNotDeliverTerminalFailure(t *testing.T) {
	registerPaymentCallbackTargetForTest(t)
	t.Setenv(paymentCallbackSecretEnv, "callback-test-secret")
	t.Setenv(testPaymentCallbackBaseEnv, "https://payments.example")
	db, _ := newWebhookTestDBWithQueryRow(0, []string{"app_name", "status"}, []driver.Value{testPaymentCallbackAppName, "failed"})
	defer db.Close()
	withDB(t, db)

	delivered, err := deliverCompletedPaymentCallback("rev-order-123")
	if err != nil || delivered {
		t.Fatalf("deliverCompletedPaymentCallback = (%v, %v), want (false, nil)", delivered, err)
	}
}
