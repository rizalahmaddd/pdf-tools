import { h, btn, clear } from '../ui/dom.js';
import { t, plural } from '../i18n.js';
import { segmented, field, choiceList, notice } from '../ui/components.js';
import { pageGrid } from '../ui/page-grid.js';
import { baseName, canvasToBlob, zipFiles } from '../lib/files.js';
import { renderPage } from '../lib/pdfjs.js';
import { runJob, loadPdf, pickFiles, loadingState, showError } from './common.js';

const MAX_LISTED = 10;

export default {
  id: 'toImage',
  icon: 'toImage',
  group: 'convert',
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
      const state = { format: 'jpg', dpi: 150, which: 'all' };
      const pages = Array.from({ length: src.pageCount }, (_, i) => ({ src: i, rotation: 0, selected: false }));
      const status = h('div');
      const gridTools = h('div', { class: 'row', style: { marginBottom: '10px' }, hidden: true },
        btn(t('common.selectAll'), { onClick: () => grid.setAll(true) }),
        btn(t('common.selectNone'), { variant: 'ghost', onClick: () => grid.setAll(false) }));
      const runBtn = btn(t('toImage.run'), { variant: 'primary', big: true, block: true, iconName: 'toImage', onClick: () => run() });
      runBtn.dataset.run = '';

      const chosen = () => (state.which === 'all' ? pages : pages.filter((p) => p.selected)).map((p) => p.src);
      const update = () => {
        const n = chosen().length;
        clear(status);
        runBtn.disabled = !n;
        gridTools.hidden = state.which === 'all';
        status.append(n
          ? h('p', { class: 'muted' }, t('toImage.willMake', { n: plural(n, 'toImage.oneImage', 'toImage.nImages') }))
          : notice(t('split.pickPages')));
        if (state.dpi === 300 && n > 30) status.append(notice(t('toImage.bigWarn'), 'warn'));
      };

      grid = pageGrid({ doc: src.doc, pages, mode: 'select', onChange: update });
      clear(root).append(h('p', { class: 'muted', style: { marginBottom: '12px' } }, `${src.file.name} · ${plural(src.pageCount, 'common.onePage', 'common.nPages')}`), gridTools, grid.el);
      clear(side).append(h('div', { class: 'panel' },
        h('div', { class: 'field' }, h('span', { class: 'label' }, t('toImage.format')),
          segmented([{ value: 'jpg', label: 'JPG' }, { value: 'png', label: 'PNG' }], state.format, (v) => { state.format = v; }, t('toImage.format'))),
        h('div', { class: 'field' }, h('span', { class: 'label' }, t('toImage.quality')),
          segmented([
            { value: 72, label: t('toImage.q72') }, { value: 150, label: t('toImage.q150') }, { value: 300, label: t('toImage.q300') },
          ], state.dpi, (v) => { state.dpi = v; update(); }, t('toImage.quality'))),
        h('div', { class: 'field' }, h('span', { class: 'label' }, t('toImage.pages')),
          choiceList('img-which', [
            { value: 'all', label: t('toImage.allPages') },
            { value: 'selected', label: t('toImage.selectedPages'), desc: t('toImage.selectedDesc') },
          ], state.which, (v) => { state.which = v; update(); })),
        status,
        h('div', { class: 'panel-actions' }, runBtn)));
      ctx.showSide(true);
      update();

      const run = () => runJob(ctx, async (progress) => {
        const list = chosen();
        const files = [];
        const base = baseName(src.file.name);
        const pad = String(src.pageCount).length;
        for (let n = 0; n < list.length; n++) {
          progress(n / list.length, t('toImage.working', { n: n + 1, total: list.length }));
          const page = await src.doc.getPage(list[n] + 1);
          const canvas = await renderPage(page, { scale: state.dpi / 72 });
          const blob = await canvasToBlob(canvas, state.format === 'png' ? 'image/png' : 'image/jpeg', 0.9);
          canvas.width = canvas.height = 0;
          files.push({ name: `${base}-page-${String(list[n] + 1).padStart(pad, '0')}.${state.format}`, blob });
        }
        if (files.length > MAX_LISTED) {
          progress(0.98, t('toImage.zipping'));
          const zip = await zipFiles(files);
          return { files: [{ name: `${base}-images.zip`, blob: zip }], summary: t('toImage.zipped', { n: files.length }) };
        }
        return { files };
      });
    };

    if (ctx.files?.length) start(ctx.files); else pickFiles(root, {}, start);
    return () => grid?.destroy();
  },
};
