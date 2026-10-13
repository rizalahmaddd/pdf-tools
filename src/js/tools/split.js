import { PDFDocument } from 'pdf-lib';
import { h, btn, clear } from '../ui/dom.js';
import { t, plural } from '../i18n.js';
import { choiceList, field, notice } from '../ui/components.js';
import { pageGrid } from '../ui/page-grid.js';
import { loadPdfLib, parseRanges, pdfBlob, baseName } from '../lib/files.js';
import { runJob, loadPdf, pickFiles, loadingState, showError } from './common.js';

export default {
  id: 'split',
  icon: 'split',
  group: 'arrange',
  accept: 'pdf',
  multiple: false,
  mount(ctx) {
    const { root, side } = ctx;
    let grid;

    const start = async ([file]) => {
      ctx.dirty();
      loadingState(root);
      let src;
      try {
        src = await loadPdf(file);
      } catch (e) {
        showError(root, e, () => pickFiles(root, {}, start));
        return;
      }
      build(src);
    };

    const build = (src) => {
      const n = src.pageCount;
      const state = { mode: n > 1 ? 'ranges' : 'every', ranges: n > 1 ? `1-${Math.ceil(n / 2)}, ${Math.ceil(n / 2) + 1}-${n}` : '1', every: 1 };
      const pages = Array.from({ length: n }, (_, i) => ({ src: i, rotation: 0, selected: false }));
      const status = h('div', { 'aria-live': 'polite' });
      const modeArea = h('div');
      const runBtn = btn(t('split.run'), { variant: 'primary', big: true, block: true, iconName: 'split', onClick: () => run() });
      runBtn.dataset.run = '';

      grid = pageGrid({ doc: src.doc, pages, mode: 'select', onChange: () => validate() });

      const rangesInput = h('input', { class: 'input', value: state.ranges, inputmode: 'numeric', autocomplete: 'off' });
      rangesInput.addEventListener('input', () => { state.ranges = rangesInput.value; validate(); });
      const everyInput = h('input', { class: 'input', type: 'number', min: '1', max: String(n), value: String(state.every) });
      everyInput.addEventListener('input', () => { state.every = Math.max(1, Math.floor(+everyInput.value || 1)); validate(); });

      const plan = () => {
        if (state.mode === 'ranges') return parseRanges(state.ranges, n);
        if (state.mode === 'every') {
          const out = [];
          for (let i = 0; i < n; i += state.every) {
            const p = []; for (let j = i; j < Math.min(n, i + state.every); j++) p.push(j);
            out.push({ label: p.length === 1 ? `${p[0] + 1}` : `${p[0] + 1}-${p[p.length - 1] + 1}`, pages: p });
          }
          return out;
        }
        const sel = pages.filter((p) => p.selected).map((p) => p.src);
        return sel.length ? [{ label: 'selected', pages: sel }] : [];
      };

      const validate = () => {
        clear(status);
        let groups;
        try {
          groups = plan();
        } catch (e) {
          status.append(notice(t('split.badRange', { part: e.message, max: n }), 'error'));
          runBtn.disabled = true;
          return;
        }
        runBtn.disabled = !groups.length;
        if (!groups.length) status.append(notice(state.mode === 'select' ? t('split.pickPages') : t('split.nothing')));
        else status.append(h('p', { class: 'muted' }, t('split.willMake', { files: plural(groups.length, 'common.oneFile', 'common.nFiles') })));
      };

      const renderMode = () => {
        clear(modeArea);
        if (state.mode === 'ranges') modeArea.append(field(t('split.rangesLabel'), rangesInput, t('split.rangesHint', { max: n })));
        if (state.mode === 'every') modeArea.append(field(t('split.everyLabel'), everyInput));
        if (state.mode === 'select') {
          modeArea.append(h('div', { class: 'row', style: { marginBottom: '10px' } },
            btn(t('common.selectAll'), { onClick: () => grid.setAll(true) }),
            btn(t('common.selectNone'), { variant: 'ghost', onClick: () => grid.setAll(false) })));
        }
        validate();
      };

      clear(root).append(
        h('p', { class: 'muted', style: { marginBottom: '12px' } }, `${src.file.name} · ${plural(n, 'common.onePage', 'common.nPages')}`),
        grid.el);
      clear(side).append(h('div', { class: 'panel' },
        h('h3', null, t('split.how')),
        choiceList('split-mode', [
          { value: 'ranges', label: t('split.modeRanges'), desc: t('split.modeRangesDesc') },
          { value: 'every', label: t('split.modeEvery'), desc: t('split.modeEveryDesc') },
          { value: 'select', label: t('split.modeSelect'), desc: t('split.modeSelectDesc') },
        ], state.mode, (v) => { state.mode = v; renderMode(); }),
        h('div', { style: { marginTop: '14px' } }, modeArea),
        status,
        h('div', { class: 'panel-actions' }, runBtn)));
      ctx.showSide(true);
      renderMode();

      const run = () => runJob(ctx, async (progress) => {
        const groups = plan();
        const lib = await loadPdfLib(src.bytes);
        const files = [];
        const base = baseName(src.file.name);
        for (let i = 0; i < groups.length; i++) {
          progress(i / groups.length, t('split.making', { i: i + 1, n: groups.length }));
          const out = await PDFDocument.create();
          const copied = await out.copyPages(lib, groups[i].pages);
          copied.forEach((p) => out.addPage(p));
          const name = state.mode === 'select' ? `${base}-selected-pages.pdf` : `${base}-pages-${groups[i].label}.pdf`;
          files.push({ name, blob: pdfBlob(await out.save({ useObjectStreams: true })) });
        }
        return { files, summary: t('split.done', { files: plural(files.length, 'common.oneFile', 'common.nFiles') }) };
      });
    };

    if (ctx.files?.length) start(ctx.files); else pickFiles(root, {}, start);
    return () => grid?.destroy();
  },
};
