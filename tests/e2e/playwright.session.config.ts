import { defineConfig } from "@playwright/test";

// Keep the normal local-mode suite separate from SDK-authenticated session tests.
process.env.PAYMENT_SESSION_E2E = "1";

export default defineConfig({
  testDir: ".",
  testMatch: "payments-session.spec.ts",
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:3101",
    trace: "retain-on-failure",
    channel: process.env.CI ? undefined : "chrome",
  },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3101",
    url: "http://127.0.0.1:3101/login",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ALLOW_UNAUTHENTICATED_LOCAL: "false",
      DB_PROVIDER: "sqlite",
      SQLITE_DB_PATH: "/tmp/stellar-toolkit-session-e2e.db",
      SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_SERVICE_ROLE_KEY: "session-test-service-key",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "session-test-anon-key",
      SIGNING_KEY_ENCRYPTION_KEY: "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=",
      MAINNET_TRANSACTIONS_ENABLED: "false",
    },
  },
});
