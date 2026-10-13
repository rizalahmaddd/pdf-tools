import { h, clear } from '../ui/dom.js';
import { t } from '../i18n.js';
import { dropzone, progressView, notice, resultView, toast } from '../ui/components.js';
import { readBytes, EncryptedPdfError } from '../lib/files.js';
import { openPdf, renderPage, isPasswordError } from '../lib/pdfjs.js';

export function errorMessage(err) {
  if (err instanceof EncryptedPdfError || err?.code === 'encrypted' || isPasswordError(err)) return t('error.encrypted');
  if (err?.name === 'InvalidPDFException' || /Invalid PDF|No PDF header|Failed to parse/i.test(err?.message || '')) return t('error.invalidPdf');
  if (err?.name === 'QuotaExceededError') return t('error.storage');
  if (/memory|allocation/i.test(err?.message || '')) return t('error.memory');
  console.error(err);
  return t('error.generic', { detail: err?.message || String(err) });
}

// Loads a PDF for tools that need page previews. Keeps the raw bytes for pdf-lib as well.
export async function loadPdf(file) {
  const bytes = await readBytes(file);
  let doc;
  try {
    doc = await openPdf(bytes);
  } catch (e) {
    if (isPasswordError(e)) throw new EncryptedPdfError();
    throw e;
  }
  return { file, bytes, doc, pageCount: doc.numPages };
}

export function pickFiles(root, { accept = 'pdf', multiple = false, title, sub }, onFiles) {
  clear(root);
  root.append(dropzone({ accept, multiple, title, sub, onFiles }));
}

export function loadingState(root, label) {
  clear(root);
  const p = progressView(label || t('common.loadingFile'));
  p.set(null);
  root.append(h('div', { class: 'row' }, h('div', { class: 'spinner', 'aria-hidden': 'true' }), p.el));
  p.el.style.flex = '1';
  return p;
}

export function showError(root, err, onRetry) {
  clear(root);
  root.append(notice(errorMessage(err), 'error'));
  if (onRetry) {
    const b = h('button', { class: 'btn btn-secondary', type: 'button', onclick: onRetry, style: { marginTop: '12px' } }, t('common.tryAnotherFile'));
    root.append(b);
  }
}

// Runs a job with a progress bar, then shows the result card below the tool.
export async function runJob(ctx, job, { label } = {}) {
  const { resultArea } = ctx;
  clear(resultArea);
  const p = progressView(label || t('common.working'));
  p.set(0);
  resultArea.append(p.el);
  ctx.setBusy?.(true);
  try {
    const out = await job((fraction, text) => p.set(fraction, text));
    clear(resultArea);
    if (!out) return;
    resultArea.append(resultView({
      files: out.files, heading: out.heading, summary: out.summary, toolId: ctx.toolId, app: ctx.app,
      onReset: () => ctx.reset(),
    }));
  } catch (err) {
    clear(resultArea);
    resultArea.append(notice(errorMessage(err), 'error'));
  } finally {
    ctx.setBusy?.(false);
  }
}

// Renders thumbnails only when they scroll into view, two at a time, so 300-page PDFs stay responsive.
export function thumbnailQueue(doc, { width = 150 } = {}) {
  const queue = [];
  let running = 0;
  const pump = () => {
    while (running < 2 && queue.length) {
      const { index, target, rotation } = queue.shift();
      running++;
      render(index, rotation)
        .then((c) => target.replaceChildren(c))
        .catch(() => { target.textContent = '!'; })
        .finally(() => { running--; pump(); });
    }
  };
  const render = async (index, rotation = 0) => {
    const page = await doc.getPage(index + 1);
    const vp = page.getViewport({ scale: 1, rotation: (page.rotate + rotation) % 360 });
    return renderPage(page, { scale: (width * (window.devicePixelRatio > 1 ? 2 : 1)) / vp.width, rotation });
  };
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      const { index, rotation } = e.target._thumb;
      queue.push({ index, rotation, target: e.target });
    }
    pump();
  }, { rootMargin: '300px' });
  return {
    attach(target, index, rotation = 0) {
      target._thumb = { index, rotation };
      target.replaceChildren(h('span', { class: 'loading-dots' }, `${index + 1}`));
      io.observe(target);
    },
    destroy() { io.disconnect(); queue.length = 0; },
  };
}

export function pageLabel(i) {
  return t('common.pageN', { n: i + 1 });
}

export { toast };
