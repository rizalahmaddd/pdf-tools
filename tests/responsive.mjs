import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const fx = (n) => path.join(root, 'tests/fixtures', n);
const outDir = path.join(root, 'tests/out/rs');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const BRAND_HTML = `${fs.readFileSync(path.join(root, 'src/js/config.js'), 'utf8').match(/BRAND_NAME = '([^']+)'/)[1]}.html`;
const APP = 'file://' + path.join(root, 'dist', BRAND_HTML).replace(/ /g, '%20');

const SIZES = [
  { w: 360, h: 780, label: 'phone', langs: ['en', 'id'] },
  { w: 768, h: 1024, label: 'tablet', langs: ['en'] },
  { w: 1024, h: 768, label: 'tabletL', langs: ['en'] },
  { w: 1440, h: 900, label: 'desktop', langs: ['en'] },
];
const onlySize = process.argv[2];
const themes = process.argv.includes('--dark') ? ['dark'] : ['light'];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const problems = [];
let shots = 0;

async function overflowReport(page) {
  return page.evaluate(() => {
    const W = document.documentElement.clientWidth;
    const bad = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (!r.width || getComputedStyle(el).position === 'fixed') continue;
      if (el.closest('.menu[hidden], [hidden]')) continue;
      if (r.right > W + 1 || r.left < -1) {
        if (el.closest('.viewer-page .overlay')) continue;
        const inScroller = (() => { let p = el.parentElement; while (p) { const s = getComputedStyle(p); if (/(auto|scroll)/.test(s.overflowX) && p !== document.documentElement && p !== document.body) return true; p = p.parentElement; } return false; })();
        if (!inScroller) bad.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} right=${Math.round(r.right)} W=${W}`);
      }
    }
    // text clipped inside buttons
    for (const b of document.querySelectorAll('button, .btn, .chip')) {
      if (b.offsetParent && b.scrollWidth > b.clientWidth + 2) bad.push(`clipped: ${b.textContent.trim().slice(0, 30)}`);
    }
    return { scroll: document.documentElement.scrollWidth - W, bad: bad.slice(0, 6) };
  });
}

for (const size of SIZES) {
  if (onlySize && size.label !== onlySize) continue;
  for (const lang of size.langs) for (const theme of themes) {
    const context = await browser.newContext({ viewport: { width: size.w, height: size.h }, colorScheme: theme, hasTouch: size.w < 800, deviceScaleFactor: 1 });
    await context.addInitScript((l) => { try { localStorage.setItem('pdftk:lang', JSON.stringify(l)); } catch {} }, lang);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    const tag = `${size.label}-${lang}${theme === 'dark' ? '-dark' : ''}`;

    const shot = async (name, full = true) => {
      await page.waitForTimeout(250);
      const rep = await overflowReport(page);
      if (rep.scroll > 0 || rep.bad.length) problems.push(`${tag} ${name}: scroll=${rep.scroll} ${rep.bad.join(' | ')}`);
      await page.screenshot({ path: path.join(outDir, `${tag}__${String(++shots).padStart(3, '0')}-${name}.png`), fullPage: full });
    };
    const go = async (hash = '') => { await page.goto('about:blank'); await page.goto(APP + hash); await page.waitForSelector('.topbar'); };
    const upload = (files) => page.locator('.dropzone input[type=file]').first().setInputFiles(files);
    const run = async () => {
      await page.locator('[data-run]').first().click();
      await page.waitForSelector('.result, .result-area .notice.error', { timeout: 180000 });
    };

    try {
      await go();
      await shot('home');
      await page.locator('.dropzone input[type=file]').first().setInputFiles([fx('report.pdf')]);
      await shot('home-pending', false);
      await page.getByRole('button', { name: /private|privat/i }).click();
      await shot('modal-privacy', false);
      await page.keyboard.press('Escape');

      const tools = [
        ['merge', [fx('report.pdf'), fx('annex.pdf'), fx('scan.png')], '.file-row canvas'],
        ['split', [fx('report.pdf')], '.page-card canvas'],
        ['organize', [fx('report.pdf')], '.page-card canvas'],
        ['sign', [fx('landscape.pdf')], '.viewer-page canvas'],
        ['fill', [fx('form.pdf')], '.form-input'],
        ['redact', [fx('landscape.pdf')], '.viewer-page canvas'],
        ['compress', [fx('photo.pdf')], '.file-row canvas'],
        ['toImage', [fx('report.pdf')], '.page-card canvas'],
        ['fromImage', [fx('scan.png')], '.file-row img'],
        ['ocr', [fx('scan.png')], '.tool-side:not([hidden])'],
        ['text', [fx('report.pdf')], 'textarea.text-out'],
        ['watermark', [fx('report.pdf')], '.viewer canvas'],
        ['numbers', [fx('report.pdf')], '.viewer canvas'],
      ];
      for (const [id, files, ready] of tools) {
        await go(`#/${id}`);
        await shot(`${id}-empty`, false);
        await upload(files);
        await page.waitForSelector(ready, { timeout: 30000 });
        await page.waitForTimeout(400);
        if (id === 'sign') {
          await page.getByRole('button', { name: /^(Signature|Tanda tangan)$/ }).click();
          await page.waitForSelector('canvas.sig-pad');
          await shot('sign-modal-draw', false);
          await page.getByRole('tab').nth(1).click();
          await page.locator('.modal input.input').fill('Budi Santoso');
          await shot('sign-modal-type', false);
          await page.getByRole('tab').nth(2).click();
          await shot('sign-modal-upload', false);
          await page.getByRole('tab').nth(1).click();
          await page.locator('.modal .btn-primary').click();
          const ov = await page.locator('.viewer-page .overlay').first().boundingBox();
          await page.mouse.click(ov.x + ov.width * 0.5, ov.y + ov.height * 0.5);
          await page.getByRole('button', { name: /^(Text|Teks)$/ }).click();
          await page.mouse.click(ov.x + ov.width * 0.1, ov.y + ov.height * 0.2);
          await page.keyboard.type('Approved');
        }
        if (id === 'redact') {
          await page.getByRole('searchbox').fill('Budi');
          await page.getByRole('button', { name: /Find and mark|Cari dan tandai/ }).click();
          await page.waitForSelector('.redact-box');
        }
        if (id === 'fill') await page.locator('input.form-input[type=text]').first().fill('Siti Rahma');
        await shot(`${id}-loaded`, id !== 'sign' && id !== 'redact');
        if (id !== 'text') await run();
        await page.waitForTimeout(500);
        await shot(`${id}-result`, true);
      }

      await go('#/split');
      await upload([fx('broken.pdf')]);
      await page.waitForSelector('.notice.error');
      await shot('error-state', false);

      await go();
      await page.waitForSelector('.history-item');
      await page.locator('.history-item .menu-trigger').first().click();
      await shot('history-menu', false);
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: /Clear all|Hapus semua/ }).click();
      await shot('confirm-dialog', false);
      await page.getByRole('button', { name: /Cancel|Batal/ }).click();
    } catch (e) {
      problems.push(`${tag} CRASH: ${e.message.split('\n')[0]}`);
      await page.screenshot({ path: path.join(outDir, `${tag}__crash.png`), fullPage: true });
    }
    if (errors.length) problems.push(`${tag} console: ${errors.slice(0, 3).join(' | ')}`);
    await context.close();
  }
}
await browser.close();
console.log(`${shots} screenshots`);
console.log(problems.length ? problems.join('\n') : 'NO LAYOUT PROBLEMS');
