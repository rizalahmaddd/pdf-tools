import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const nm = (p) => path.join(root, 'node_modules', p);
const out = path.join(root, 'dist');
const assets = path.join(out, 'assets');
const watch = process.argv.includes('--watch');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(assets, 'ocr'), { recursive: true });

const b64 = (file) => fs.readFileSync(file).toString('base64');
const write = (rel, content) => fs.writeFileSync(path.join(out, rel), content);

// Chrome blocks fetch() and new Worker(file://...) when the page is opened by double-click,
// so every worker is shipped as a JS string and started from a Blob URL instead.
async function bundleToString(entry) {
  const r = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: 'iife',
    minify: true,
    target: 'es2022',
    write: false,
    logLevel: 'error',
    define: { 'import.meta.url': '""' },
  });
  return r.outputFiles[0].text;
}

async function buildVendors() {
  const pdfWorker = await bundleToString(nm('pdfjs-dist/build/pdf.worker.mjs'));
  const wasm = {
    openjpeg: b64(nm('pdfjs-dist/wasm/openjpeg.wasm')),
    jbig2: b64(nm('pdfjs-dist/wasm/jbig2.wasm')),
    qcms: b64(nm('pdfjs-dist/wasm/qcms_bg.wasm')),
  };
  write('assets/pdf-worker.js',
    `window.__PDF_WORKER_SRC=${JSON.stringify(pdfWorker)};window.__PDF_WASM=${JSON.stringify(wasm)};`);

  const tessMain = fs.readFileSync(nm('tesseract.js/dist/tesseract.min.js'), 'utf8');
  const tessWorker = fs.readFileSync(nm('tesseract.js/dist/worker.min.js'), 'utf8');
  const tessCore = fs.readFileSync(nm('tesseract.js-core/tesseract-core-simd-lstm.wasm.js'), 'utf8');
  write('assets/ocr/ocr-engine.js',
    `${tessMain}\n;window.__OCR_WORKER_SRC=${JSON.stringify(tessCore + '\n;' + tessWorker)};`);

  for (const lang of ['eng', 'ind']) {
    const data = b64(nm(`@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`));
    write(`assets/ocr/lang-${lang}.js`,
      `(window.__OCR_LANG=window.__OCR_LANG||{})[${JSON.stringify(lang)}]="${data}";`);
  }
}

const appOptions = {
  entryPoints: { app: path.join(root, 'src/js/main.js'), 'app-style': path.join(root, 'src/styles/app.css') },
  bundle: true,
  format: 'iife',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  target: 'es2022',
  outdir: assets,
  logLevel: 'info',
  define: { 'import.meta.url': '""' },
  loader: { '.woff2': 'dataurl', '.svg': 'text' },
  legalComments: 'none',
};

function copyStatic() {
  const brand = fs.readFileSync(path.join(root, 'src/js/config.js'), 'utf8').match(/BRAND_NAME = '([^']+)'/)[1];
  const html = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8')
    .replace(/<title>[^<]*<\/title>/, `<title>${brand}</title>`)
    .replace(/PDF Toolkit\.html/g, `${brand}.html`);
  fs.writeFileSync(path.join(out, `${brand}.html`), html);
  fs.writeFileSync(path.join(out, 'index.html'), html);
  const licenses = [
    ['pdf-lib', 'pdf-lib/LICENSE.md'],
    ['pdfjs-dist', 'pdfjs-dist/LICENSE'],
    ['tesseract.js', 'tesseract.js/LICENSE.md'],
    ['tesseract.js-core', 'tesseract.js-core/LICENSE'],
    ['jszip', 'jszip/LICENSE.markdown'],
    ['sortablejs', 'sortablejs/LICENSE'],
    ['fraunces-font', '@fontsource/fraunces/LICENSE'],
    ['atkinson-hyperlegible-font', '@fontsource/atkinson-hyperlegible/LICENSE'],
    ['dancing-script-font', '@fontsource/dancing-script/LICENSE'],
    ['caveat-font', '@fontsource/caveat/LICENSE'],
  ];
  const text = licenses.map(([name, file]) => {
    const p = nm(file);
    return `==== ${name} ====\n${fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '(license file not found)'}`;
  }).join('\n\n');
  write('assets/THIRD-PARTY-LICENSES.txt', text);
}

await buildVendors();
copyStatic();

if (watch) {
  const ctx = await esbuild.context(appOptions);
  await ctx.watch();
  fs.watch(path.join(root, 'src/index.html'), copyStatic);
} else {
  await esbuild.build(appOptions);
}
