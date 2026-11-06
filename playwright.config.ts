import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 3390);

// Always the production build: the old site's worst bug, 0 WPM for everyone, only existed there.
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: `http://localhost:${port}`, trace: "retain-on-failure" },
  projects: [{ name: "desktop", use: devices["Desktop Chrome"] }],
  webServer: { command: `npx next start -p ${port}`, port, reuseExistingServer: !process.env.CI, stdout: "pipe" },
});
