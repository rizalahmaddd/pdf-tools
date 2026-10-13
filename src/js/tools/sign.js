import { StandardFonts, rgb, degrees } from 'pdf-lib';
import { h, btn, clear, iconBtn } from '../ui/dom.js';
import { icons } from '../ui/icons.js';
import { t, getLang } from '../i18n.js';
import { toast, notice } from '../ui/components.js';
import { signatureDialog } from '../ui/signature.js';
import { createViewer, boxToPdf } from '../ui/viewer.js';
import { loadPdfLib, pdfBlob, baseName, loadImageBitmap } from '../lib/files.js';
import { runJob, loadPdf, pickFiles, loadingState, showError } from './common.js';

const LINE_HEIGHT = 1.15;
const BASELINE = 0.92;

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function markImage(kind) {
  const c = document.createElement('canvas');
  c.width = c.height = 120;
  const g = c.getContext('2d');
  g.strokeStyle = '#111'; g.lineWidth = 14; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath();
  if (kind === 'check') { g.moveTo(18, 64); g.lineTo(48, 94); g.lineTo(102, 26); }
  else { g.moveTo(24, 24); g.lineTo(96, 96); g.moveTo(96, 24); g.lineTo(24, 96); }
  g.stroke();
  return c.toDataURL('image/png');
}

