import { defineConfig } from "@playwright/test";

// UI tests against mock mode (npm run dev:mock): in-memory database,
// simulated charger, no real Zaptec/Smartcar/push. They share one server and
// one in-memory database, so they run serially and each test sets up its own
// state through the /dev/mock presets. Uses the installed Microsoft Edge
// (channel "msedge") so no Playwright browser download is needed.
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3100",
    channel: "msedge",
    locale: "nb-NO",
    timezoneId: "Europe/Oslo",
    viewport: { width: 390, height: 844 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/dev-mock.mjs",
    url: "http://localhost:3100/login",
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
