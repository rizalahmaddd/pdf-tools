import { PDFDocument, degrees } from 'pdf-lib';
import { h, btn, clear } from '../ui/dom.js';
import { t, plural } from '../i18n.js';
import { notice } from '../ui/components.js';
import { pageGrid } from '../ui/page-grid.js';
import { loadPdfLib, pdfBlob, baseName } from '../lib/files.js';
import { runJob, loadPdf, pickFiles, loadingState, showError } from './common.js';

export default {
  id: 'organize',
  icon: 'organize',
  group: 'arrange',
  accept: 'pdf',
  multiple: false,
  mount(ctx) {
    const { root, side } = ctx;
    let grid;

    const start = async ([file]) => {
      ctx.dirty();
      loadingState(root);
      try {
        build(await loadPdf(file));
      } catch (e) {
        showError(root, e, () => pickFiles(root, {}, start));
      }
    };

    const build = (src) => {
      const initial = () => Array.from({ length: src.pageCount }, (_, i) => ({ src: i, rotation: 0 }));
      let pages = initial();
      const status = h('p', { class: 'muted', 'aria-live': 'polite' });
      const warn = h('div');
      const runBtn = btn(t('organize.run'), { variant: 'primary', big: true, block: true, iconName: 'check', onClick: () => run() });
      runBtn.dataset.run = '';
      const gridHost = h('div');

      const update = () => {
        status.textContent = `${plural(pages.length, 'common.onePage', 'common.nPages')} · ${t('organize.fromOriginal', { n: src.pageCount })}`;
        clear(warn);
        if (!pages.length) warn.append(notice(t('organize.noPages'), 'error'));
        runBtn.disabled = !pages.length;
      };

      const mountGrid = () => {
        grid?.destroy();
        grid = pageGrid({ doc: src.doc, pages, mode: 'organize', onChange: update });
        clear(gridHost).append(grid.el);
        update();
      };

      clear(root).append(
        h('p', { class: 'muted small', style: { marginBottom: '12px' } }, t('organize.hint')),
        gridHost);
      clear(side).append(h('div', { class: 'panel' },
        h('h3', null, src.file.name), status, warn,
        h('div', { class: 'stack', style: { marginTop: '12px' } },
          h('div', { class: 'row' },
            btn(t('organize.rotateAllLeft'), { iconName: 'rotateL', onClick: () => { pages.forEach((p) => { p.rotation = (p.rotation + 270) % 360; }); mountGrid(); } }),
            btn(t('organize.rotateAllRight'), { iconName: 'rotateR', onClick: () => { pages.forEach((p) => { p.rotation = (p.rotation + 90) % 360; }); mountGrid(); } })),
          h('div', { class: 'row' },
            btn(t('organize.reverse'), { onClick: () => { pages.reverse(); mountGrid(); } }),
            btn(t('organize.reset'), { variant: 'ghost', onClick: () => { pages = initial(); mountGrid(); } }))),
        h('div', { class: 'panel-actions' }, runBtn)));
      ctx.showSide(true);
      mountGrid();

      const run = () => runJob(ctx, async (progress) => {
        const lib = await loadPdfLib(src.bytes);
        const out = await PDFDocument.create();
        progress(0.2, t('organize.working'));
        const copied = await out.copyPages(lib, pages.map((p) => p.src));
        copied.forEach((page, i) => {
          const extra = pages[i].rotation;
          if (extra) page.setRotation(degrees((page.getRotation().angle + extra) % 360));
          out.addPage(page);
        });
        progress(0.9, t('common.saving'));
        const bytes = await out.save({ useObjectStreams: true });
        return { files: [{ name: `${baseName(src.file.name)}-organized.pdf`, blob: pdfBlob(bytes) }] };
      });
    };

    if (ctx.files?.length) start(ctx.files); else pickFiles(root, {}, start);
    return () => grid?.destroy();
  },
};
