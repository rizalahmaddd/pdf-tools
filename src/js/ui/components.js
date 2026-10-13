import { h, btn, iconBtn, clear, icon } from './dom.js';
import { icons } from './icons.js';
import { t } from '../i18n.js';
import { downloadBlob, formatSize, zipFiles, isPdf, isImage } from '../lib/files.js';
import { history } from '../lib/store.js';

let toastHost;
export function toast(message, { error = false, ms = 3800 } = {}) {
  if (!toastHost) {
    toastHost = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  const el = h('div', { class: `toast${error ? ' error' : ''}` }, message);
  toastHost.append(el);
  setTimeout(() => el.remove(), ms);
}

export function modal({ title, body, footer, onClose, labelledBy = 'modal-title' }) {
  const prevFocus = document.activeElement;
  const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': labelledBy });
  const backdrop = h('div', { class: 'modal-backdrop' }, box);
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey, true);
    onClose?.();
    prevFocus?.focus?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    if (e.key === 'Tab') {
      const items = [...box.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
        .filter((el) => !el.disabled && el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  box.append(h('div', { class: 'modal-head' }, h('h2', { id: labelledBy }, title), iconBtn('x', t('common.close'), close)), body);
  if (footer) box.append(h('div', { class: 'modal-foot' }, footer));
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', onKey, true);
  document.body.append(backdrop);
  requestAnimationFrame(() => (box.querySelector('input, textarea, button:not(.icon-btn)') || box.querySelector('button'))?.focus());
  return { close, box };
}

export function confirmDialog(message, { okLabel, danger = false } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const m = modal({
      title: t('common.confirmTitle'),
      body: h('p', null, message),
      footer: [
        btn(t('common.cancel'), { onClick: () => m.close() }),
        btn(okLabel || t('common.ok'), {
          variant: danger ? 'danger' : 'primary',
          onClick: () => { answered = true; m.close(); },
        }),
      ],
      onClose: () => resolve(answered),
    });
  });
}

const ACCEPT = {
  pdf: 'application/pdf,.pdf',
  image: 'image/*',
  'pdf+image': 'application/pdf,.pdf,image/*',
};

export function dropzone({ accept = 'pdf', multiple = false, onFiles, compact = false, title, sub }) {
  const input = h('input', { type: 'file', accept: ACCEPT[accept], multiple, class: 'visually-hidden', tabindex: '-1' });
  const filter = (files) => files.filter((f) =>
    accept === 'pdf' ? isPdf(f) : accept === 'image' ? isImage(f) : isPdf(f) || isImage(f));
  const handle = (list) => {
    const all = [...list];
    const ok = filter(all);
    if (all.length && !ok.length) {
      toast(t(accept === 'image' ? 'drop.onlyImages' : accept === 'pdf' ? 'drop.onlyPdf' : 'drop.onlyPdfImages'), { error: true });
      return;
    }
    if (ok.length < all.length) toast(t('drop.someSkipped'));
    if (ok.length) onFiles(multiple ? ok : ok.slice(0, 1));
  };
  input.addEventListener('change', () => { handle(input.files); input.value = ''; });
  const zone = h('div', {
    class: `dropzone sheet${compact ? ' compact' : ''}`, role: 'button', tabindex: '0',
    'aria-label': title || t(multiple ? 'drop.titleMany' : 'drop.titleOne'),
  },
  icon('upload', 'dz-icon'),
  h('div', null,
    h('strong', null, title || t(multiple ? 'drop.titleMany' : 'drop.titleOne')),
    h('div', { class: 'dz-sub' }, sub || t('drop.sub'))),
  input);
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
  });
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('is-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('is-over');
    handle(e.dataTransfer.files);
  });
  zone.open = () => input.click();
  return zone;
}

export function progressView(label) {
  const fill = h('div', { class: 'progress-fill' });
  const text = h('span', null, label || t('common.working'));
  const pct = h('span', null, '');
  const el = h('div', { class: 'progress', role: 'status', 'aria-live': 'polite' },
    h('div', { class: 'progress-label' }, text, pct),
    h('div', { class: 'progress-track', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, fill));
  const bar = el.querySelector('[role=progressbar]');
  return {
    el,
    set(fraction, newLabel) {
      if (newLabel) text.textContent = newLabel;
      if (fraction == null) { pct.textContent = ''; return; }
      const p = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
      fill.style.width = `${p}%`;
      pct.textContent = `${p}%`;
      bar.setAttribute('aria-valuenow', String(p));
    },
  };
}

export function notice(text, kind = '') {
  return h('div', { class: `notice ${kind}`, role: kind === 'error' ? 'alert' : null }, text);
}

const NEXT_ORDER = ['sign', 'compress', 'organize', 'numbers', 'watermark', 'merge', 'split', 'fill', 'redact', 'toImage', 'ocr', 'text'];

function toolChip(tool, onPick) {
  return h('button', { type: 'button', class: 'chip', onclick: () => onPick(tool.id) },
    h('span', { class: 'chip-ico', html: icons[tool.icon] }), t(`tool.${tool.id}.name`));
}

// Popover list of tools, used where a file can be sent on to another tool.
export function toolMenu({ label, tools, onPick }) {
  const wrap = h('div', { class: 'menu-wrap' });
  const trigger = h('button', { type: 'button', class: 'btn btn-secondary menu-trigger', 'aria-haspopup': 'true', 'aria-expanded': 'false' }, label);
  trigger.insertAdjacentHTML('beforeend', icons.down);
  const list = h('div', { class: 'menu', role: 'menu', hidden: true },
    tools.map((tool) => h('button', {
      type: 'button', role: 'menuitem', class: 'menu-item', tabindex: '-1',
      onclick: () => { close(); onPick(tool.id); },
    }, h('span', { class: 'chip-ico', html: icons[tool.icon] }), t(`tool.${tool.id}.name`))));
  const items = () => [...list.querySelectorAll('.menu-item')];
  const onDoc = (e) => { if (!wrap.contains(e.target)) close(); };
  function close(focus = false) {
    list.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onDoc, true);
    if (focus) trigger.focus();
  }
  const open = () => {
    list.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    const r = trigger.getBoundingClientRect();
    list.classList.toggle('open-up', r.bottom + 360 > window.innerHeight && r.top > 360);
    list.classList.toggle('align-left', r.left < 260);
    document.addEventListener('pointerdown', onDoc, true);
    items()[0]?.focus();
  };
  trigger.addEventListener('click', () => (list.hidden ? open() : close()));
  list.addEventListener('keydown', (e) => {
    const all = items(), i = all.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); all[(i + 1) % all.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); all[(i - 1 + all.length) % all.length].focus(); }
    else if (e.key === 'Tab') close();
  });
  wrap.append(trigger, list);
  return wrap;
}

