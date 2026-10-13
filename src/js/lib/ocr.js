import { loadScript } from './util.js';

const LANG_HOST = 'https://offline.local/lang';
let engineLoaded = null;

function loadEngine() {
  engineLoaded ||= loadScript('assets/ocr/ocr-engine.js').catch((e) => {
    engineLoaded = null;
    throw e;
  });
  return engineLoaded;
}

async function loadLanguages(langs) {
  for (const lang of langs) {
    if (!window.__OCR_LANG?.[lang]) await loadScript(`assets/ocr/lang-${lang}.js`);
  }
}

// Tesseract fetches language files from a URL inside its worker. We answer those requests
// from the embedded base64 data so nothing ever touches the network.
function workerSource(langs) {
  const data = {};
  for (const l of langs) data[l] = window.__OCR_LANG[l];
  const shim = `(() => {
    const DATA = ${JSON.stringify(data)};
    const realFetch = self.fetch;
    self.fetch = async (url, opts) => {
      const m = String(url).match(/^${LANG_HOST.replace(/[/.]/g, '\\$&')}\\/(\\w+)\\.traineddata/);
      if (!m) return realFetch(url, opts);
      const bin = atob(DATA[m[1]]);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Response(bytes);
    };
  })();`;
  return shim + '\n' + window.__OCR_WORKER_SRC;
}

export async function createOcr(langs, onProgress) {
  await loadEngine();
  await loadLanguages(langs);
  const url = URL.createObjectURL(new Blob([workerSource(langs)], { type: 'text/javascript' }));
  const worker = await window.Tesseract.createWorker(langs, 1, {
    workerPath: url,
    workerBlobURL: false,
    langPath: LANG_HOST,
    gzip: true,
    cacheMethod: 'none',
    logger: (m) => onProgress?.(m),
  });
  return {
    recognize: (image) => worker.recognize(image, {}, { text: true, blocks: true }).then((r) => r.data),
    terminate: () => { URL.revokeObjectURL(url); return worker.terminate(); },
  };
}
