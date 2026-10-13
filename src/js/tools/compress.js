import { h, btn, clear } from '../ui/dom.js';
import { t, plural } from '../i18n.js';
import { dropzone, choiceList, notice } from '../ui/components.js';
import { fileList } from '../ui/file-list.js';
import { formatSize, pdfBlob, baseName, readBytes } from '../lib/files.js';
import { recompressImages, rasterizePdf } from '../lib/compress.js';
import { makeItem } from './merge.js';
import { runJob, errorMessage } from './common.js';

const LEVELS = {
  light: { maxSide: 2600, quality: 0.82 },
  balanced: { maxSide: 1800, quality: 0.7 },
  strong: { maxSide: 1200, quality: 0.55 },
  scan: { dpi: 110, quality: 0.6 },
};

export default {
  id: 'compress',
  icon: 'compress',
  group: 'convert',
  accept: 'pdf',
  multiple: true,
  mount(ctx) {
    const { root, side } = ctx;
    let level = 'balanced';
    const list = fileList({ onChange: () => update() });
    const runBtn = btn(t('compress.run'), { variant: 'primary', big: true, block: true, iconName: 'compress', onClick: () => run() });
    runBtn.dataset.run = '';
    const warn = h('div');

    const add = async (files) => {
      const items = files.map(makeItem);
      list.set([...list.items, ...items]);
      ctx.dirty();
      update();
      await Promise.all(items.map((i) => i.ready));
      list.update();
      update();
    };
    const bigZone = dropzone({ accept: 'pdf', multiple: true, onFiles: add });
    const addZone = dropzone({ accept: 'pdf', multiple: true, compact: true, title: t('compress.addMore'), onFiles: add });

    const update = () => {
      const good = list.items.filter((i) => !i.error);
      runBtn.disabled = !good.length;
      if (!list.items.length) { ctx.showSide(false); clear(root).append(bigZone); return; }
      ctx.showSide(true);
      if (!root.contains(list.el)) clear(root).append(list.el, addZone);
      clear(warn);
      if (level === 'scan') warn.append(notice(t('compress.scanWarn'), 'warn'));
    };

    side.append(h('div', { class: 'panel' },
      h('h3', null, t('compress.level')),
      choiceList('compress-level', [
        { value: 'light', label: t('compress.light'), desc: t('compress.lightDesc') },
        { value: 'balanced', label: t('compress.balanced'), desc: t('compress.balancedDesc') },
        { value: 'strong', label: t('compress.strong'), desc: t('compress.strongDesc') },
        { value: 'scan', label: t('compress.scan'), desc: t('compress.scanDesc') },
      ], level, (v) => { level = v; update(); }),
      warn,
      h('div', { class: 'panel-actions' }, runBtn)));

    const run = () => runJob(ctx, async (progress) => {
      const items = list.items.filter((i) => !i.error);
      const files = [];
      const lines = [];
      let before = 0, after = 0;
      for (let n = 0; n < items.length; n++) {
        const it = items[n];
        const bytes = it.bytes || await readBytes(it.file);
        const step = (f) => progress((n + f) / items.length, t('compress.working', { name: it.name }));
        let result;
        try {
          result = level === 'scan'
            ? await rasterizePdf(bytes, { ...LEVELS.scan, onProgress: step })
            : await recompressImages(bytes, { ...LEVELS[level], onProgress: step });
        } catch (e) {
          lines.push(`${it.name}: ${errorMessage(e)}`);
          continue;
        }
        const smaller = result.bytes.length < bytes.length;
        const outBytes = smaller ? result.bytes : bytes;
        before += bytes.length; after += outBytes.length;
        files.push({ name: `${baseName(it.name)}-compressed.pdf`, blob: pdfBlob(outBytes) });
        lines.push(smaller
          ? t('compress.line', { name: it.name, from: formatSize(bytes.length), to: formatSize(outBytes.length), pct: Math.round((1 - outBytes.length / bytes.length) * 100) })
          : t('compress.noGain', { name: it.name }));
      }
      if (!files.length) throw new Error(lines.join(' '));
      const pct = before ? Math.round((1 - after / before) * 100) : 0;
      return {
        files,
        heading: pct > 0 ? t('compress.savedHeading', { pct }) : t('result.ready'),
        summary: lines.join(' · '),
      };
    }, { label: t('compress.start') });

    if (ctx.files?.length) add(ctx.files); else update();
  },
};
