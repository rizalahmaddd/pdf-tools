import { StandardFonts, rgb, degrees } from 'pdf-lib';
import { h, btn, clear } from '../ui/dom.js';
import { t, plural } from '../i18n.js';
import { segmented, field, checkbox, notice } from '../ui/components.js';
import { loadPdfLib, pdfBlob, baseName, readBytes } from '../lib/files.js';
import { visualFrame } from '../lib/geometry.js';
import { stampPreview } from './stamp-preview.js';
import { runJob, pickFiles, loadingState, showError } from './common.js';

export default {
  id: 'numbers',
  icon: 'numbers',
  group: 'mark',
  accept: 'pdf',
  multiple: true,
  mount(ctx) {
    const { root, side } = ctx;

    const start = async (files) => {
      ctx.dirty();
      loadingState(root);
      try {
        const first = files[0];
        const bytes = await readBytes(first);
        build(files, bytes, await loadPdfLib(bytes));
      } catch (e) {
        showError(root, e, () => pickFiles(root, { multiple: true }, start));
      }
    };

    const build = (files, firstBytes, lib) => {
      const total = lib.getPageCount();
      const s = { v: 'bottom', hz: 'center', format: 'n', start: 1, size: 11, margin: 28, skipFirst: false };
      const formats = {
        n: (n) => `${n}`,
        page: (n) => t('numbers.fmtPage', { n }),
        pageOf: (n, of) => t('numbers.fmtPageOf', { n, of }),
        slash: (n, of) => `${n} / ${of}`,
      };

      const apply = async (doc, { preview } = {}) => {
        const font = await doc.embedFont(StandardFonts.Helvetica);
        const pages = doc.getPages();
        const count = preview ? total : pages.length;
        const numbered = s.skipFirst ? count - 1 : count;
        pages.forEach((page, i) => {
          if (s.skipFirst && i === 0 && !preview) return;
          if (s.skipFirst && preview) return;
          const n = s.start + i - (s.skipFirst ? 1 : 0);
          const label = formats[s.format](n, s.start + numbered - 1);
          const f = visualFrame(page);
          const w = font.widthOfTextAtSize(label, s.size);
          const vx = s.hz === 'left' ? s.margin : s.hz === 'right' ? f.width - s.margin - w : (f.width - w) / 2;
          const vy = s.v === 'top' ? s.margin + s.size * 0.75 : f.height - s.margin;
          const p = f.toPdf(vx, vy);
          page.drawText(label, { x: p.x, y: p.y, size: s.size, font, color: rgb(0.2, 0.2, 0.2), rotate: degrees(f.rotate) });
        });
      };

      const preview = stampPreview(lib, apply);
      const hint = h('div');
      const refresh = () => {
        clear(hint);
        if (s.skipFirst) hint.append(notice(t('numbers.skipPreview')));
        preview.refresh();
      };

      const num = (value, min, max, onInput) => {
        const el = h('input', { class: 'input', type: 'number', min: String(min), max: String(max), value: String(value) });
        el.addEventListener('input', () => {
          const v = Math.round(+el.value);
          if (Number.isFinite(v) && v >= min && v <= max) { onInput(v); refresh(); }
        });
        return el;
      };

      const runBtn = btn(t('numbers.run'), { variant: 'primary', big: true, block: true, iconName: 'numbers', onClick: () => run() });
      runBtn.dataset.run = '';

      clear(root).append(preview.el);
      clear(side).append(h('div', { class: 'panel' },
        files.length > 1 ? h('h3', null, plural(files.length, 'common.oneFile', 'common.nFiles')) : null,
        h('div', { class: 'field' }, h('span', { class: 'label' }, t('numbers.vertical')),
          segmented([{ value: 'top', label: t('numbers.top') }, { value: 'bottom', label: t('numbers.bottom') }], s.v, (v) => { s.v = v; refresh(); }, t('numbers.vertical'))),
        h('div', { class: 'field' }, h('span', { class: 'label' }, t('numbers.horizontal')),
          segmented([{ value: 'left', label: t('numbers.left') }, { value: 'center', label: t('numbers.center') }, { value: 'right', label: t('numbers.right') }], s.hz, (v) => { s.hz = v; refresh(); }, t('numbers.horizontal'))),
        h('div', { class: 'field' }, h('span', { class: 'label' }, t('numbers.format')),
          segmented([
            { value: 'n', label: '1' }, { value: 'page', label: t('numbers.fmtPage', { n: 1 }) },
            { value: 'pageOf', label: t('numbers.fmtPageOf', { n: 1, of: total }) }, { value: 'slash', label: `1 / ${total}` },
          ], s.format, (v) => { s.format = v; refresh(); }, t('numbers.format'))),
        h('div', { class: 'row' },
          h('div', { class: 'grow' }, field(t('numbers.startAt'), num(s.start, 0, 99999, (v) => { s.start = v; }))),
          h('div', { class: 'grow' }, field(t('numbers.fontSize'), num(s.size, 6, 48, (v) => { s.size = v; })))),
        field(t('numbers.margin'), num(s.margin, 6, 144, (v) => { s.margin = v; }), t('numbers.marginHint')),
        checkbox(t('numbers.skipFirst'), s.skipFirst, (v) => { s.skipFirst = v; refresh(); }, t('numbers.skipFirstHint')),
        hint,
        h('div', { class: 'panel-actions' }, runBtn)));
      ctx.showSide(true);
      refresh();

      const run = () => runJob(ctx, async (progress) => {
        const outFiles = [];
        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          progress(i / files.length, files.length > 1 ? `${f.name}: ${t('numbers.working')}` : t('numbers.working'));
          const b = i === 0 ? firstBytes : await readBytes(f);
          const doc = await loadPdfLib(b);
          await apply(doc);
          progress((i + 0.9) / files.length, t('common.saving'));
          outFiles.push({
            name: `${baseName(f.name)}-numbered.pdf`,
            blob: pdfBlob(await doc.save({ useObjectStreams: true })),
          });
        }
        return {
          files: outFiles,
          summary: t('numbers.done', { files: plural(files.length, 'common.oneFile', 'common.nFiles') }),
        };
      });
    };

    if (ctx.files?.length) start(ctx.files); else pickFiles(root, { multiple: true }, start);
  },
};
