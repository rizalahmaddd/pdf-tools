import { h, btn, clear } from '../ui/dom.js';
import { t, plural } from '../i18n.js';
import { toast, notice } from '../ui/components.js';
import { baseName } from '../lib/files.js';
import { runJob, loadPdf, pickFiles, loadingState, showError } from './common.js';

export default {
  id: 'text',
  icon: 'text',
  group: 'convert',
  accept: 'pdf',
  multiple: true,
  mount(ctx) {
    const { root } = ctx;

    const start = async (files) => {
      ctx.dirty();
      loadingState(root);
      if (files.length === 1) {
        let src;
        try {
          src = await loadPdf(files[0]);
        } catch (e) {
          showError(root, e, () => pickFiles(root, { multiple: true }, start));
          return;
        }
        clear(root).append(h('p', { class: 'muted' }, `${src.file.name} · ${plural(src.pageCount, 'common.onePage', 'common.nPages')}`));
        await runJob(ctx, async (progress) => {
          const parts = [];
          let chars = 0;
          for (let i = 1; i <= src.pageCount; i++) {
            progress((i - 1) / src.pageCount, t('text.reading', { n: i, total: src.pageCount }));
            const page = await src.doc.getPage(i);
            const tc = await page.getTextContent();
            const text = tc.items.map((it) => it.str + (it.hasEOL ? '\n' : '')).join('').replace(/[ \t]+\n/g, '\n').trim();
            chars += text.replace(/\s/g, '').length;
            parts.push(`--- ${t('common.pageN', { n: i })} ---\n${text}`);
            page.cleanup();
          }
          const all = parts.join('\n\n');
          const area = h('textarea', { class: 'input text-out', readonly: true, 'aria-label': t('text.output') });
          area.value = all;
          root.append(
            chars < 20 * src.pageCount ? notice(h('span', null, t('text.lowText'), ' ',
              h('button', { type: 'button', class: 'btn btn-secondary', style: { marginLeft: '6px' }, onclick: () => ctx.app.openTool('ocr', [src.file]) }, t('text.openOcr'))), 'warn') : null,
            h('div', { class: 'row', style: { margin: '12px 0' } },
              btn(t('text.copy'), { iconName: 'copy', onClick: async () => {
                try { await navigator.clipboard.writeText(all); toast(t('text.copied')); } catch { area.select(); document.execCommand('copy'); toast(t('text.copied')); }
              } })),
            area);
          return {
            files: [{ name: `${baseName(src.file.name)}.txt`, blob: new Blob([all], { type: 'text/plain;charset=utf-8' }) }],
            summary: t('text.done', { chars: chars.toLocaleString() }),
          };
        });
      } else {
        clear(root).append(h('p', { class: 'muted' }, plural(files.length, 'common.oneFile', 'common.nFiles')));
        await runJob(ctx, async (progress) => {
          const outFiles = [];
          const combinedParts = [];
          let totalChars = 0;
          for (let f = 0; f < files.length; f++) {
            const file = files[f];
            let src;
            try {
              src = await loadPdf(file);
            } catch (e) {
              continue;
            }
            const fileParts = [];
            let fileChars = 0;
            for (let i = 1; i <= src.pageCount; i++) {
              progress((f + (i - 1) / src.pageCount) / files.length, `${file.name}: ${t('text.reading', { n: i, total: src.pageCount })}`);
              const page = await src.doc.getPage(i);
              const tc = await page.getTextContent();
              const text = tc.items.map((it) => it.str + (it.hasEOL ? '\n' : '')).join('').replace(/[ \t]+\n/g, '\n').trim();
              fileChars += text.replace(/\s/g, '').length;
              fileParts.push(`--- ${t('common.pageN', { n: i })} ---\n${text}`);
              page.cleanup();
            }
            totalChars += fileChars;
            const fileText = fileParts.join('\n\n');
            outFiles.push({
              name: `${baseName(file.name)}.txt`,
              blob: new Blob([fileText], { type: 'text/plain;charset=utf-8' }),
            });
            combinedParts.push(`=== ${file.name} ===\n\n${fileText}`);
          }
          const all = combinedParts.join('\n\n\n');
          const area = h('textarea', { class: 'input text-out', readonly: true, 'aria-label': t('text.output') });
          area.value = all;
          root.append(
            h('div', { class: 'row', style: { margin: '12px 0' } },
              btn(t('text.copy'), { iconName: 'copy', onClick: async () => {
                try { await navigator.clipboard.writeText(all); toast(t('text.copied')); } catch { area.select(); document.execCommand('copy'); toast(t('text.copied')); }
              } })),
            area);
          return {
            files: outFiles,
            summary: t('text.doneMany', { files: outFiles.length, chars: totalChars.toLocaleString() }),
          };
        });
      }
    };

    if (ctx.files?.length) start(ctx.files); else pickFiles(root, { multiple: true }, start);
  },
};
