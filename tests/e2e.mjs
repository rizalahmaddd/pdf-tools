import { chromium, firefox, webkit } from 'playwright-core';
import { PDFDocument } from 'pdf-lib';
import fs from 'node:fs';
import path from 'node:path';

if (!Promise.withResolvers) {
  Promise.withResolvers = function () {
    let resolve, reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

const root = process.cwd();
const fx = (n) => path.join(root, 'tests/fixtures', n);
const outDir = path.join(root, 'tests/out');
fs.mkdirSync(outDir, { recursive: true });
const BRAND_HTML = `${fs.readFileSync(path.join(root, 'src/js/config.js'), 'utf8').match(/BRAND_NAME = '([^']+)'/)[1]}.html`;
const APP = 'file://' + path.join(root, 'dist', BRAND_HTML).replace(/ /g, '%20');
const only = process.argv[2];

const engine = process.env.BROWSER || 'chrome';
const browser = engine === 'firefox' ? await firefox.launch({ headless: true })
  : engine === 'webkit' ? await webkit.launch({ headless: true })
  : await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('request', (r) => { if (!/^(file|blob|data):/.test(r.url())) errors.push(`NETWORK REQUEST: ${r.url()}`); });

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };

async function pdfText(bytes) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false }).promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    out.push(tc.items.map((x) => x.str).join(' '));
  }
  return { pages: doc.numPages, text: out };
}

async function openTool(id) {
  await page.goto('about:blank');
  await page.goto(`${APP}#/${id}`);
  await page.waitForSelector('.tool-head h1');
}
async function upload(files, selector = '.dropzone input[type=file]') {
  await page.locator(selector).first().setInputFiles(files);
}
async function runAndDownload(buttonText, { index = 0, timeout = 120000 } = {}) {
  await page.getByRole('button', { name: buttonText, exact: true }).click();
  await page.waitForSelector('.result, .notice.error', { timeout });
  const err = await page.locator('.result-area .notice.error').count();
  if (err) throw new Error(await page.locator('.result-area .notice.error').innerText());
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.result-files .btn-primary').nth(index).click()]);
  const file = path.join(outDir, dl.suggestedFilename());
  await dl.saveAs(file);
  return file;
}

async function step(name, fn) {
  if (only && !name.startsWith(only)) return;
  try { await fn(); } catch (e) { check(name, false, e.message.split('\n')[0]); await page.screenshot({ path: path.join(outDir, `fail-${name}.png`), fullPage: true }); }
}

// fixture: a "scanned" page image rendered by the browser itself
if (!fs.existsSync(fx('scan.png'))) {
  const p = await context.newPage();
  await p.setViewportSize({ width: 900, height: 600 });
  await p.setContent(`<body style="margin:0;background:#fff;font:34px Georgia;padding:50px;line-height:1.6">
    Invoice number 2026-117<br>Delivered to Malang office.<br>Total payment received with thanks.</body>`);
  await p.screenshot({ path: fx('scan.png') });
  await p.close();
}

await step('home', async () => {
  await page.goto(APP);
  await page.waitForSelector('.tool-tile');
  const tiles = await page.locator('.tool-tile').count();
  check('home renders 13 tools', tiles === 13, `tiles=${tiles}`);
  await page.screenshot({ path: path.join(outDir, 'home-desktop.png'), fullPage: true });
});

await step('merge', async () => {
  await openTool('merge');
  await upload([fx('report.pdf'), fx('annex.pdf'), fx('scan.png')]);
  await page.waitForSelector('.file-row >> nth=2');
  await page.waitForFunction(() => document.querySelectorAll('.file-row canvas, .file-row img').length === 3);
  await page.screenshot({ path: path.join(outDir, 'merge.png'), fullPage: true });
  const file = await runAndDownload('Merge into one PDF');
  const doc = await PDFDocument.load(fs.readFileSync(file));
  check('merge page count', doc.getPageCount() === 8, `pages=${doc.getPageCount()}`);
});

