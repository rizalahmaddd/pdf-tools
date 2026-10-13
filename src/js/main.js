import { h, clear, btn, iconBtn, icon } from './ui/dom.js';
import { icons } from './ui/icons.js';
import { t, setLang, getLang, formatDate } from './i18n.js';
import { settings, history, onHistoryChange } from './lib/store.js';
import { dropzone, modal, confirmDialog, toast, toolMenu } from './ui/components.js';
import { downloadBlob, formatSize, isPdf, isImage } from './lib/files.js';
import { tools, groups } from './tools/index.js';
import { BRAND_NAME, VERSION, DEVELOPER, DEVELOPER_PHONE } from './config.js';

const appEl = document.getElementById('app');
let pendingFiles = null;
let currentTool = null;
let toolDirty = false;

const app = {
  tools,
  openTool(id, files) {
    pendingFiles = files || null;
    toolDirty = false;
    if (location.hash === `#/${id}`) render();
    else location.hash = `#/${id}`;
  },
  markDirty(v = true) { toolDirty = v; },
};

function applyTheme(theme) {
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}
function effectiveTheme() {
  return document.documentElement.dataset.theme
    || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

function header() {
  const pill = h('span', { class: 'offline-pill' });
  const updatePill = () => {
    pill.classList.toggle('is-online', navigator.onLine);
    pill.innerHTML = navigator.onLine ? icons.shield : icons.plugOff;
    pill.append(h('span', { class: 'pill-text' }, navigator.onLine ? t('top.private') : t('top.offline')));
    pill.title = t('top.pillTitle');
  };
  updatePill();
  addEventListener('online', updatePill);
  addEventListener('offline', updatePill);

  const themeBtn = iconBtn(effectiveTheme() === 'dark' ? 'sun' : 'moon', t('top.theme'), () => {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    settings.set('theme', next);
    themeBtn.innerHTML = icons[next === 'dark' ? 'sun' : 'moon'];
  });
  const other = getLang() === 'en' ? 'id' : 'en';
  const langBtn = h('button', {
    class: 'icon-btn lang-btn', type: 'button', lang: other,
    'aria-label': other === 'id' ? 'Ganti ke Bahasa Indonesia' : 'Switch to English',
    title: other === 'id' ? 'Bahasa Indonesia' : 'English',
    onclick: async () => {
      if (currentTool && toolDirty && !(await confirmDialog(t('top.langConfirm')))) return;
      setLang(other);
      render();
    },
  }, other.toUpperCase());

  return h('header', { class: 'topbar' },
    h('div', { class: 'wrap' },
      h('a', { class: 'brand', href: '#/', html: icons.brand.replace('<svg', '<svg class="brand-mark"') }, BRAND_NAME),
      h('span', { class: 'topbar-spacer' }),
      pill,
      h('div', { class: 'top-actions' }, langBtn, themeBtn)));
}

function footer() {
  return h('footer', { class: 'footer' },
    h('div', { class: 'wrap' },
      h('span', null, `${BRAND_NAME} ${VERSION} · ${t('footer.madeBy', { name: DEVELOPER })} · ${DEVELOPER_PHONE}`),
      h('span', null,
        h('button', { type: 'button', onclick: privacyInfo }, t('footer.howPrivate')),
        ' · ',
        h('button', { type: 'button', onclick: creditsInfo }, t('footer.credits')))));
}

function privacyInfo() {
  modal({
    title: t('privacy.title'),
    body: h('div', { class: 'stack' },
      h('p', null, t('privacy.p1')),
      h('p', null, t('privacy.p2')),
      h('p', null, t('privacy.p3')),
      h('p', null, t('privacy.p4'))),
  });
}

function creditsInfo() {
  modal({
    title: t('credits.title'),
    body: h('div', { class: 'stack' },
      h('p', null, t('credits.p1')),
      h('ul', null,
        ['pdf-lib (MIT)', 'PDF.js, Mozilla (Apache-2.0)', 'Tesseract.js (Apache-2.0)', 'JSZip (MIT)', 'SortableJS (MIT)', 'Fraunces, Atkinson Hyperlegible (SIL OFL 1.1)']
          .map((x) => h('li', null, x))),
      h('p', { class: 'small muted' }, t('credits.p2')),
      h('p', { class: 'small muted' }, t('credits.developer', { name: DEVELOPER, phone: DEVELOPER_PHONE }))),
  });
}

function renderHome(main) {
  const pendingBar = h('div', { class: 'pending-bar', hidden: true });
  const toolTiles = [];

  const setPending = (files) => {
    pendingFiles = files;
    const hasPdf = files.some(isPdf);
    const onlyImages = files.every(isImage);
    for (const { el, tool } of toolTiles) {
      const typeFits = onlyImages ? tool.accept !== 'pdf' : hasPdf && tool.accept !== 'image';
      const multiFits = files.length > 1
        ? tool.multiple && typeFits
        : (tool.id === 'merge' ? !hasPdf : typeFits);
      el.classList.toggle('is-hint', multiFits);
    }
    clear(pendingBar);
    pendingBar.hidden = false;
    pendingBar.append(
      h('span', { class: 'grow' }, h('strong', null, files.length === 1 ? files[0].name : t('home.nFiles', { n: files.length })), ' ', t('home.pickTool')),
      btn(t('common.clear'), { variant: 'ghost', iconName: 'x', onClick: () => {
        pendingFiles = null; pendingBar.hidden = true; toolTiles.forEach(({ el }) => el.classList.remove('is-hint'));
      } }));
    const firstFit = toolTiles.find((x) => x.el.classList.contains('is-hint'));
    firstFit?.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const hero = h('section', { class: 'home-hero' },
    h('div', null,
      h('h1', null, t('home.title')),
      h('p', { class: 'lede' }, t('home.lede')),
      h('ul', { class: 'promise-list' },
        ['home.p1', 'home.p2', 'home.p3'].map((k) => h('li', { html: icons.check }, h('span', null, t(k)))))),
    h('div', null,
      dropzone({ accept: 'pdf+image', multiple: true, title: t('home.dropTitle'), sub: t('home.dropSub'), onFiles: setPending }),
      pendingBar));

  const groupEls = groups.map((g) => h('section', { class: 'tool-group', 'aria-labelledby': `g-${g}` },
    h('h2', { id: `g-${g}` }, t(`group.${g}`)),
    h('div', { class: 'tool-grid' }, tools.filter((x) => x.group === g).map((tool) => {
      const el = h('a', { class: 'tool-tile sheet', href: `#/${tool.id}` },
        h('span', { class: 'tool-ico', html: icons[tool.icon] }),
        h('span', { class: 't-name' }, t(`tool.${tool.id}.name`)),
        h('span', { class: 't-desc' }, t(`tool.${tool.id}.short`)));
      el.addEventListener('click', (e) => {
        if (!pendingFiles) return;
        e.preventDefault();
        const files = pendingFiles.filter((f) => (tool.accept === 'pdf' ? isPdf(f) : tool.accept === 'image' ? isImage(f) : true));
        if (!files.length) { toast(t(tool.accept === 'image' ? 'drop.onlyImages' : 'drop.onlyPdf'), { error: true }); return; }
        if (!tool.multiple && pendingFiles.length > 1) {
          toast(t('home.singleNotice', { name: files[0].name }));
        }
        app.openTool(tool.id, tool.multiple ? files : files.slice(0, 1));
      });
      toolTiles.push({ el, tool });
      return el;
    }))));

  main.append(h('div', { class: 'wrap' }, hero, h('div', { class: 'tool-groups' }, groupEls), historySection()));
}

function historySection() {
  const list = h('ul', { class: 'history-list' });
  const body = h('div');
  const keep = h('input', { type: 'checkbox', checked: history.enabled() });
  keep.addEventListener('change', () => { history.setEnabled(keep.checked); toast(t(keep.checked ? 'history.onToast' : 'history.offToast')); });
  const clearBtn = btn(t('history.clearAll'), {
    variant: 'danger', iconName: 'trash',
    onClick: async () => {
      if (await confirmDialog(t('history.clearConfirm'), { okLabel: t('history.clearAll'), danger: true })) history.clear();
    },
  });

  const refresh = async () => {
    let items;
    try {
      items = await history.list();
    } catch {
      clear(body).append(h('div', { class: 'empty' }, h('strong', null, t('history.unavailable')), t('history.unavailableHint')));
      clearBtn.hidden = true;
      return;
    }
    clearBtn.hidden = !items.length;
    clear(list);
    if (!items.length) {
      clear(body).append(h('div', { class: 'empty' }, h('strong', null, t('history.emptyTitle')), t('history.emptyHint')));
      return;
    }
    for (const item of items) {
      const tool = tools.find((x) => x.id === item.tool);
      const asFile = () => new File([item.blob], item.name, { type: item.type });
      const usable = tools.filter((x) => (item.type === 'application/pdf' ? x.accept !== 'image' : x.accept !== 'pdf'));
      const openIn = toolMenu({ label: t('history.openInShort'), tools: usable, onPick: (id) => app.openTool(id, [asFile()]) });
      openIn.querySelector('.menu-trigger').setAttribute('aria-label', t('history.openIn', { name: item.name }));
      list.append(h('li', { class: 'history-item' },
        h('span', { class: 'h-ico sheet', html: icons[tool?.icon || 'file'] }),
        h('div', null,
          h('div', { class: 'h-name' }, item.name),
          h('div', { class: 'h-meta' }, `${formatSize(item.size)} · ${tool ? t(`tool.${tool.id}.name`) : ''} · ${formatDate(item.date)}`)),
        h('div', { class: 'h-actions' },
          item.type === 'application/pdf' || item.type.startsWith('image/') ? openIn : null,
          iconBtn('download', t('history.download', { name: item.name }), () => downloadBlob(item.blob, item.name)),
          iconBtn('trash', t('history.remove', { name: item.name }), () => history.remove(item.id)))));
    }
    clear(body).append(list);
  };
  const off = onHistoryChange(refresh);
  refresh();

  const section = h('section', { class: 'history', 'aria-labelledby': 'h-title' },
    h('div', { class: 'history-head' },
      h('h2', { id: 'h-title' }, t('history.title')),
      h('label', { class: 'switch' }, keep, t('history.keep')),
      clearBtn),
    h('p', { class: 'history-note' }, t('history.note')),
    body);
  section._cleanup = off;
  return section;
}

function renderTool(main, tool) {
  const files = pendingFiles;
  pendingFiles = null;
  toolDirty = !!files?.length;
  const root = h('div', { class: 'tool-main-area' });
  const side = h('aside', { class: 'tool-side', hidden: true });
  const resultArea = h('div', { class: 'result-area', style: { marginTop: '18px' } });
  const layout = h('div', { class: 'tool-layout' }, h('div', null, root, resultArea), side);

  let cleanup = null;
  const ctx = {
    toolId: tool.id, app, root, side, resultArea, files,
    showSide(v) { side.hidden = !v; layout.classList.toggle('has-side', v); },
    setBusy(v) { main.querySelectorAll('[data-run]').forEach((b) => { b.disabled = v; }); },
    dirty() { toolDirty = true; },
    reset() {
      cleanup?.();
      clear(root); clear(side); clear(resultArea);
      ctx.files = null;
      toolDirty = false;
      ctx.showSide(false);
      cleanup = tool.mount(ctx) || null;
      window.scrollTo({ top: 0 });
    },
  };

  main.append(h('div', { class: 'wrap tool-page' },
    h('div', { class: 'crumbs' }, btn(t('common.allTools'), { variant: 'ghost', iconName: 'back', onClick: async () => {
      if (toolDirty && !(await confirmDialog(t('common.leaveConfirm')))) return;
      toolDirty = false;
      location.hash = '#/';
    } })),
    h('div', { class: 'tool-head' },
      h('span', { class: 'tool-ico', html: icons[tool.icon] }),
      h('div', null, h('h1', null, t(`tool.${tool.id}.name`)), h('p', null, t(`tool.${tool.id}.long`)))),
    layout));
  cleanup = tool.mount(ctx) || null;
  const stopBar = mobileActionBar(main);
  currentTool = { tool, cleanup: () => { cleanup?.(); stopBar(); } };
}

// On phones the options panel sits below long page previews, so the main action is mirrored
// in a bar pinned to the bottom of the screen whenever the real button is scrolled out of view.
function mobileActionBar(main) {
  const proxy = h('button', { type: 'button', class: 'btn btn-primary btn-big btn-block' });
  const bar = h('div', { class: 'mobile-bar', hidden: true }, proxy);
  document.body.append(bar);
  let real = null, realVisible = true;
  const io = new IntersectionObserver(([e]) => { realVisible = e.isIntersecting; sync(); });
  const attrs = new MutationObserver(() => sync());
  let queued = false;
  const sync = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; doSync(); });
  };
  const doSync = () => {
    const found = main.querySelector('[data-run]');
    if (found !== real) {
      io.disconnect(); attrs.disconnect();
      real = found;
      if (real) {
        io.observe(real);
        attrs.observe(real, { attributes: true, childList: true, subtree: true });
      }
    }
    const phone = matchMedia('(max-width: 767px)').matches;
    bar.hidden = !real || !phone || realVisible || !real.offsetParent;
    document.body.classList.toggle('has-mobile-bar', !bar.hidden);
    if (!real) return;
    proxy.innerHTML = real.innerHTML;
    proxy.disabled = real.disabled;
  };
  proxy.addEventListener('click', () => real?.click());
  const tree = new MutationObserver(sync);
  tree.observe(main, { childList: true, subtree: true });
  addEventListener('resize', sync);
  sync();
  return () => { io.disconnect(); attrs.disconnect(); tree.disconnect(); removeEventListener('resize', sync); bar.remove(); document.body.classList.remove('has-mobile-bar'); };
}

function render() {
  currentTool?.cleanup?.();
  currentTool = null;
  appEl.querySelectorAll('section.history').forEach((s) => s._cleanup?.());
  clear(appEl);
  document.title = BRAND_NAME;
  const main = h('main', { id: 'main' });
  const id = location.hash.replace(/^#\/?/, '');
  const tool = tools.find((x) => x.id === id);
  appEl.append(header(), main, footer());
  if (tool) {
    document.title = `${t(`tool.${tool.id}.name`)} · ${BRAND_NAME}`;
    renderTool(main, tool);
  } else {
    renderHome(main);
  }
  window.scrollTo({ top: 0 });
}

window.addEventListener('hashchange', render);
window.addEventListener('beforeunload', (e) => {
  if (toolDirty) { e.preventDefault(); e.returnValue = ''; }
});
// Dropping a file anywhere outside a drop zone would otherwise navigate away and lose work.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

applyTheme(settings.get('theme', null));
setLang(getLang());
render();
