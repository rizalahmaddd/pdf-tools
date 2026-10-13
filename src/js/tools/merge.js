import { PDFDocument } from 'pdf-lib';
import { h, btn, clear } from '../ui/dom.js';
import { t, plural } from '../i18n.js';
import { dropzone, notice } from '../ui/components.js';
import { fileList } from '../ui/file-list.js';
import { isPdf, readBytes, loadPdfLib, formatSize, pdfBlob, EncryptedPdfError } from '../lib/files.js';
import { openPdf, renderPage, isPasswordError } from '../lib/pdfjs.js';
import { embedImageFile, addImagePage } from '../lib/images.js';
import { runJob, errorMessage } from './common.js';

let seq = 0;

export function makeItem(file) {
  const item = { id: `f${++seq}`, file, name: file.name, pages: 0, meta: formatSize(file.size) };
  item.ready = (async () => {
    if (!isPdf(file)) {
      item.pages = 1;
      item.meta = `${t('files.image')} · ${formatSize(file.size)}`;
      return;
    }
    try {
      item.bytes = await readBytes(file);
      item.doc = await openPdf(item.bytes);
      item.pages = item.doc.numPages;
      item.meta = `${plural(item.pages, 'common.onePage', 'common.nPages')} · ${formatSize(file.size)}`;
    } catch (e) {
      item.error = isPasswordError(e) ? t('error.encryptedShort') : t('error.invalidShort');
    }
  })();
  item.thumb = (el) => {
    if (!isPdf(file)) {
      const url = URL.createObjectURL(file);
      const img = h('img', { src: url, alt: '' });
      img.onload = () => URL.revokeObjectURL(url);
      el.append(img);
      return;
    }
    item.ready.then(async () => {
      if (!item.doc) return;
      const page = await item.doc.getPage(1);
      const vp = page.getViewport({ scale: 1 });
      el.append(await renderPage(page, { scale: 120 / vp.width }));
    }).catch(() => {});
  };
  return item;
}

export default {
  id: 'merge',
  icon: 'merge',
  group: 'arrange',
  accept: 'pdf+image',
  multiple: true,
  mount(ctx) {
    const { root, side } = ctx;
    const list = fileList({ onChange: () => update() });
    const summary = h('p', { class: 'muted' });
    const runBtn = btn(t('merge.run'), { variant: 'primary', big: true, block: true, iconName: 'merge', onClick: () => run() });
    runBtn.dataset.run = '';
    const hint = h('div');

    const add = async (files) => {
      const items = files.map(makeItem);
      list.set([...list.items, ...items]);
      ctx.dirty();
      update();
      await Promise.all(items.map((i) => i.ready));
      list.update();
      update();
    };

    const update = () => {
      const items = list.items;
      const good = items.filter((i) => !i.error);
      const pages = good.reduce((s, i) => s + i.pages, 0);
      summary.textContent = items.length
        ? `${plural(good.length, 'common.oneFile', 'common.nFiles')} · ${plural(pages, 'common.onePage', 'common.nPages')}`
        : '';
      runBtn.disabled = good.length < 1 || (good.length === 1 && isPdf(good[0].file));
      clear(hint);
      if (good.length === 1 && isPdf(good[0].file)) hint.append(notice(t('merge.needTwo')));
      if (items.some((i) => i.error)) hint.append(notice(t('merge.skipBad'), 'warn'));
      if (!items.length) { ctx.showSide(false); showEmpty(); } else { ctx.showSide(true); showList(); }
    };

    const addZone = dropzone({ accept: 'pdf+image', multiple: true, compact: true, title: t('merge.addMore'), sub: t('merge.addMoreSub'), onFiles: add });
    const bigZone = dropzone({ accept: 'pdf+image', multiple: true, title: t('merge.dropTitle'), sub: t('merge.dropSub'), onFiles: add });
    const showEmpty = () => { clear(root).append(bigZone); };
    const showList = () => {
      if (root.contains(list.el)) return;
      clear(root).append(
        h('p', { class: 'muted small', style: { marginBottom: '10px' } }, t('merge.orderHint')),
        list.el, addZone);
    };

    side.append(h('div', { class: 'panel' },
      h('h3', null, t('merge.summary')), summary, hint,
      h('div', { class: 'panel-actions' }, runBtn)));

    const run = () => runJob(ctx, async (progress) => {
      const items = list.items.filter((i) => !i.error);
      const out = await PDFDocument.create();
      for (let n = 0; n < items.length; n++) {
        const it = items[n];
        progress(n / items.length, t('merge.adding', { name: it.name }));
        if (isPdf(it.file)) {
          let src;
          try {
            src = await loadPdfLib(it.bytes);
          } catch (e) {
            if (e instanceof EncryptedPdfError) throw new Error(t('merge.fileLocked', { name: it.name }));
            throw new Error(`${it.name}: ${errorMessage(e)}`);
          }
          const pages = await out.copyPages(src, src.getPageIndices());
          pages.forEach((p) => out.addPage(p));
        } else {
          addImagePage(out, await embedImageFile(out, it.file), { size: 'a4', orientation: 'auto', margin: 24 });
        }
      }
      progress(0.95, t('common.saving'));
      const bytes = await out.save({ useObjectStreams: true });
      return {
        files: [{ name: 'merged.pdf', blob: pdfBlob(bytes) }],
        summary: t('merge.done', { files: items.length, pages: out.getPageCount() }),
      };
    }, { label: t('merge.working') });

    if (ctx.files?.length) add(ctx.files); else update();
  },
};