await step('split', async () => {
  await openTool('split');
  await upload(fx('report.pdf'));
  await page.waitForSelector('.page-card canvas');
  await page.getByRole('button', { name: 'Split PDF', exact: true }).click();
  await page.waitForSelector('.result');
  const n = await page.locator('.result-files li').count();
  check('split makes 2 files', n === 2, `files=${n}`);
  await page.screenshot({ path: path.join(outDir, 'split.png'), fullPage: true });
});

await step('organize', async () => {
  await openTool('organize');
  await upload(fx('report.pdf'));
  await page.waitForSelector('.page-card canvas');
  await page.getByRole('button', { name: 'Remove page 1' }).click();
  await page.getByRole('button', { name: 'Rotate page 3 right' }).click();
  await page.screenshot({ path: path.join(outDir, 'organize.png'), fullPage: true });
  const file = await runAndDownload('Save new PDF');
  const doc = await PDFDocument.load(fs.readFileSync(file));
  const rots = doc.getPages().map((p) => p.getRotation().angle);
  check('organize pages + rotation', doc.getPageCount() === 4 && rots[1] === 90, `pages=${doc.getPageCount()} rots=${rots}`);
});

await step('compress', async () => {
  await openTool('compress');
  await upload(fx('photo.pdf'));
  await page.waitForSelector('.file-row canvas');
  const file = await runAndDownload('Compress');
  const before = fs.statSync(fx('photo.pdf')).size, after = fs.statSync(file).size;
  check('compress smaller', after < before * 0.6, `${before} -> ${after}`);
  const txt = await pdfText(fs.readFileSync(file));
  check('compress keeps text', txt.text[0].includes('Photo report'));
  await page.screenshot({ path: path.join(outDir, 'compress.png'), fullPage: true });
});

await step('sign', async () => {
  await openTool('sign');
  await upload(fx('report.pdf'));
  await page.waitForSelector('.viewer-page canvas');
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  const ov = page.locator('.viewer-page .overlay').first();
  const box = await ov.boundingBox();
  await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.3);
  await page.keyboard.type('Hello Sign');
  await page.getByRole('button', { name: 'Date', exact: true }).click();
  await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.4);
  await page.getByRole('button', { name: 'Tick', exact: true }).click();
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.4);
  await page.getByRole('button', { name: 'Signature', exact: true }).click();
  const pad = page.locator('canvas.sig-pad');
  const pb = await pad.boundingBox();
  await page.mouse.move(pb.x + 30, pb.y + 120);
  await page.mouse.down();
  for (let i = 0; i < 30; i++) await page.mouse.move(pb.x + 30 + i * 12, pb.y + 120 + Math.sin(i / 3) * 40);
  await page.mouse.up();
  await page.getByRole('button', { name: 'Use it' }).click();
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.6);
  // rotated page 2
  const ov2 = page.locator('.viewer-page .overlay').nth(1);
  await ov2.scrollIntoViewIfNeeded();
  const box2 = await ov2.boundingBox();
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.mouse.click(box2.x + box2.width * 0.1, box2.y + box2.height * 0.1);
  await page.keyboard.type('Rotated note');
  await page.screenshot({ path: path.join(outDir, 'sign.png') });
  const file = await runAndDownload('Save signed PDF');
  const txt = await pdfText(fs.readFileSync(file));
  check('sign text present', txt.text[0].includes('Hello Sign'), txt.text[0].slice(0, 120));
  check('sign rotated page text', txt.text[1].includes('Rotated note'), txt.text[1].slice(0, 80));
  await page.locator('.result').scrollIntoViewIfNeeded();
});

