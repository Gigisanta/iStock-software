// Captures crisp UI states of the real app (storefront + panel) for the v10 reel.
// Run: node scripts/capture-v10.mjs  (dev server on :3101, demo tenant seeded)
import { chromium } from 'playwright';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BASE = 'http://localhost:3101';
const STORE = 'http://demo.localhost:3101';
const OUT = path.resolve('public/v10/ui');
const PHOTOS = path.resolve('public/v10/photos');

// alt substring → local jpg (unit photos are injected because dev has no R2)
const PHOTO_MAP = [
  ['iPhone 14 Pro 256 GB Negro espacial — foto 1', 'ip14pro-1'],
  ['iPhone 14 Pro 256 GB Negro espacial — foto 2', 'ip14pro-2'],
  ['iPhone 14 Pro 256 GB Negro espacial — foto 3', 'ip14pro-3'],
  ['iPhone 14 Pro 256 GB Negro espacial', 'ip14pro-1'],
  ['iPhone 13 Pro 256 GB Verde', 'ip13pro-green'],
  ['iPhone 13 128 GB Medianoche', 'ip13-mid'],
  ['iPhone 15 Pro Max', 'ip15pm-ti'],
  ['iPhone 15 128 GB', 'ip15-sealed'],
  ['iPhone 12 64 GB Azul', 'ip12-blue'],
  ['iPhone 14 128 GB Azul', 'ip12-blue'],
  ['iPhone 11 128 GB Blanco', 'ip11-white'],
  ['Cargador', 'charger'],
  ['Vidrio', 'glass'],
];

const dataUrl = (name) => {
  const p = path.join(PHOTOS, `${name}.jpg`);
  if (!existsSync(p)) return null;
  return `data:image/jpeg;base64,${readFileSync(p).toString('base64')}`;
};
const PHOTO_DATA = PHOTO_MAP.map(([alt, name]) => [alt, dataUrl(name)]).filter(([, d]) => d);

const CLEAN_CSS = `
  nextjs-portal, [data-nextjs-toast], #__next-build-watcher, nav.panel-nav { display: none !important; }
  * { caret-color: transparent !important; }
  html { scroll-behavior: auto !important; }
`;

// The seeded tenant is called "iStock Demo"; the ad shows a believable reseller instead.
const BRAND = [
  ['iStock Demo — Alto Valle', 'Alto Valle Celulares'],
  ['iStock Demo', 'Alto Valle Celulares'],
  ['demo.maat.work', 'istock.maat.work'],
];

async function clean(page) {
  await page.addStyleTag({ content: CLEAN_CSS });
  await page.evaluate((brand) => {
    document.querySelector('nextjs-portal')?.remove();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      let text = node.nodeValue ?? '';
      for (const [from, to] of brand) text = text.split(from).join(to);
      if (text !== node.nodeValue) node.nodeValue = text;
    }
    // Owner-only fields never appear in the ad, even though the panel legitimately shows them.
    for (const name of ['imei', 'costUsd']) {
      const input = document.querySelector(`input[name="${name}"]`);
      const label = input && document.querySelector(`label[for="${input.id}"]`);
      const group = label?.parentElement;
      if (group) group.style.display = 'none';
    }
  }, BRAND);
  // Nothing but the product host may reach a capture: the ad promises istock.maat.work, never a tenant host.
  const leaked = await page.evaluate((tokens) => {
    const text = document.body.innerText.toLowerCase();
    return tokens.filter((token) => text.includes(token));
  }, ['altovalle', 'demo.maat.work', 'istock demo', 'localhost']);
  if (leaked.length > 0) throw new Error(`capture leaks ${leaked.join(', ')} on ${page.url()}`);
}

