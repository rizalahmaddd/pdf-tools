import { StandardFonts, rgb, degrees } from 'pdf-lib';
import { h, btn, clear } from '../ui/dom.js';
import { t, plural } from '../i18n.js';
import { segmented, field, notice, toast } from '../ui/components.js';
import { loadPdfLib, pdfBlob, baseName, readBytes, loadImageBitmap, canvasToBlob } from '../lib/files.js';
import { visualFrame, centredAnchor, parsePageSelection } from '../lib/geometry.js';
import { stampPreview } from './stamp-preview.js';
import { runJob, pickFiles, loadingState, showError } from './common.js';

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function textAsPng(text, color) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  g.font = 'bold 200px Helvetica, Arial, sans-serif';
  c.width = Math.ceil(g.measureText(text).width + 20);
  c.height = 240;
  g.font = 'bold 200px Helvetica, Arial, sans-serif';
  g.fillStyle = color;
  g.textBaseline = 'middle';
  g.fillText(text, 10, 120);
  return canvasToBlob(c, 'image/png');
}

export default {
  id: 'watermark',
  icon: 'watermark',
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
      const s = { kind: 'text', text: 'CONFIDENTIAL', color: '#a8432a', opacity: 0.25, size: 'large', angle: 45, layout: 'center', pages: '', image: null };
      const total = lib.getPageCount();
      const errors = h('div');

      const apply = async (doc, { preview } = {}) => {
        const targets = preview ? new Set([0]) : parsePageSelection(s.pages, total);
        let stamp, stampW, stampH, font;
        if (s.kind === 'image') {
          if (!s.image) return;
          stamp = s.image.type === 'png' ? await doc.embedPng(s.image.bytes) : await doc.embedJpg(s.image.bytes);
        } else {
          if (!s.text.trim()) return;
          font = await doc.embedFont(StandardFonts.HelveticaBold);
          try {
            font.encodeText(s.text);
          } catch {
            const png = new Uint8Array(await (await textAsPng(s.text, s.color)).arrayBuffer());
            stamp = await doc.embedPng(png);
            font = null;
          }
        }
        doc.getPages().forEach((page, i) => {
          if (!targets.has(i)) return;
          const f = visualFrame(page);
          const base = Math.min(f.width, f.height);
          const scale = { small: 0.35, medium: 0.6, large: 0.85 }[s.size];
          const angle = s.angle;
          const draw = (cx, cy, k) => {
            if (font) {
              const sizeFor1 = font.widthOfTextAtSize(s.text, 1);
              const size = Math.min((base * scale * k) / sizeFor1, base * 0.3 * k);
              stampW = sizeFor1 * size;
              stampH = font.heightAtSize(size, { descender: false });
              const a = centredAnchor(f, cx, cy, stampW, stampH, angle);
              page.drawText(s.text, { x: a.x, y: a.y, size, font, color: hexToRgb(s.color), opacity: s.opacity, rotate: degrees(a.rotate) });
            } else {
              stampW = base * scale * k;
              stampH = stampW * (stamp.height / stamp.width);
              const a = centredAnchor(f, cx, cy, stampW, stampH, angle);
              page.drawImage(stamp, { x: a.x, y: a.y, width: stampW, height: stampH, opacity: s.opacity, rotate: degrees(a.rotate) });
            }
          };
          if (s.layout === 'center') {
            draw(f.width / 2, f.height / 2, 1);
          } else {
            const cols = 3, rows = 4;
            for (let r = 0; r < rows; r++) {
              for (let c = 0; c < cols; c++) {
                draw(((c + 0.5 + (r % 2 ? 0.25 : -0.25)) * f.width) / cols, ((r + 0.5) * f.height) / rows, 0.38);
              }
            }
          }
        });
      };

      const preview = stampPreview(lib, apply);
      const refresh = () => {
        clear(errors);
        try { parsePageSelection(s.pages, total); } catch (e) { errors.append(notice(t('split.badRange', { part: e.message, max: total }), 'error')); }
        preview.refresh();
      };

      const textInput = h('input', { class: 'input', value: s.text, maxlength: '60' });
      textInput.addEventListener('input', () => { s.text = textInput.value; refresh(); });
      const color = h('input', { type: 'color', value: s.color, 'aria-label': t('watermark.color') });
      color.addEventListener('input', () => { s.color = color.value; refresh(); });
      const opacity = h('input', { type: 'range', min: '5', max: '90', value: String(s.opacity * 100) });
      const opacityVal = h('span', { class: 'muted small' }, `${Math.round(s.opacity * 100)}%`);
      opacity.addEventListener('input', () => { s.opacity = +opacity.value / 100; opacityVal.textContent = `${opacity.value}%`; refresh(); });
      const pagesInput = h('input', { class: 'input', placeholder: t('watermark.allPages'), inputmode: 'numeric' });
      pagesInput.addEventListener('input', () => { s.pages = pagesInput.value; refresh(); });
      const imageInput = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', class: 'input' });
      imageInput.addEventListener('change', async () => {
        const f = imageInput.files[0];
        if (!f) return;
        try {
          const bmp = await loadImageBitmap(f);
          const c = document.createElement('canvas');
          c.width = bmp.width; c.height = bmp.height;
          c.getContext('2d').drawImage(bmp, 0, 0);
          s.image = { type: 'png', bytes: new Uint8Array(await (await canvasToBlob(c, 'image/png')).arrayBuffer()) };
          refresh();
        } catch {
          toast(t('sig.uploadBad'), { error: true });
        }
      });

      const textFields = h('div', null,
        field(t('watermark.text'), textInput),
        h('div', { class: 'field' }, h('span', { class: 'label' }, t('watermark.color')), color));
      const imageFields = h('div', { hidden: true }, field(t('watermark.image'), imageInput, t('watermark.imageHint')));

      const runBtn = btn(t('watermark.run'), { variant: 'primary', big: true, block: true, iconName: 'watermark', onClick: () => run() });
      runBtn.dataset.run = '';

      clear(root).append(preview.el);
      clear(side).append(h('div', { class: 'panel' },
        files.length > 1 ? h('h3', null, plural(files.length, 'common.oneFile', 'common.nFiles')) : null,
        h('div', { class: 'field' }, h('span', { class: 'label' }, t('watermark.type')),
          segmented([{ value: 'text', label: t('watermark.typeText') }, { value: 'image', label: t('watermark.typeImage') }], s.kind,
            (v) => { s.kind = v; textFields.hidden = v !== 'text'; imageFields.hidden = v !== 'image'; refresh(); }, t('watermark.type'))),
        textFields, imageFields,
        h('div', { class: 'field' }, h('span', { class: 'label' }, t('watermark.size')),
          segmented([{ value: 'small', label: 'S' }, { value: 'medium', label: 'M' }, { value: 'large', label: 'L' }], s.size, (v) => { s.size = v; refresh(); }, t('watermark.size'))),
        h('div', { class: 'field' }, h('span', { class: 'label' }, t('watermark.angle')),
          segmented([{ value: 45, label: t('watermark.diagonal') }, { value: 0, label: t('watermark.horizontal') }], s.angle, (v) => { s.angle = v; refresh(); }, t('watermark.angle'))),
        h('div', { class: 'field' }, h('span', { class: 'label' }, t('watermark.layout')),
          segmented([{ value: 'center', label: t('watermark.once') }, { value: 'tile', label: t('watermark.tile') }], s.layout, (v) => { s.layout = v; refresh(); }, t('watermark.layout'))),
        h('div', { class: 'field' }, h('span', { class: 'label' }, t('watermark.opacity'), ' ', opacityVal), opacity),
        field(t('watermark.pages'), pagesInput, t('watermark.pagesHint')),
        errors,
        h('div', { class: 'panel-actions' }, runBtn)));
      ctx.showSide(true);
      refresh();

      const run = () => runJob(ctx, async (progress) => {
        if (s.kind === 'image' && !s.image) throw new Error(t('watermark.needImage'));
        if (s.kind === 'text' && !s.text.trim()) throw new Error(t('watermark.needText'));
        const outFiles = [];
        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          progress(i / files.length, files.length > 1 ? `${f.name}: ${t('watermark.working')}` : t('watermark.working'));
          const b = i === 0 ? firstBytes : await readBytes(f);
          const doc = await loadPdfLib(b);
          await apply(doc);
          progress((i + 0.9) / files.length, t('common.saving'));
          outFiles.push({
            name: `${baseName(f.name)}-watermarked.pdf`,
            blob: pdfBlob(await doc.save({ useObjectStreams: true })),
          });
        }
        return {
          files: outFiles,
          summary: t('watermark.done', { files: plural(files.length, 'common.oneFile', 'common.nFiles') }),
        };
      });
    };

    if (ctx.files?.length) start(ctx.files); else pickFiles(root, { multiple: true }, start);
  },
};