function todayText() {
  return new Date().toLocaleDateString(getLang() === 'id' ? 'id-ID' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' });
}

function textToPng(text, sizePx, color) {
  const lines = text.split('\n');
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const scale = 4;
  g.font = `${sizePx * scale}px Helvetica, Arial, sans-serif`;
  const w = Math.max(...lines.map((l) => g.measureText(l).width), 1);
  c.width = Math.ceil(w + 4 * scale);
  c.height = Math.ceil(lines.length * sizePx * LINE_HEIGHT * scale);
  g.font = `${sizePx * scale}px Helvetica, Arial, sans-serif`;
  g.fillStyle = color;
  g.textBaseline = 'alphabetic';
  lines.forEach((l, i) => g.fillText(l, scale, (i * LINE_HEIGHT + BASELINE) * sizePx * scale));
  return c.toDataURL('image/png');
}

export default {
  id: 'sign',
  icon: 'sign',
  group: 'sign',
  accept: 'pdf',
  multiple: false,
  mount(ctx) {
    const { root } = ctx;
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
      const items = [];
      let placing = null;
      let active = null;
      let textColor = '#111111';
      let textSize = 12;

      const toolbarBtns = {};
      const setPlacing = (p) => {
        placing = p;
        viewer.el.classList.toggle('is-placing', !!p);
        Object.entries(toolbarBtns).forEach(([k, b]) => b.setAttribute('aria-pressed', String(placing?.kind === k)));
        placeHint.hidden = !p;
      };

      const tb = (kind, iconName, label, prepare) => {
        const b = btn(label, { variant: 'ghost', iconName, onClick: async () => {
          if (placing?.kind === kind) { setPlacing(null); return; }
          const payload = await prepare();
          if (payload) setPlacing({ kind, ...payload });
        } });
        b.setAttribute('aria-pressed', 'false');
        toolbarBtns[kind] = b;
        return b;
      };

      const imageInput = h('input', { type: 'file', accept: 'image/*', class: 'visually-hidden', tabindex: '-1' });
      const pickImage = () => new Promise((resolve) => {
        imageInput.onchange = async () => {
          const f = imageInput.files[0];
          imageInput.value = '';
          if (!f) return resolve(null);
          try {
            const bmp = await loadImageBitmap(f);
            const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
            const c = document.createElement('canvas');
            c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
            c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
            resolve(c.toDataURL(/png|gif|webp/.test(f.type) ? 'image/png' : 'image/jpeg', 0.9));
          } catch {
            toast(t('sig.uploadBad'), { error: true });
            resolve(null);
          }
        };
        imageInput.click();
      });

      const colorInput = h('input', { type: 'color', value: textColor, 'aria-label': t('sign.textColor'), title: t('sign.textColor') });
      colorInput.addEventListener('input', () => {
        textColor = colorInput.value;
        if (active?.type === 'text') { active.color = textColor; paint(active); }
      });
      const sizeLabel = h('span', { class: 'small', style: { minWidth: '3ch', textAlign: 'center' }, 'aria-live': 'polite' }, String(textSize));
      const changeSize = (d) => {
        if (active?.type === 'text') {
          const cur = Math.round(active.font * active.page.vp1.width);
          active.font = Math.max(5, Math.min(96, cur + d)) / active.page.vp1.width;
          sizeLabel.textContent = String(Math.round(active.font * active.page.vp1.width));
          paint(active);
        } else {
          textSize = Math.max(5, Math.min(96, textSize + d));
          sizeLabel.textContent = String(textSize);
        }
      };

      const toolbar = h('div', { class: 'toolbar', role: 'toolbar', 'aria-label': t('sign.toolbar') },
        tb('signature', 'sign', t('sign.signature'), async () => {
          const src = await signatureDialog({ title: t('sign.signatureTitle') });
          return src && { src, width: 0.28 };
        }),
        tb('initials', 'pen', t('sign.initials'), async () => {
          const src = await signatureDialog({ title: t('sign.initialsTitle') });
          return src && { src, width: 0.12 };
        }),
        tb('text', 'type', t('sign.text'), async () => ({ text: '' })),
        tb('date', 'calendar', t('sign.date'), async () => ({ text: todayText() })),
        tb('check', 'check', t('sign.check'), async () => ({ src: markImage('check'), width: 0.035 })),
        tb('cross', 'cross', t('sign.cross'), async () => ({ src: markImage('cross'), width: 0.035 })),
        tb('image', 'image', t('sign.image'), async () => {
          const src = await pickImage();
          return src && { src, width: 0.3 };
        }),
        h('span', { class: 'sep', 'aria-hidden': 'true' }),
        colorInput,
        iconBtn('down', t('sign.smaller'), () => changeSize(-1), { small: true }),
        sizeLabel,
        iconBtn('up', t('sign.bigger'), () => changeSize(1), { small: true }),
        imageInput);

      const placeHint = h('div', { class: 'notice warn', hidden: true, role: 'status', style: { marginBottom: '12px' } }, t('sign.placeHint'));
      const countLabel = h('span', { class: 'muted' });
      const runBtn = btn(t('sign.run'), { variant: 'primary', big: true, iconName: 'check', onClick: () => run() });
      runBtn.dataset.run = '';

      const updateCount = () => {
        countLabel.textContent = items.length ? t('sign.count', { n: items.length }) : t('sign.none');
        runBtn.disabled = !items.length;
      };

      const select = (it) => {
        if (active && active !== it) active.el.classList.remove('is-active');
        active = it;
        if (it) {
          it.el.classList.add('is-active');
          if (it.type === 'text') {
            sizeLabel.textContent = String(Math.round(it.font * it.page.vp1.width));
            colorInput.value = it.color;
          }
        }
      };

      const remove = (it) => {
        it.el.remove();
        items.splice(items.indexOf(it), 1);
        if (active === it) active = null;
        updateCount();
      };

      const paint = (it) => {
        const s = it.el.style;
        s.left = `${it.x * 100}%`;
        s.top = `${it.y * 100}%`;
        if (it.type === 'image') {
          s.width = `${it.w * 100}%`;
          s.height = `${it.w * it.aspect * (it.page.vp1.width / it.page.vp1.height) * 100}%`;
        } else {
          const cssW = it.page.overlay.getBoundingClientRect().width || it.page.vp1.width;
          it.span.style.fontSize = `${it.font * cssW}px`;
          it.span.style.color = it.color;
        }
      };

      const makeItem = (p, spec, fx, fy) => {
        const it = { page: p, type: spec.src ? 'image' : 'text', x: fx, y: fy };
        const el = h('div', { class: 'placed', tabindex: '0', role: 'group' });
        it.el = el;
        if (it.type === 'image') {
          it.src = spec.src;
          it.w = spec.width;
          const img = h('img', { src: spec.src, alt: '' });
          el.append(img);
          el.setAttribute('aria-label', t('sign.itemImage'));
          it.aspect = 0.4;
          img.decode().then(() => { it.aspect = img.naturalHeight / img.naturalWidth; paint(it); }).catch(() => {});
        } else {
          it.font = textSize / p.vp1.width;
          it.color = textColor;
          it.span = h('span', { class: 'p-text', contenteditable: 'true', spellcheck: 'false', role: 'textbox', 'aria-multiline': 'true', 'aria-label': t('sign.itemText') });
          it.span.textContent = spec.text;
          it.span.addEventListener('blur', () => { if (!it.span.textContent.trim()) remove(it); });
          el.append(it.span);
          el.setAttribute('aria-label', t('sign.itemText'));
        }
        const handle = h('span', { class: 'handle', 'aria-hidden': 'true' });
        const del = h('button', { type: 'button', class: 'remove', 'aria-label': t('sign.removeItem'), html: icons.x, onclick: (e) => { e.stopPropagation(); remove(it); } });
        del.querySelector('svg').style.width = '14px';
        el.append(handle, del);
        wireDrag(it, handle);
        el.addEventListener('keydown', (e) => {
          if (e.target !== el) return;
          const step = e.shiftKey ? 0.02 : 0.004;
          const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
          if (moves[e.key]) {
            e.preventDefault();
            it.x = Math.max(0, Math.min(0.98, it.x + moves[e.key][0]));
            it.y = Math.max(0, Math.min(0.98, it.y + moves[e.key][1]));
            paint(it);
          } else if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault(); remove(it);
          } else if (e.key === '+' || e.key === '=') {
            if (it.type === 'image') { it.w = Math.min(1, it.w * 1.08); paint(it); } else changeSize(1);
          } else if (e.key === '-') {
            if (it.type === 'image') { it.w = Math.max(0.02, it.w / 1.08); paint(it); } else changeSize(-1);
          } else if (e.key === 'Enter' && it.span) {
            e.preventDefault(); it.span.focus();
          }
        });
        el.addEventListener('focusin', () => select(it));
        p.overlay.append(el);
        items.push(it);
        paint(it);
        updateCount();
        return it;
      };

      const wireDrag = (it, handle) => {
        let mode = null, start = null, moved = false;
        it.el.addEventListener('pointerdown', (e) => {
          if (e.target.closest('.remove')) return;
          e.stopPropagation();
          select(it);
          mode = e.target === handle ? 'resize' : 'move';
          const r = it.page.overlay.getBoundingClientRect();
          start = { cx: e.clientX, cy: e.clientY, x: it.x, y: it.y, w: it.w, font: it.font, rw: r.width, rh: r.height };
          moved = false;
          it.el.setPointerCapture(e.pointerId);
        });
        it.el.addEventListener('pointermove', (e) => {
          if (!mode) return;
          const dx = (e.clientX - start.cx) / start.rw, dy = (e.clientY - start.cy) / start.rh;
          if (!moved && Math.hypot(e.clientX - start.cx, e.clientY - start.cy) < 4) return;
          moved = true;
          e.preventDefault();
          if (mode === 'move') {
            it.x = Math.max(-0.02, Math.min(0.99, start.x + dx));
            it.y = Math.max(-0.02, Math.min(0.99, start.y + dy));
          } else if (it.type === 'image') {
            it.w = Math.max(0.02, Math.min(1, start.w + dx));
          } else {
            const box = it.span.getBoundingClientRect().width / start.rw || 0.1;
            it.font = Math.max(4 / it.page.vp1.width, start.font * (1 + dx / box));
            sizeLabel.textContent = String(Math.round(it.font * it.page.vp1.width));
          }
          paint(it);
        });
        const end = () => {
          if (mode && !moved && it.span) it.span.focus();
          mode = null;
        };
        it.el.addEventListener('pointerup', end);
        it.el.addEventListener('pointercancel', end);
      };

      for (const p of viewer.pages) {
        p.overlay.addEventListener('pointerdown', (e) => {
          if (e.target !== p.overlay) return;
          if (!placing) { select(null); return; }
          const { x, y } = viewer.toFraction(p, e.clientX, e.clientY);
          const spec = placing;
          if (!['signature', 'initials'].includes(spec.kind) || !e.shiftKey) setPlacing(null);
          const it = makeItem(p, spec, x, y);
          if (it.type === 'image') {
            it.x = Math.max(0, x - it.w / 2);
            it.y = Math.max(0, y - (it.w * it.aspect * (p.vp1.width / p.vp1.height)) / 2);
          }
          paint(it);
          // Focus right away: Firefox drops the first keystrokes if this waits for the next frame.
          e.preventDefault();
          (it.span || it.el).focus();
        });
      }

      const onResize = () => items.forEach(paint);
      window.addEventListener('resize', onResize);
      cleanupFns.push(() => window.removeEventListener('resize', onResize));

      clear(root).append(
        toolbar, placeHint,
        viewer.el,
        h('div', { class: 'row', style: { marginTop: '18px', justifyContent: 'space-between' } }, countLabel, runBtn));
      updateCount();

      const run = () => runJob(ctx, async (progress) => {
        const lib = await loadPdfLib(src.bytes);
        const font = await lib.embedFont(StandardFonts.Helvetica);
        const pdfPages = lib.getPages();
        const imageCache = new Map();
        const embedDataUrl = async (url) => {
          if (!imageCache.has(url)) {
            const bytes = Uint8Array.from(atob(url.split(',')[1]), (ch) => ch.charCodeAt(0));
            imageCache.set(url, url.startsWith('data:image/png') ? await lib.embedPng(bytes) : await lib.embedJpg(bytes));
          }
          return imageCache.get(url);
        };
        for (let n = 0; n < items.length; n++) {
          progress(n / items.length, t('sign.applying'));
          const it = items[n];
          const target = pdfPages[it.page.index];
          const vpW = it.page.vp1.width, vpH = it.page.vp1.height;
          if (it.type === 'image') {
            const hFrac = it.w * it.aspect * (vpW / vpH);
            const b = boxToPdf(it.page, { x: it.x, y: it.y, w: it.w, h: hFrac });
            target.drawImage(await embedDataUrl(it.src), { x: b.x, y: b.y, width: b.width, height: b.height, rotate: degrees(b.rotate) });
            continue;
          }
          const text = it.span.innerText.replace(/ /g, ' ').replace(/\n$/, '');
          if (!text.trim()) continue;
          const size = it.font * vpW;
          const lines = text.split('\n');
          let encodable = true;
          try { lines.forEach((l) => font.encodeText(l)); } catch { encodable = false; }
          if (!encodable) {
            const png = textToPng(text, size, it.color);
            const widest = Math.max(...lines.map((l) => l.length)) * size * 0.6;
            const img = await embedDataUrl(png);
            const wPt = img.width / (img.height / (lines.length * size * LINE_HEIGHT));
            const b = boxToPdf(it.page, { x: it.x, y: it.y, w: (wPt || widest) / vpW, h: (lines.length * size * LINE_HEIGHT) / vpH });
            target.drawImage(img, { x: b.x, y: b.y, width: b.width, height: b.height, rotate: degrees(b.rotate) });
            continue;
          }
          lines.forEach((line, i) => {
            const baseY = it.y + ((i * LINE_HEIGHT + BASELINE) * size) / vpH;
            const b = boxToPdf(it.page, { x: it.x + 1 / vpW, y: baseY, w: 0, h: 0 });
            target.drawText(line, { x: b.x, y: b.y, size, font, color: hexToRgb(it.color), rotate: degrees(b.rotate) });
          });
        }
        progress(0.95, t('common.saving'));
        const bytes = await lib.save({ useObjectStreams: true });
        return { files: [{ name: `${baseName(src.file.name)}-signed.pdf`, blob: pdfBlob(bytes) }] };
      });
    };

    const cleanupFns = [];
    if (ctx.files?.length) start(ctx.files); else pickFiles(root, {}, start);
    return () => { viewer?.destroy(); cleanupFns.forEach((f) => f()); };
  },
};
