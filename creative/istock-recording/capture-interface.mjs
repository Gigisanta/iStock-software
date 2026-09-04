import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const baseUrl = process.env.ISTOCK_CAPTURE_BASE_URL ?? 'http://demo.localhost:3010';
const outputDir = process.env.ISTOCK_CAPTURE_OUTPUT ?? './creative/istock-recording/renders';
const homeUrl = `${baseUrl}/`;
const detailUrl = `${baseUrl}/p/iphone-14-pro-256-grafito`;

await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  colorScheme: 'light',
  recordVideo: {
    dir: outputDir,
    size: { width: 390, height: 844 },
  },
});
const page = await context.newPage();
page.setDefaultTimeout(15_000);

await page.route('**/*', async (route) => {
  if (route.request().url().startsWith('https://wa.me/')) {
    await route.abort();
    return;
  }
  await route.continue();
});

const hideDevTools = async () => {
  await page.addStyleTag({
    content: `
      nextjs-portal,
      [data-nextjs-dev-tools],
      [data-nextjs-dialog-overlay],
      [data-nextjs-dialog],
      [data-issues-open],
      [data-issues-collapse],
      [data-next-mark],
      .nextjs-toast { display: none !important; }
    `,
  });
};

const normalizeDemoCopy = async () => {
  // Keep the capture copy aligned with the brand rule: no long dash punctuation in visible text.
  // This only normalizes synthetic seed labels in the recording and does not mutate the app.
  await page.locator('body').evaluate((body) => {
    const replacements = new Map([
      ['iStock Demo — Alto Valle', 'iStock Demo / Alto Valle'],
      ['Lo quiero — escribir por WhatsApp', 'Lo quiero / escribir por WhatsApp'],
    ]);
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    let node = walker.nextNode();
    while (node) {
      textNodes.push(node);
      node = walker.nextNode();
    }
    for (const textNode of textNodes) {
      for (const [from, to] of replacements) {
        if (textNode.nodeValue?.includes(from)) {
          textNode.nodeValue = textNode.nodeValue.replaceAll(from, to);
        }
      }
    }
  });
};

await page.goto(homeUrl, { waitUntil: 'networkidle', timeout: 30_000 });
await hideDevTools();
await normalizeDemoCopy();
await page.screenshot({ path: `${outputDir}/storefront-mobile.png`, type: 'png' });
await page.waitForTimeout(700);

await page.locator('a[href="/p/iphone-14-pro-256-grafito"]').click();
await page.waitForLoadState('networkidle', { timeout: 30_000 });
await hideDevTools();
await normalizeDemoCopy();
await page.waitForTimeout(700);
await page.screenshot({ path: `${outputDir}/detail-mobile.png`, type: 'png' });

// `page.content()` also contains the app's CSS, where words such as `margin` are expected.
// Check the rendered public copy instead, which is the surface a buyer can actually see.
const publicCopy = (await page.locator('body').innerText()).toLowerCase();
for (const marker of ['imei', 'cost_usd', 'margin', 'internal_notes', 'supplier']) {
  if (publicCopy.includes(marker)) {
    throw new Error(`public leak detected in capture: ${marker}`);
  }
}

const cta = page.locator('a').filter({ hasText: /WhatsApp/i }).first();
if (await cta.count()) {
  await cta.scrollIntoViewIfNeeded();
  await page.waitForTimeout(900);
}

const video = page.video();
await page.close();
await context.close();
if (!video) throw new Error('Playwright did not create a video handle');

const videoPath = `${outputDir}/interface-demo.webm`;
await video.saveAs(videoPath);
await browser.close();

console.log(JSON.stringify({
  baseUrl,
  homeUrl,
  detailUrl,
  outputDir,
  videoPath,
  screenshots: [`${outputDir}/storefront-mobile.png`, `${outputDir}/detail-mobile.png`],
}));
