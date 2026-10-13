import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs';

const WASM_FILES = { 'openjpeg.wasm': 'openjpeg', 'jbig2.wasm': 'jbig2', 'qcms_bg.wasm': 'qcms' };
const wasmCache = new Map();

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// pdf.js normally fetches its image decoders over HTTP, which file:// pages cannot do.
class EmbeddedDataFactory {
  constructor() {}
  async fetch({ kind, filename }) {
    const key = kind === 'wasmUrl' && WASM_FILES[filename];
    if (!key || !window.__PDF_WASM?.[key]) throw new Error(`No embedded data for ${filename}`);
    if (!wasmCache.has(key)) wasmCache.set(key, base64ToBytes(window.__PDF_WASM[key]));
    return wasmCache.get(key).slice();
  }
}

let workerReady = false;
function ensureWorker() {
  if (workerReady) return;
  workerReady = true;
  const src = window.__PDF_WORKER_SRC;
  if (!src) throw new Error('pdf-worker.js is missing from the assets folder');
  try {
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    pdfjsLib.GlobalWorkerOptions.workerPort = new Worker(url);
  } catch {
    // Some locked-down browsers refuse blob workers; run the worker code on the main thread instead.
    new Function(src)();
  }
}

export async function openPdf(bytes, password) {
  ensureWorker();
  const task = pdfjsLib.getDocument({
    data: bytes.slice(),
    password,
    BinaryDataFactory: EmbeddedDataFactory,
    wasmUrl: 'embedded/',
    useWorkerFetch: false,
    isEvalSupported: false,
    enableScripting: false,
  });
  return task.promise;
}

export async function renderPage(page, { scale = 1, rotation = 0, canvas, background = '#ffffff' } = {}) {
  const viewport = page.getViewport({ scale, rotation: (page.rotate + rotation) % 360 });
  const c = canvas || document.createElement('canvas');
  c.width = Math.max(1, Math.floor(viewport.width));
  c.height = Math.max(1, Math.floor(viewport.height));
  const ctx = c.getContext('2d');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, canvas: c, viewport }).promise;
  return c;
}

export function isPasswordError(err) {
  return err?.name === 'PasswordException';
}

export { pdfjsLib };
