import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  expect: { timeout: 12000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:3027",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    timezoneId: "Asia/Shanghai",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 960 },
      },
    },
    {
      name: "firefox",
      testMatch: "workspace.spec.ts",
      use: {
        ...devices["Desktop Firefox"],
        viewport: { width: 1440, height: 960 },
      },
    },
    {
      name: "webkit",
      testMatch: "workspace.spec.ts",
      use: {
        ...devices["Desktop Safari"],
        viewport: { width: 1440, height: 960 },
      },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:3027",
    reuseExistingServer: true,
    timeout: 120000,
  },
});
