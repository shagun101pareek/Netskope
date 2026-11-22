import { chromium, type Browser } from "playwright";

let browserPromise: Promise<Browser> | undefined;

/**
 * One Chromium process for this worker. Each scan opens its own context.
 * Playwright talks to the browser over its pipe. This does not pass a
 * remote debugging port and does not call launchServer.
 */
export function launchBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium
      .launch({
        headless: true,
        handleSIGINT: false,
        handleSIGTERM: false,
        handleSIGHUP: false,
        args: ["--disable-dev-shm-usage"],
      })
      .catch((error: unknown) => {
        browserPromise = undefined;
        throw error;
      });
  }

  return browserPromise;
}

export async function closeBrowser(): Promise<void> {
  const pending = browserPromise;
  browserPromise = undefined;
  if (!pending) {
    return;
  }

  const browser = await pending.catch(() => undefined);
  await browser?.close();
}