await step('fill', async () => {
  await openTool('fill');
  await upload(fx('form.pdf'));
  await page.waitForSelector('.form-input');
  await page.getByRole('textbox', { name: 'full_name' }).fill('Siti Rahma');
  await page.getByRole('checkbox', { name: 'agree' }).check();
  await page.getByRole('combobox', { name: 'city' }).selectOption('Malang');
  await page.locator('input[type=radio].form-input').nth(1).check();
  await page.screenshot({ path: path.join(outDir, 'fill.png') });
  const file = await runAndDownload('Save filled PDF');
  const form = (await PDFDocument.load(fs.readFileSync(file))).getForm();
  const vals = [form.getTextField('full_name').getText(), form.getCheckBox('agree').isChecked(), form.getDropdown('city').getSelected()[0], form.getRadioGroup('size').getSelected()];
  check('fill values', vals.join('|') === 'Siti Rahma|true|Malang|L', vals.join('|'));
});

await step('redact', async () => {
  await openTool('redact');
  await upload(fx('report.pdf'));
  await page.waitForSelector('.viewer-page canvas');
  await page.getByRole('searchbox').fill('4455-1234');
  await page.getByRole('button', { name: 'Find and mark' }).click();
  await page.waitForSelector('.redact-box');
  const boxes = await page.locator('.redact-box').count();
  check('redact found boxes', boxes === 5, `boxes=${boxes}`);
  await page.screenshot({ path: path.join(outDir, 'redact.png') });
  const file = await runAndDownload('Redact and save');
  const bytes = fs.readFileSync(file);
  const txt = await pdfText(bytes);
  const raw = bytes.toString('latin1');
  check('redact removes text', !txt.text.join(' ').includes('4455') && !raw.includes('4455') && txt.pages === 5, `pages=${txt.pages}`);
});

await step('toImage', async () => {
  await openTool('toImage');
  await upload(fx('report.pdf'));
  await page.waitForSelector('.page-card canvas');
  await page.getByRole('button', { name: 'Convert to images' }).click();
  await page.waitForSelector('.result');
  const n = await page.locator('.result-files li').count();
  check('pdf to images count', n === 5, `files=${n}`);
});

await step('fromImage', async () => {
  await openTool('fromImage');
  await upload([fx('scan.png')]);
  await page.waitForSelector('.file-row img');
  const file = await runAndDownload('Create PDF');
  const doc = await PDFDocument.load(fs.readFileSync(file));
  check('images to pdf', doc.getPageCount() === 1);
});

await step('ocr', async () => {
  await openTool('ocr');
  await upload([fx('scan.png')]);
  const file = await runAndDownload('Recognise text', { timeout: 180000 });
  const txt = await pdfText(fs.readFileSync(file));
  check('ocr searchable text', /Invoice/i.test(txt.text[0]) && /Malang/i.test(txt.text[0]), txt.text[0].slice(0, 120));
  await page.screenshot({ path: path.join(outDir, 'ocr.png'), fullPage: true });
});

await step('ocrPdf', async () => {
  await openTool('ocr');
  await upload([path.join(outDir, 'scan.pdf')]);
  const file = await runAndDownload('Recognise text', { timeout: 180000 });
  const txt = await pdfText(fs.readFileSync(file));
  check('ocr scanned pdf', /Invoice/i.test(txt.text[0]), txt.text[0].slice(0, 80));
});

await step('text', async () => {
  await openTool('text');
  await upload(fx('report.pdf'));
  await page.waitForSelector('textarea.text-out');
  const v = await page.locator('textarea.text-out').inputValue();
  check('extract text', v.includes('report page 3'));
});

await step('watermark', async () => {
  await openTool('watermark');
  await upload(fx('report.pdf'));
  await page.waitForSelector('.viewer canvas');
  await page.screenshot({ path: path.join(outDir, 'watermark.png'), fullPage: true });
  const file = await runAndDownload('Add watermark');
  const txt = await pdfText(fs.readFileSync(file));
  check('watermark text on all pages', txt.text.every((x) => x.includes('CONFIDENTIAL')));
});

await step('numbers', async () => {
  await openTool('numbers');
  await upload(fx('report.pdf'));
  await page.waitForSelector('.viewer canvas');
  await page.getByRole('button', { name: 'Page 1 of 5' }).click();
  const file = await runAndDownload('Add page numbers');
  const txt = await pdfText(fs.readFileSync(file));
  check('page numbers', txt.text[4].includes('Page 5 of 5') && txt.text[1].includes('Page 2 of 5'), txt.text[1].slice(-30));
  await page.screenshot({ path: path.join(outDir, 'numbers.png'), fullPage: true });
});

