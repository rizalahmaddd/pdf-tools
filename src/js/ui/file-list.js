import Sortable from 'sortablejs';
import { h, clear, iconBtn, icon } from './dom.js';
import { t } from '../i18n.js';

// items: [{ id, name, meta, error, thumb: (el) => void }]
export function fileList({ onChange }) {
  let items = [];
  const ul = h('ul', { class: 'file-list', 'aria-label': t('files.listLabel') });

  const move = (from, to) => {
    if (to < 0 || to >= items.length) return;
    const [it] = items.splice(from, 1);
    items.splice(to, 0, it);
    render();
    onChange(items);
    ul.children[to]?.querySelector(from < to ? '[data-down]' : '[data-up]')?.focus();
  };

  const render = () => {
    clear(ul);
    items.forEach((it, i) => {
      if (!it.thumbEl) {
        it.thumbEl = h('div', { class: 'thumb sheet' });
        it.thumb?.(it.thumbEl);
      }
      const thumb = it.thumbEl;
      const up = iconBtn('up', t('files.moveUp', { name: it.name }), () => move(i, i - 1), { small: true });
      const down = iconBtn('down', t('files.moveDown', { name: it.name }), () => move(i, i + 1), { small: true });
      up.dataset.up = ''; down.dataset.down = '';
      up.disabled = i === 0; down.disabled = i === items.length - 1;
      ul.append(h('li', { class: 'file-row', dataset: { id: it.id } },
        h('span', { class: 'drag-handle', title: t('files.drag'), 'aria-hidden': 'true' }, icon('grip')),
        thumb,
        h('div', null,
          h('div', { class: 'f-name' }, it.name),
          h('div', { class: `f-meta${it.error ? ' is-error' : ''}` }, it.error || it.meta || '')),
        h('div', { class: 'f-actions' }, up, down,
          iconBtn('trash', t('files.remove', { name: it.name }), () => {
            items.splice(i, 1);
            render();
            onChange(items);
          }, { small: true }))));
    });
  };

  Sortable.create(ul, {
    handle: '.drag-handle, .thumb',
    animation: 150,
    onEnd: (e) => {
      if (e.oldIndex === e.newIndex) return;
      const [it] = items.splice(e.oldIndex, 1);
      items.splice(e.newIndex, 0, it);
      render();
      onChange(items);
    },
  });

  return {
    el: ul,
    set(next) { items = next; render(); },
    update() { render(); },
    get items() { return items; },
  };
}
