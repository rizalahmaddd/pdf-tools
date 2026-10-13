import Sortable from 'sortablejs';
import { h, clear, iconBtn } from './dom.js';
import { t } from '../i18n.js';
import { thumbnailQueue } from '../tools/common.js';

// pages: [{ src, rotation, selected }]. `src` is the 0-based index in the source PDF.
export function pageGrid({ doc, pages, mode = 'select', onChange }) {
  const grid = h('div', { class: 'page-grid', role: 'list' });
  const thumbs = thumbnailQueue(doc, { width: 140 });
  let cards = [];

  const emit = () => onChange?.(pages);

  const cardFor = (p, i) => {
    const thumb = h('div', {
      class: 'page-thumb sheet', role: mode === 'select' ? 'checkbox' : null, tabindex: '0',
      'aria-checked': mode === 'select' ? String(!!p.selected) : null,
      'aria-label': t('common.pageN', { n: p.src + 1 }),
    });
    thumbs.attach(thumb, p.src);
    const applyRotation = () => {
      const c = thumb.querySelector('canvas');
      if (c) c.style.transform = p.rotation ? `rotate(${p.rotation}deg) scale(${p.rotation % 180 ? 0.75 : 1})` : '';
    };
    new MutationObserver(applyRotation).observe(thumb, { childList: true });

    const card = h('div', { class: 'page-card', role: 'listitem' });
    const label = h('div', { class: 'p-label' }, h('span', null, t('common.pageN', { n: p.src + 1 })));
    if (mode === 'select') {
      const toggle = () => {
        p.selected = !p.selected;
        card.classList.toggle('is-selected', p.selected);
        thumb.setAttribute('aria-checked', String(p.selected));
        emit();
      };
      thumb.addEventListener('click', toggle);
      thumb.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); } });
      card.classList.toggle('is-selected', !!p.selected);
    } else {
      const n = p.src + 1;
      label.append(h('span', { class: 'p-tools' },
        iconBtn('rotateL', t('organize.rotateLeft', { n }), () => { p.rotation = (p.rotation + 270) % 360; applyRotation(); emit(); }, { small: true }),
        iconBtn('rotateR', t('organize.rotateRight', { n }), () => { p.rotation = (p.rotation + 90) % 360; applyRotation(); emit(); }, { small: true }),
        iconBtn('trash', t('organize.delete', { n }), () => { pages.splice(pages.indexOf(p), 1); render(); emit(); }, { small: true })));
      thumb.addEventListener('keydown', (e) => {
        const idx = pages.indexOf(p);
        const dir = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : 0;
        if (e.altKey && dir) {
          e.preventDefault();
          const to = idx + dir;
          if (to < 0 || to >= pages.length) return;
          pages.splice(idx, 1);
          pages.splice(to, 0, p);
          render();
          emit();
          grid.children[to]?.querySelector('.page-thumb')?.focus();
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          pages.splice(idx, 1);
          render();
          emit();
          grid.children[Math.min(idx, pages.length - 1)]?.querySelector('.page-thumb')?.focus();
        }
      });
      thumb.title = t('organize.keyHint');
    }
    card.append(thumb, label);
    card._page = p;
    return card;
  };

  const render = () => {
    // Reuse existing cards so thumbnails are not rendered again after every move.
    const byPage = new Map(cards.map((c) => [c._page, c]));
    cards = pages.map((p, i) => byPage.get(p) || cardFor(p, i));
    clear(grid).append(...cards);
    if (mode === 'organize') {
      cards.forEach((c, i) => { c.querySelector('.p-label span').textContent = `${i + 1}`; });
    }
  };

  if (mode === 'organize') {
    Sortable.create(grid, {
      animation: 150,
      filter: '.icon-btn',
      preventOnFilter: false,
      onEnd: (e) => {
        if (e.oldIndex === e.newIndex) return;
        const [p] = pages.splice(e.oldIndex, 1);
        pages.splice(e.newIndex, 0, p);
        render();
        emit();
      },
    });
  }

  render();
  return {
    el: grid,
    render,
    setAll(selected) {
      pages.forEach((p) => { p.selected = selected; });
      cards.forEach((c) => {
        c.classList.toggle('is-selected', selected);
        c.querySelector('.page-thumb').setAttribute('aria-checked', String(selected));
      });
      emit();
    },
    destroy: () => thumbs.destroy(),
  };
}
