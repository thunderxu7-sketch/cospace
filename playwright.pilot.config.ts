import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/pilot",
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  use: {
    ...devices["Desktop Chrome"],
    baseURL: process.env.COSPACE_PILOT_TEST_ORIGIN,
    actionTimeout: 12_000,
    navigationTimeout: 15_000,
    trace: "retain-on-failure",
  },
});
