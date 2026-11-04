// Browser tests: screenshots of the /dev/ui style guide, so visual changes to the design system are seen and approved.
import { defineConfig } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default defineConfig({
  testDir: "e2e",
  testMatch: "*.e2e.ts",
  // Outside the project: files written under web/ trigger dev-server rebuilds, which reload the page mid-screenshot.
  outputDir: join(tmpdir(), "sourcejump-playwright"),
  expect: {
    timeout: 15_000,
    toHaveScreenshot: {
      // An absolute limit: a ratio of a tall page would let whole changed words through.
      maxDiffPixels: 50,
      // Per-pixel color tolerance. Exact: the default (0.2) misses token tweaks like a slightly lighter border.
      threshold: 0,
      // Hiding the caret edits inputs before React hydrates, which Next reports as a mismatch.
      caret: "initial",
      stylePath: join(__dirname, "e2e/screenshot.css"),
    },
  },
  projects: [
    {
      name: "chrome",
      use: {
        // The system's Chrome, so contributors don't need Playwright's browser download.
        channel: "chrome",
        baseURL: "http://localhost:3000",
        viewport: { width: 1280, height: 800 },
        colorScheme: "dark",
        // Count-ups and entrances show their end state, so screenshots are stable.
        reducedMotion: "reduce",
      },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000/dev/ui",
    // `just dev` may already be running; Next allows only one dev server per checkout.
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
