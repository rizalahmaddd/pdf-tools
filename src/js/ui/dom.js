import { icons } from './icons.js';

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'icon') el.insertAdjacentHTML('afterbegin', icons[v] || '');
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : String(c));
  }
}

export function icon(name, cls) {
  const span = document.createElement('span');
  if (cls) span.className = cls;
  span.innerHTML = icons[name] || '';
  return span.firstChild ? (cls ? span : span.firstChild) : span;
}

export function btn(label, { variant = 'secondary', iconName, onClick, disabled, title, big, block, type = 'button' } = {}) {
  const cls = ['btn', `btn-${variant}`, big && 'btn-big', block && 'btn-block'].filter(Boolean).join(' ');
  const b = h('button', { class: cls, type, onclick: onClick, disabled, title });
  if (iconName) b.insertAdjacentHTML('afterbegin', icons[iconName]);
  b.append(label);
  return b;
}

export function iconBtn(iconName, label, onClick, { small = false } = {}) {
  const b = h('button', { class: `icon-btn${small ? ' small' : ''}`, type: 'button', 'aria-label': label, title: label, onclick: onClick });
  b.innerHTML = icons[iconName];
  return b;
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}
