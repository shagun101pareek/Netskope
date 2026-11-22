import { mkdir } from "node:fs/promises";
import { chromium } from "../apps/worker/node_modules/playwright/index.mjs";

const web = "http://localhost:3010";
const email = `day14-${Date.now()}@example.com`;
const password = "correct-horse-battery";
const out = new URL("../docs/screenshots/", import.meta.url);

await mkdir(out, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(60_000);

try {
  await page.goto(`${web}/login`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Sign in" }).waitFor();
  await page.screenshot({ path: new URL("login.png", out).pathname });

  await page.goto(`${web}/register`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/app", { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Scans" }).waitFor();
  await page.screenshot({ path: new URL("dashboard.png", out).pathname });

  await page.getByRole("button", { name: "Start scan" }).click();
  const scanLink = page.getByRole("link", { name: "https://example.com/" });
  await scanLink.waitFor();
  await scanLink.click();
  await page.waitForURL("**/app/scans/**", { waitUntil: "domcontentloaded" });
  await page.getByText("COMPLETED", { exact: true }).waitFor({ timeout: 60_000 });
  await page.getByRole("cell", { name: "DOCUMENT" }).first().waitFor();
  await page.screenshot({ path: new URL("inspector.png", out).pathname });

  await page.getByRole("cell", { name: "DOCUMENT" }).first().click();
  await page.getByRole("button", { name: "timing" }).click();
  await page.getByText("Total:").waitFor();
  await page.screenshot({ path: new URL("request-detail.png", out).pathname });
  await page.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "waterfall" }).click();
  await page.screenshot({ path: new URL("waterfall.png", out).pathname });

  await page.getByRole("button", { name: "analytics" }).click();
  await page.getByText("Latency distribution").waitFor();
  await page.screenshot({ path: new URL("analytics.png", out).pathname });

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "CSV" }).click();
  const download = await downloadPromise;
  if (!download.suggestedFilename().endsWith(".csv")) {
    throw new Error(`Unexpected download name: ${download.suggestedFilename()}`);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${web}/app`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Scans" }).waitFor();
  await page.screenshot({ path: new URL("dashboard-mobile.png", out).pathname });

  console.log(`verified ${email}`);
} finally {
  await browser.close();
}
