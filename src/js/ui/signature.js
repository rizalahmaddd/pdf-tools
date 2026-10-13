import { h, btn, clear } from './dom.js';
import { t } from '../i18n.js';
import { modal, toast, segmented, checkbox } from './components.js';
import { settings } from '../lib/store.js';
import { loadImageBitmap } from '../lib/files.js';

const SAVED_KEY = 'signatures';
const MAX_SAVED = 6;
const INK = { black: '#111111', blue: '#1d3fa8' };

export const savedSignatures = {
  list: () => settings.get(SAVED_KEY, []),
  add(dataUrl) {
    const list = [dataUrl, ...savedSignatures.list().filter((x) => x !== dataUrl)].slice(0, MAX_SAVED);
    return settings.set(SAVED_KEY, list);
  },
  remove(dataUrl) {
    settings.set(SAVED_KEY, savedSignatures.list().filter((x) => x !== dataUrl));
  },
};

function trimCanvas(src, pad = 8) {
  const { width: w, height: hgt } = src;
  const data = src.getContext('2d').getImageData(0, 0, w, hgt).data;
  let x0 = w, y0 = hgt, x1 = -1, y1 = -1;
  for (let y = 0; y < hgt; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 12) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(hgt - 1, y1 + pad);
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
  out.getContext('2d').drawImage(src, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

function drawPanel(state) {
  const canvas = h('canvas', { class: 'sig-pad', 'aria-label': t('sig.drawArea') });
  let drawing = false, last = null, hasInk = false;
  const ctx2d = () => canvas.getContext('2d');
  const fit = () => {
    const r = canvas.getBoundingClientRect();
    if (!r.width) return;
    const dpr = Math.max(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    const c = ctx2d();
    c.scale(dpr, dpr);
    c.lineCap = 'round'; c.lineJoin = 'round';
    hasInk = false;
  };
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  canvas.addEventListener('pointerdown', (e) => {
    if (!canvas.width) fit();
    drawing = true; last = pos(e); canvas.setPointerCapture(e.pointerId);
    const c = ctx2d(); c.fillStyle = INK[state.color];
    c.beginPath(); c.arc(last.x, last.y, 1.3, 0, Math.PI * 2); c.fill();
    hasInk = true;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const p = pos(e);
    const c = ctx2d();
    const speed = Math.hypot(p.x - last.x, p.y - last.y);
    c.strokeStyle = INK[state.color];
    c.lineWidth = Math.max(1.4, 3.2 - speed * 0.06);
    c.beginPath(); c.moveTo(last.x, last.y);
    c.quadraticCurveTo(last.x, last.y, (last.x + p.x) / 2, (last.y + p.y) / 2);
    c.lineTo(p.x, p.y); c.stroke();
    last = p;
  });
  const stop = () => { drawing = false; };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);
  requestAnimationFrame(fit);
  return {
    el: h('div', { class: 'stack' },
      canvas,
      h('div', { class: 'row' },
        h('span', { class: 'muted small grow' }, t('sig.drawHint')),
        btn(t('common.clear'), { variant: 'ghost', iconName: 'x', onClick: fit }))),
    result: () => (hasInk ? trimCanvas(canvas) : null),
    refit: fit,
  };
}

function typePanel(state) {
  const input = h('input', { class: 'input', placeholder: t('sig.typePlaceholder'), autocomplete: 'name', 'aria-label': t('sig.typeLabel') });
  const preview = h('div', { class: 'sig-preview', style: { fontSize: '44px' } });
  const fonts = [
    { value: 'Dancing Script', label: 'Script' },
    { value: 'Caveat', label: 'Handwritten' },
    { value: 'Georgia', label: 'Serif' },
  ];
  let font = fonts[0].value;
  const paint = () => {
    preview.style.fontFamily = `'${font}', cursive`;
    preview.style.color = INK[state.color];
    preview.textContent = input.value || t('sig.typePlaceholder');
    preview.style.opacity = input.value ? '1' : '.4';
  };
  input.addEventListener('input', paint);
  paint();
  return {
    el: h('div', { class: 'stack' }, input, segmented(fonts, font, (v) => { font = v; paint(); }, t('sig.fontStyle')), preview),
    paint,
    async result() {
      const text = input.value.trim();
      if (!text) return null;
      const weight = font === 'Dancing Script' ? '600' : font === 'Caveat' ? '500' : '400';
      await document.fonts.load(`${weight} 120px "${font}"`).catch(() => {});
      const c = document.createElement('canvas');
      const g = c.getContext('2d');
      g.font = `${weight} 120px "${font}", cursive`;
      c.width = Math.ceil(g.measureText(text).width + 60);
      c.height = 200;
      g.font = `${weight} 120px "${font}", cursive`;
      g.fillStyle = INK[state.color];
      g.textBaseline = 'middle';
      g.fillText(text, 30, 100);
      return trimCanvas(c);
    },
  };
}

function uploadPanel() {
  let bitmap = null;
  let removeBg = true;
  const preview = h('div', { class: 'sig-preview' }, h('span', { class: 'muted' }, t('sig.uploadEmpty')));
  const input = h('input', { type: 'file', accept: 'image/*', class: 'input', 'aria-label': t('sig.uploadLabel') });
  const render = () => {
    if (!bitmap) return null;
    const k = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bitmap.width * k); c.height = Math.round(bitmap.height * k);
    const g = c.getContext('2d');
    g.drawImage(bitmap, 0, 0, c.width, c.height);
    if (removeBg) {
      const img = g.getImageData(0, 0, c.width, c.height);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const light = (d[i] + d[i + 1] + d[i + 2]) / 3;
        if (light > 215) d[i + 3] = 0;
        else if (light > 170) d[i + 3] = Math.round(d[i + 3] * (215 - light) / 45);
      }
      g.putImageData(img, 0, 0);
    }
    return trimCanvas(c, 4) || c;
  };
  const show = () => {
    const c = render();
    clear(preview);
    if (c) { c.style.maxHeight = '140px'; c.style.width = 'auto'; preview.append(c); }
  };
  input.addEventListener('change', async () => {
    const f = input.files[0];
    if (!f) return;
    try { bitmap = await loadImageBitmap(f); show(); } catch { toast(t('sig.uploadBad'), { error: true }); }
  });
  return {
    el: h('div', { class: 'stack' }, input, checkbox(t('sig.removeBg'), removeBg, (v) => { removeBg = v; show(); }, t('sig.removeBgHint')), preview),
    result: async () => render(),
  };
}