async function injectPhotos(page) {
  await page.evaluate((map) => {
    const pick = (alt) => map.find(([k]) => alt.includes(k))?.[1] ?? null;
    for (const img of document.querySelectorAll('img')) {
      const src = pick(img.getAttribute('alt') ?? '');
      if (!src) continue;
      const pic = img.closest('picture');
      if (pic) for (const s of pic.querySelectorAll('source')) s.remove();
      img.removeAttribute('srcset');
      img.removeAttribute('sizes');
      img.loading = 'eager';
      img.src = src;
    }
    for (const ph of document.querySelectorAll('.storefront-photo-placeholder')) {
      const alt = ph.getAttribute('aria-label') ?? ph.textContent ?? '';
      const src = pick(alt);
      if (!src) continue;
      const img = document.createElement('img');
      img.src = src;
      img.alt = alt;
      img.className = 'h-full w-full object-cover';
      ph.replaceWith(img);
    }
  }, PHOTO_DATA);
  await page.waitForTimeout(400);
}

async function shot(page, name, opts = {}) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true, ...opts });
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  console.log(`${name}.png  pageHeight=${h}`);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  locale: 'es-AR',
  colorScheme: 'light',
  reducedMotion: 'reduce',
});
const page = await ctx.newPage();

// --- storefront ---
await page.goto(`${STORE}/`, { waitUntil: 'networkidle' });
await clean(page);
await injectPhotos(page);
await shot(page, 'storefront');

await page.goto(`${STORE}/p/iphone-14-pro-256-grafito`, { waitUntil: 'networkidle' });
await clean(page);
await injectPhotos(page);
await shot(page, 'detail');
const wa = await page.$eval('a.storefront-wa-link', (a) => a.href).catch(() => 'n/a');
writeFileSync(path.join(OUT, 'wa-href.txt'), wa + '\n');
console.log('wa:', decodeURIComponent(wa));

// --- panel (login as demo owner via local driver) ---
await page.goto(`${BASE}/ingresar`, { waitUntil: 'networkidle' });
await page.fill('input[type="email"]', 'owner@demo.maat.work');
await page.fill('input[name="password"]', 'demo-password-1234');
await page.click('button[value="sign_in"]');
await page.waitForURL(/\/app/, { timeout: 30000 });
await page.waitForLoadState('networkidle');

// Only the panel home is captured: the stock list shows owner-only figures and the export list
// prints absolute dev URLs, so neither can ever appear in an ad.
for (const [name, url] of [['panel-home', '/app']]) {
  await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle' });
  await clean(page);
  await injectPhotos(page);
  await shot(page, name);
}

// --- new unit form, progressive states (never scroll into IMEI/cost: cropped later in Remotion) ---
await page.goto(`${BASE}/app/stock/nuevo`, { waitUntil: 'networkidle' });
await clean(page);
await shot(page, 'form-0');

await page.selectOption('select[name="catalogModelId"]', { label: 'iPhone 14 Pro' });
await page.waitForTimeout(300);
await shot(page, 'form-1');

await page.selectOption('select[name="storageGb"]', { label: /256/ }).catch(async () => {
  await page.selectOption('select[name="storageGb"]', '256');
});
await page.selectOption('select[name="color"]', { label: /Negro espacial/ }).catch(async () => {
  const v = await page.$$eval('select[name="color"] option', (o) => o.find((x) => /negro/i.test(x.textContent))?.value);
  if (v) await page.selectOption('select[name="color"]', v);
});
await page.waitForTimeout(300);
await shot(page, 'form-2');

await page.selectOption('select[name="condition"]', 'used_excellent');
await page.waitForTimeout(300);
await shot(page, 'form-3');

await page.fill('input[name="priceUsd"]', '620');
await page.fill('input[name="batteryPct"]', '89');
await page.waitForTimeout(300);
await shot(page, 'form-4');

// field geometry (CSS px at 390 wide) so Remotion can crop/animate precisely
const geom = await page.evaluate(() => {
  const q = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y + window.scrollY, w: r.width, h: r.height };
  };
  return {
    model: q('select[name="catalogModelId"]'),
    storage: q('select[name="storageGb"]'),
    color: q('select[name="color"]'),
    condition: q('select[name="condition"]'),
    price: q('input[name="priceUsd"]'),
    battery: q('input[name="batteryPct"]'),
    imei: q('input[name="imei"]'),
    cost: q('input[name="costUsd"]'),
    title: q('input[name="title"]'),
    wa: q('.storefront-wa'),
  };
});
writeFileSync(path.join(OUT, 'form-geom.json'), JSON.stringify(geom, null, 2));
console.log(JSON.stringify(geom));

await browser.close();
