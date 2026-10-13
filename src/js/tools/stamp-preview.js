import { PDFDocument } from 'pdf-lib';
import { h } from '../ui/dom.js';
import { t } from '../i18n.js';
import { openPdf, renderPage } from '../lib/pdfjs.js';

// Live preview for tools that stamp every page: applies the settings to a one-page copy and renders it.
export function stampPreview(lib, apply) {
  const host = h('div', { class: 'viewer', style: { minHeight: '240px' }, 'aria-live': 'polite' });
  const label = h('p', { class: 'small muted', style: { textAlign: 'center' } }, t('stamp.previewLabel'));
  let timer = 0;
  let version = 0;
  const refresh = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const v = ++version;
      try {
        const doc = await PDFDocument.create();
        const [p] = await doc.copyPages(lib, [0]);
        doc.addPage(p);
        await apply(doc, { preview: true, total: lib.getPageCount() });
        const pdf = await openPdf(await doc.save());
        const page = await pdf.getPage(1);
        const vp = page.getViewport({ scale: 1 });
        const canvas = await renderPage(page, { scale: Math.min(2, 1000 / vp.width) });
        if (v !== version) return;
        canvas.style.maxWidth = '100%';
        canvas.style.boxShadow = '0 2px 10px rgba(0,0,0,.18)';
        host.replaceChildren(canvas, label);
        pdf.loadingTask.destroy();
      } catch (e) {
        if (v === version) host.replaceChildren(h('p', { class: 'muted' }, e.message));
      }
    }, 250);
  };
  return { el: host, refresh };
}
