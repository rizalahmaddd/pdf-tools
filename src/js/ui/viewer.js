import { h } from './dom.js';
import { t } from '../i18n.js';
import { renderPage } from '../lib/pdfjs.js';

// Renders every page of a pdf.js document at a fixed width with an overlay layer on top.
// Overlays use fractions of the page size, so placed items survive window resizes.
export async function createViewer(doc, { maxWidth = 900 } = {}) {
  const el = h('div', { class: 'viewer' });
  const pages = [];
  for (let i = 0; i < doc.numPages; i++) {
    const page = await doc.getPage(i + 1);
    const vp1 = page.getViewport({ scale: 1 });
    const canvasHost = h('div', { style: { aspectRatio: `${vp1.width} / ${vp1.height}`, width: '100%' } });
    const overlay = h('div', { class: 'overlay' });
    const wrap = h('div', {
      class: 'viewer-page', style: { maxWidth: `${Math.min(maxWidth, Math.round(vp1.width * 1.5))}px` },
      'aria-label': t('common.pageN', { n: i + 1 }), role: 'region',
    }, canvasHost, overlay, h('span', { class: 'page-no', 'aria-hidden': 'true' }, `${i + 1} / ${doc.numPages}`));
    el.append(wrap);
    pages.push({ index: i, page, vp1, wrap, overlay, canvasHost, rendered: false });
  }

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const p = pages.find((x) => x.wrap === e.target);
      if (!p || p.rendered) continue;
      p.rendered = true;
      io.unobserve(e.target);
      const cssW = p.wrap.getBoundingClientRect().width || maxWidth;
      const scale = (cssW * Math.min(2, window.devicePixelRatio || 1)) / p.vp1.width;
      renderPage(p.page, { scale }).then((c) => p.canvasHost.replaceChildren(c)).catch(() => {
        p.canvasHost.textContent = t('error.renderPage');
      });
    }
  }, { rootMargin: '600px' });
  pages.forEach((p) => io.observe(p.wrap));

  return {
    el,
    pages,
    // Converts a pointer event to page fractions (0..1) for the given page.
    toFraction(p, clientX, clientY) {
      const r = p.overlay.getBoundingClientRect();
      return { x: (clientX - r.left) / r.width, y: (clientY - r.top) / r.height };
    },
    destroy: () => io.disconnect(),
  };
}

// Maps a box given in page fractions to PDF user space. Returns the bottom-left anchor
// and the rotation to apply so the content appears upright on rotated pages.
export function boxToPdf(p, { x, y, w, h: hh }) {
  const vp = p.vp1;
  const [ax, ay] = vp.convertToPdfPoint(x * vp.width, (y + hh) * vp.height);
  return { x: ax, y: ay, width: w * vp.width, height: hh * vp.height, rotate: p.page.rotate % 360 };
}

// pdf.js dropped convertToViewportRectangle; this is the same maths with two corner points.
export function pdfRectToFraction(vp, [x1, y1, x2, y2]) {
  const [ax, ay] = vp.convertToViewportPoint(x1, y1);
  const [bx, by] = vp.convertToViewportPoint(x2, y2);
  return {
    x: Math.min(ax, bx) / vp.width, y: Math.min(ay, by) / vp.height,
    w: Math.abs(bx - ax) / vp.width, h: Math.abs(by - ay) / vp.height,
  };
}
