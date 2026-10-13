import { PDFDocument } from 'pdf-lib';
import { h, btn, clear } from '../ui/dom.js';
import { t, plural } from '../i18n.js';
import { dropzone, segmented, checkbox } from '../ui/components.js';
import { fileList } from '../ui/file-list.js';
import { formatSize, pdfBlob, baseName } from '../lib/files.js';
import { embedImageFile, addImagePage } from '../lib/images.js';
import { runJob } from './common.js';

let seq = 0;

export default {
  id: 'fromImage',
  icon: 'fromImage',
  group: 'convert',
  accept: 'image',
  multiple: true,
  mount(ctx) {
    const { root, side } = ctx;
    const state = { size: 'a4', orientation: 'auto', margin: true };
    const list = fileList({ onChange: () => update() });
    const summary = h('p', { class: 'muted' });
    const runBtn = btn(t('fromImage.run'), { variant: 'primary', big: true, block: true, iconName: 'fromImage', onClick: () => run() });
    runBtn.dataset.run = '';

    const add = (files) => {
      ctx.dirty();
      list.set([...list.items, ...files.map((file) => ({
        id: `i${++seq}`, file, name: file.name, meta: formatSize(file.size),
        thumb: (el) => {
          const url = URL.createObjectURL(file);
          const img = h('img', { src: url, alt: '' });
          img.onload = () => URL.revokeObjectURL(url);
          img.onerror = () => { URL.revokeObjectURL(url); el.textContent = '?'; };
          el.append(img);
        },
      }))]);
      update();
    };
    const bigZone = dropzone({ accept: 'image', multiple: true, title: t('fromImage.dropTitle'), sub: t('fromImage.dropSub'), onFiles: add });
    const addZone = dropzone({ accept: 'image', multiple: true, compact: true, title: t('fromImage.addMore'), onFiles: add });

    const update = () => {
      const n = list.items.length;
      runBtn.disabled = !n;
      summary.textContent = n ? t('fromImage.summary', { pages: plural(n, 'common.onePage', 'common.nPages') }) : '';
      if (!n) { ctx.showSide(false); clear(root).append(bigZone); return; }
      ctx.showSide(true);
      if (!root.contains(list.el)) clear(root).append(h('p', { class: 'muted small', style: { marginBottom: '10px' } }, t('merge.orderHint')), list.el, addZone);
    };

    const orientationField = h('div', { class: 'field' }, h('span', { class: 'label' }, t('fromImage.orientation')),
      segmented([
        { value: 'auto', label: t('fromImage.auto') }, { value: 'portrait', label: t('fromImage.portrait') }, { value: 'landscape', label: t('fromImage.landscape') },
      ], state.orientation, (v) => { state.orientation = v; }, t('fromImage.orientation')));

    side.append(h('div', { class: 'panel' },
      h('div', { class: 'field' }, h('span', { class: 'label' }, t('fromImage.pageSize')),
        segmented([
          { value: 'a4', label: 'A4' }, { value: 'letter', label: 'Letter' }, { value: 'fit', label: t('fromImage.fit') },
        ], state.size, (v) => { state.size = v; orientationField.hidden = v === 'fit'; }, t('fromImage.pageSize'))),
      orientationField,
      checkbox(t('fromImage.margin'), state.margin, (v) => { state.margin = v; }),
      summary,
      h('div', { class: 'panel-actions' }, runBtn)));

    const run = () => runJob(ctx, async (progress) => {
      const items = list.items;
      const out = await PDFDocument.create();
      for (let n = 0; n < items.length; n++) {
        progress(n / items.length, t('fromImage.working', { name: items[n].name }));
        let embedded;
        try {
          embedded = await embedImageFile(out, items[n].file);
        } catch {
          throw new Error(t('fromImage.badImage', { name: items[n].name }));
        }
        addImagePage(out, embedded, { size: state.size, orientation: state.orientation, margin: state.margin ? 28 : 0 });
      }
      progress(0.95, t('common.saving'));
      const bytes = await out.save({ useObjectStreams: true });
      const name = items.length === 1 ? `${baseName(items[0].name)}.pdf` : 'images.pdf';
      return { files: [{ name, blob: pdfBlob(bytes) }] };
    });

    if (ctx.files?.length) add(ctx.files); else update();
  },
};