await step('history', async () => {
  await page.goto(APP);
  await page.waitForSelector('.history-item', { timeout: 5000 });
  const n = await page.locator('.history-item').count();
  check('history has items', n > 5, `items=${n}`);
});

await step('lang', async () => {
  await page.goto(APP);
  await page.getByRole('button', { name: 'Ganti ke Bahasa Indonesia' }).click();
  const h1 = await page.locator('h1').innerText();
  check('indonesian toggle', h1.includes('komputer sendiri'), h1);
  await page.screenshot({ path: path.join(outDir, 'home-id.png'), fullPage: true });
  await page.getByRole('button', { name: 'Switch to English' }).click();
});

await step('mobile', async () => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(APP);
  await page.waitForSelector('.tool-tile');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check('mobile no horizontal overflow (home)', !overflow);
  await page.screenshot({ path: path.join(outDir, 'home-mobile.png'), fullPage: true });
  for (const id of ['sign', 'merge', 'numbers']) {
    await openTool(id);
    await upload(fx('report.pdf'));
    await page.waitForTimeout(1200);
    const of = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    check(`mobile no overflow (${id})`, !of);
    await page.screenshot({ path: path.join(outDir, `mobile-${id}.png`) });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
});

await step('dark', async () => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(APP);
  await page.evaluate(() => localStorage.removeItem('pdftk:theme'));
  await page.goto(APP);
  await page.waitForSelector('.tool-tile');
  await page.screenshot({ path: path.join(outDir, 'home-dark.png'), fullPage: true });
  await openTool('sign');
  await upload(fx('report.pdf'));
  await page.waitForSelector('.viewer-page canvas');
  await page.screenshot({ path: path.join(outDir, 'sign-dark.png') });
  await page.emulateMedia({ colorScheme: 'light' });
});

await step('responsive', async () => {
  const sizes = [[375, 812, 'phone'], [768, 1024, 'tablet'], [1024, 768, 'tablet-land'], [1440, 900, 'desktop']];
  for (const [w, hgt, label] of sizes) {
    await page.setViewportSize({ width: w, height: hgt });
    const shots = [
      ['home', async () => { await page.goto('about:blank'); await page.goto(APP); await page.waitForSelector('.tool-tile'); }],
      ['redact', async () => { await openTool('redact'); await upload(fx('landscape.pdf')); await page.waitForSelector('.viewer-page canvas'); }],
      ['organize', async () => { await openTool('organize'); await upload(fx('report.pdf')); await page.waitForSelector('.page-card canvas'); }],
      ['merge-result', async () => {
        await openTool('merge'); await upload([fx('report.pdf'), fx('annex.pdf')]);
        await page.waitForFunction(() => document.querySelectorAll('.file-row canvas').length === 2);
        await page.locator('[data-run]').first().click(); await page.waitForSelector('.result'); await page.waitForTimeout(600);
      }],
      ['sign', async () => { await openTool('sign'); await upload(fx('landscape.pdf')); await page.waitForSelector('.viewer-page canvas'); }],
    ];
    for (const [name, go] of shots) {
      await go();
      const of = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      const pageBox = await page.evaluate(() => {
        const v = document.querySelector('.viewer'); const p = document.querySelector('.viewer-page');
        return v && p ? p.getBoundingClientRect().right - v.getBoundingClientRect().right : -1;
      });
      check(`${label} ${name} fits`, of <= 0 && pageBox <= 0, `overflow=${of} pageOverflow=${pageBox}`);
      await page.screenshot({ path: path.join(outDir, `rs-${label}-${name}.png`), fullPage: name !== 'sign' });
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
});

console.log('\nConsole errors / network:', errors.length ? errors : 'none');
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
await browser.close();
process.exit(failed.length || errors.length ? 1 : 0);