// Shown after every tool finishes: downloads, history save, and hand-off to another tool.
export function resultView({ files, toolId, heading, summary, onReset, app }) {
  const list = h('ul', { class: 'result-files' });
  for (const f of files) {
    const ext = (f.name.match(/\.([a-z0-9]+)$/i)?.[1] || '').toUpperCase();
    list.append(h('li', null,
      h('span', { class: 'r-ico sheet', 'aria-hidden': 'true' }, ext),
      h('div', { class: 'r-body' },
        h('div', { class: 'r-name' }, f.name),
        h('div', { class: 'r-size' }, formatSize(f.blob.size))),
      btn(t('common.download'), { variant: 'primary', iconName: 'download', onClick: () => downloadBlob(f.blob, f.name) })));
  }

  const actions = h('div', { class: 'result-actions' });
  if (files.length > 1) {
    actions.append(btn(t('result.downloadZip'), {
      variant: 'secondary', iconName: 'download',
      onClick: async () => downloadBlob(await zipFiles(files), `${toolId}-${files.length}-files.zip`),
    }));
  }
  actions.append(btn(t('result.startOver'), { variant: 'ghost', iconName: 'rotateL', onClick: onReset }));

  let next = null;
  const pdfs = files.filter((f) => f.blob.type === 'application/pdf');
  if (pdfs.length === 1 && app) {
    const send = (id) => app.openTool(id, [new File([pdfs[0].blob], pdfs[0].name, { type: 'application/pdf' })]);
    const candidates = NEXT_ORDER.filter((id) => id !== toolId).map((id) => app.tools.find((x) => x.id === id)).filter(Boolean);
    const chips = h('div', { class: 'chip-row' }, candidates.slice(0, 5).map((tool) => toolChip(tool, send)));
    const rest = candidates.slice(5);
    if (rest.length) {
      const more = h('button', { type: 'button', class: 'chip chip-more', 'aria-expanded': 'false' }, t('result.moreTools', { n: rest.length }));
      more.addEventListener('click', () => {
        more.remove();
        rest.forEach((tool) => chips.append(toolChip(tool, send)));
        chips.children[5]?.focus();
      });
      chips.append(more);
    }
    next = h('div', { class: 'next-step' }, h('h4', null, t('result.continueWith')), chips);
  }

  const saveNote = h('p', { class: 'save-note' });
  if (history.enabled()) {
    Promise.all(files.map((f) => history.add({ name: f.name, blob: f.blob, tool: toolId })))
      .then(() => { saveNote.textContent = t('result.savedHistory'); })
      .catch(() => { saveNote.textContent = t('result.historyFull'); });
  } else {
    saveNote.textContent = t('result.historyOff');
  }

  const el = h('section', { class: 'result', 'aria-live': 'polite', tabindex: '-1' },
    h('div', { class: 'result-head' },
      h('span', { class: 'result-badge', html: icons.check, 'aria-hidden': 'true' }),
      h('div', null, h('h3', null, heading || t('result.ready')), summary ? h('p', { class: 'result-summary' }, summary) : null)),
    list, actions, next, saveNote);
  requestAnimationFrame(() => { el.focus({ preventScroll: true }); el.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  return el;
}

export function segmented(options, value, onChange, label) {
  const group = h('div', { class: 'segmented', role: 'group', 'aria-label': label });
  const render = () => {
    clear(group);
    for (const o of options) {
      group.append(h('button', {
        type: 'button', 'aria-pressed': String(o.value === value),
        onclick: () => { value = o.value; render(); onChange(value); },
      }, o.label));
    }
  };
  render();
  return group;
}

export function field(labelText, control, hint) {
  const id = control.id || `f-${Math.random().toString(36).slice(2, 9)}`;
  control.id = id;
  return h('div', { class: 'field' },
    h('label', { for: id }, labelText), control, hint ? h('div', { class: 'hint' }, hint) : null);
}

export function checkbox(labelText, checked, onChange, hint) {
  const input = h('input', { type: 'checkbox', checked });
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'check' }, input, h('span', null, labelText, hint ? h('span', { class: 'hint muted small', style: { display: 'block' } }, hint) : null));
}

export function choiceList(name, options, value, onChange) {
  return h('div', { class: 'choice-list', role: 'radiogroup' }, options.map((o) => {
    const input = h('input', { type: 'radio', name, value: o.value, checked: o.value === value });
    input.addEventListener('change', () => input.checked && onChange(o.value));
    return h('label', { class: 'choice' }, input,
      h('span', null, h('span', { class: 'c-title', style: { display: 'block' } }, o.label), o.desc ? h('span', { class: 'c-desc' }, o.desc) : null));
  }));
}
