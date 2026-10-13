import { PDFDocument } from 'pdf-lib';
import { h, btn, clear } from '../ui/dom.js';
import { icons } from '../ui/icons.js';
import { t, plural } from '../i18n.js';
import { notice, field, toast } from '../ui/components.js';
import { createViewer, pdfRectToFraction } from '../ui/viewer.js';
import { loadPdfLib, pdfBlob, baseName, canvasToBlob } from '../lib/files.js';
import { renderPage } from '../lib/pdfjs.js';
import { runJob, loadPdf, pickFiles, loadingState, showError } from './common.js';

const DPI = 150;

export default {
  id: 'redact',
  icon: 'redact',
  group: 'sign',
  accept: 'pdf',
  multiple: false,
  mount(ctx) {
    const { root, side } = ctx;
    let viewer;

    const start = async ([file]) => {
      ctx.dirty();
      loadingState(root);
      try {
        const src = await loadPdf(file);
        await build(src);
      } catch (e) {
        showError(root, e, () => pickFiles(root, {}, start));
      }
    };

    const build = async (src) => {
      viewer = await createViewer(src.doc);
      const boxes = [];
      const count = h('p', { class: 'muted', 'aria-live': 'polite' });
      const runBtn = btn(t('redact.run'), { variant: 'primary', big: true, block: true, iconName: 'redact', onClick: () => run() });
      runBtn.dataset.run = '';

      const update = () => {
        const pages = new Set(boxes.map((b) => b.page.index)).size;
        count.textContent = boxes.length ? t('redact.count', { boxes: boxes.length, pages }) : t('redact.none');
        runBtn.disabled = !boxes.length;
      };

      const addBox = (p, r) => {
        const b = { page: p, ...r };
        const del = h('button', {
          type: 'button', class: 'remove', 'aria-label': t('redact.removeBox'), html: icons.x,
          onclick: (e) => { e.stopPropagation(); b.el.remove(); boxes.splice(boxes.indexOf(b), 1); update(); },
        });
        del.querySelector('svg').style.width = '14px';
        b.el = h('div', { class: 'redact-box', style: { left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` } }, del);
        p.overlay.append(b.el);
        boxes.push(b);
        update();
      };

      for (const p of viewer.pages) {
        let draft = null, s = null;
        p.overlay.style.cursor = 'crosshair';
        p.overlay.style.touchAction = 'none';
        p.overlay.addEventListener('pointerdown', (e) => {
          if (e.target !== p.overlay) return;
          s = viewer.toFraction(p, e.clientX, e.clientY);
          draft = h('div', { class: 'redact-draft' });
          p.overlay.append(draft);
          p.overlay.setPointerCapture(e.pointerId);
        });
        p.overlay.addEventListener('pointermove', (e) => {
          if (!draft) return;
          const c = viewer.toFraction(p, e.clientX, e.clientY);
          const x = Math.max(0, Math.min(s.x, c.x)), y = Math.max(0, Math.min(s.y, c.y));
          const w = Math.min(1, Math.max(s.x, c.x)) - x, hh = Math.min(1, Math.max(s.y, c.y)) - y;
          Object.assign(draft.style, { left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${hh * 100}%` });
          draft._r = { x, y, w, h: hh };
        });
        const finish = () => {
          if (!draft) return;
          const r = draft._r;
          draft.remove();
          draft = null;
          if (r && r.w > 0.005 && r.h > 0.004) addBox(p, r);
        };
        p.overlay.addEventListener('pointerup', finish);
        p.overlay.addEventListener('pointercancel', finish);
      }

      const query = h('input', { class: 'input', type: 'search', autocomplete: 'off' });
      const findBtn = btn(t('redact.find'), { iconName: 'search', onClick: () => find() });
      query.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); find(); } });

      const find = async () => {
        const q = query.value.trim().toLowerCase();
        if (!q) return;
        findBtn.disabled = true;
        let found = 0;
        try {
          const measure = document.createElement('canvas').getContext('2d');
          for (const p of viewer.pages) {
            const tc = await p.page.getTextContent();
            for (const item of tc.items) {
              const str = item.str?.toLowerCase();
              if (!str || !item.width) continue;
              const family = tc.styles[item.fontName]?.fontFamily || 'sans-serif';
              measure.font = `100px ${family}`;
              // Measure real glyph widths so boxes line up with proportional fonts.
              const full = measure.measureText(item.str).width || 1;
              const at = (n) => (item.width * measure.measureText(item.str.slice(0, n)).width) / full;
              let idx = str.indexOf(q);
              while (idx >= 0) {
                const [a, b, , d, e, f] = item.transform;
                const size = Math.hypot(a, b) || d;
                const x0 = e + at(idx);
                const x1 = e + at(idx + q.length);
                addBox(p, pdfRectToFraction(p.vp1, [x0 - size * 0.15, f - size * 0.28, x1 + size * 0.15, f + size * 0.98]));
                found++;
                idx = str.indexOf(q, idx + q.length);
              }
            }
          }
        } finally {
          findBtn.disabled = false;
        }
        toast(found ? t('redact.found', { n: found }) : t('redact.notFound'), { error: !found });
      };

      clear(root).append(h('p', { class: 'muted small', style: { marginBottom: '12px' } }, t('redact.hint')), viewer.el);
      clear(side).append(
        h('div', { class: 'panel' },
          h('h3', null, t('redact.searchTitle')),
          field(t('redact.searchLabel'), query, t('redact.searchHint')),
          findBtn),
        h('div', { class: 'panel' },
          count,
          notice(t('redact.warn'), 'warn'),
          h('div', { class: 'panel-actions' }, runBtn,
            btn(t('redact.clear'), { variant: 'ghost', onClick: () => { boxes.splice(0).forEach((b) => b.el.remove()); update(); } }))));
      ctx.showSide(true);
      update();

      const run = () => runJob(ctx, async (progress) => {
        const lib = await loadPdfLib(src.bytes);
        const byPage = new Map();
        boxes.forEach((b) => byPage.set(b.page.index, [...(byPage.get(b.page.index) || []), b]));
        const indices = [...byPage.keys()].sort((a, b) => a - b);
        for (let n = 0; n < indices.length; n++) {
          const i = indices[n];
          progress(n / (indices.length + 1), t('redact.working', { n: i + 1 }));
          const p = viewer.pages[i];
          const canvas = await renderPage(p.page, { scale: DPI / 72 });
          const g = canvas.getContext('2d');
          g.fillStyle = '#000';
          for (const b of byPage.get(i)) g.fillRect(b.x * canvas.width, b.y * canvas.height, b.w * canvas.width, b.h * canvas.height);
          const jpg = await lib.embedJpg(new Uint8Array(await (await canvasToBlob(canvas, 'image/jpeg', 0.88)).arrayBuffer()));
          canvas.width = canvas.height = 0;
          const np = lib.insertPage(i, [p.vp1.width, p.vp1.height]);
          np.drawImage(jpg, { x: 0, y: 0, width: p.vp1.width, height: p.vp1.height });
          lib.removePage(i + 1);
        }
        progress(0.9, t('common.saving'));
        // Copy into a fresh file: pdf-lib would otherwise keep the old, unredacted page objects.
        const clean = await PDFDocument.create();
        const copied = await clean.copyPages(lib, lib.getPageIndices());
        copied.forEach((pg) => clean.addPage(pg));
        const bytes = await clean.save({ useObjectStreams: true });
        return {
          files: [{ name: `${baseName(src.file.name)}-redacted.pdf`, blob: pdfBlob(bytes) }],
          summary: t('redact.done', { pages: plural(indices.length, 'common.onePage', 'common.nPages') }),
        };
      });
    };

    if (ctx.files?.length) start(ctx.files); else pickFiles(root, {}, start);
    return () => viewer?.destroy();
  },
};