// Resolves with a PNG data URL, or null when the dialog is closed.
export function signatureDialog({ title }) {
  return new Promise((resolve) => {
    const state = { color: 'black', tab: 'draw' };
    let done = false;
    const draw = drawPanel(state);
    const typed = typePanel(state);
    const upload = uploadPanel();
    const panels = { draw, type: typed, upload };
    let save = true;

    const savedWrap = h('div');
    const renderSaved = () => {
      clear(savedWrap);
      const saved = savedSignatures.list();
      if (!saved.length) return;
      savedWrap.append(h('p', { class: 'small muted', style: { marginBottom: '8px' } }, t('sig.savedTitle')),
        h('div', { class: 'saved-sigs', style: { marginBottom: '16px' } }, saved.map((url) =>
          h('div', { style: { position: 'relative' } },
            h('button', { type: 'button', class: 'saved-sig', 'aria-label': t('sig.useSaved'), onclick: () => finish(url) }, h('img', { src: url, alt: '' })),
            h('button', { type: 'button', class: 'del', 'aria-label': t('sig.deleteSaved'), onclick: () => { savedSignatures.remove(url); renderSaved(); } }, '×')))));
    };
    renderSaved();

    const body = h('div');
    const tabBar = h('div', { class: 'tabs', role: 'tablist' });
    const renderTabs = () => {
      clear(tabBar);
      for (const [key, label] of [['draw', t('sig.tabDraw')], ['type', t('sig.tabType')], ['upload', t('sig.tabUpload')]]) {
        tabBar.append(h('button', {
          type: 'button', role: 'tab', 'aria-selected': String(state.tab === key),
          onclick: () => { state.tab = key; renderTabs(); clear(body).append(panels[key].el); if (key === 'draw') requestAnimationFrame(draw.refit); },
        }, label));
      }
    };
    renderTabs();
    body.append(draw.el);

    const colorPick = segmented([{ value: 'black', label: t('sig.inkBlack') }, { value: 'blue', label: t('sig.inkBlue') }], state.color,
      (v) => { state.color = v; typed.paint(); }, t('sig.ink'));

    const finish = (url) => { done = true; m.close(); resolve(url); };
    const m = modal({
      title,
      body: h('div', null, savedWrap, tabBar, body,
        h('div', { class: 'row', style: { marginTop: '14px' } },
          h('span', { class: 'small', style: { fontWeight: 700 } }, t('sig.ink')), colorPick),
        checkbox(t('sig.remember'), save, (v) => { save = v; }, t('sig.rememberHint'))),
      footer: [
        btn(t('common.cancel'), { onClick: () => m.close() }),
        btn(t('sig.use'), {
          variant: 'primary', iconName: 'check',
          onClick: async () => {
            const canvas = await panels[state.tab].result();
            if (!canvas) { toast(t(state.tab === 'draw' ? 'sig.emptyDraw' : state.tab === 'type' ? 'sig.emptyType' : 'sig.emptyUpload'), { error: true }); return; }
            const url = canvas.toDataURL('image/png');
            if (save && !savedSignatures.add(url)) toast(t('sig.saveFailed'));
            finish(url);
          },
        }),
      ],
      onClose: () => { if (!done) resolve(null); },
    });
  });
}
