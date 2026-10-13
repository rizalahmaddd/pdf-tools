import { PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown, PDFOptionList, PDFSignature, PDFName, PDFBool } from 'pdf-lib';
import { h, btn, clear } from '../ui/dom.js';
import { t, plural } from '../i18n.js';
import { checkbox, notice } from '../ui/components.js';
import { createViewer, pdfRectToFraction } from '../ui/viewer.js';
import { loadPdfLib, pdfBlob, baseName } from '../lib/files.js';
import { runJob, loadPdf, pickFiles, loadingState, showError } from './common.js';

function widgetPageIndex(lib, widget, pageRefs) {
  const p = widget.P();
  if (p) {
    const i = pageRefs.findIndex((r) => r === p || r.toString() === p.toString());
    if (i >= 0) return i;
  }
  const ref = lib.context.getObjectRef(widget.dict);
  if (!ref) return -1;
  return lib.getPages().findIndex((page) => {
    const annots = page.node.Annots();
    return annots?.asArray().some((a) => a.toString() === ref.toString());
  });
}

export default {
  id: 'fill',
  icon: 'form',
  group: 'sign',
  accept: 'pdf',
  multiple: false,
  mount(ctx) {
    const { root, side } = ctx;
    let viewer;

    const start = async ([file]) => {
      ctx.dirty();
      loadingState(root);
      try {
        const src = await loadPdf(file);
        const lib = await loadPdfLib(src.bytes);
        await build(src, lib);
      } catch (e) {
        showError(root, e, () => pickFiles(root, {}, start));
      }
    };

    const build = async (src, lib) => {
      const form = lib.getForm();
      const hadXfa = form.hasXFA();
      if (hadXfa) form.deleteXFA();
      const fields = form.getFields().filter((f) => !(f instanceof PDFSignature));
      const hasSignatureField = form.getFields().some((f) => f instanceof PDFSignature);

      if (!fields.length) {
        ctx.showSide(false);
        clear(root).append(h('div', { class: 'empty' },
          h('strong', null, t('fill.noFields')),
          h('p', { style: { margin: '6px 0 14px' } }, t('fill.noFieldsHint')),
          btn(t('fill.openSign'), { variant: 'primary', iconName: 'sign', onClick: () => ctx.app.openTool('sign', [src.file]) })));
        return;
      }

      viewer = await createViewer(src.doc);
      const pageRefs = lib.getPages().map((p) => p.ref);
      const controls = [];

      for (const field of fields) {
        const widgets = field.acroField.getWidgets();
        const readOnly = field.isReadOnly();
        const name = field.getName();
        const radioOptions = field instanceof PDFRadioGroup ? field.getOptions() : null;
        widgets.forEach((widget, wi) => {
          const pi = widgetPageIndex(lib, widget, pageRefs);
          const p = viewer.pages[pi];
          if (!p) return;
          const r = widget.getRectangle();
          const f = pdfRectToFraction(p.vp1, [r.x, r.y, r.x + r.width, r.y + r.height]);
          const box = { left: f.x, top: f.y, width: f.w, height: f.h };
          const hPt = f.h * p.vp1.height;
          let el;
          if (field instanceof PDFTextField) {
            if (wi > 0) return;
            const multi = field.isMultiline();
            el = multi ? h('textarea', { class: 'form-input' }) : h('input', { class: 'form-input', type: 'text' });
            el.value = field.getText() || '';
            const max = field.getMaxLength();
            if (max) el.maxLength = max;
            controls.push({ el });
            el._fontPt = multi ? 10 : Math.max(6, Math.min(12, hPt * 0.65));
          } else if (field instanceof PDFCheckBox) {
            el = h('input', { class: 'form-input', type: 'checkbox', checked: field.isChecked() });
            if (wi === 0) controls.push({ el });
          } else if (field instanceof PDFRadioGroup) {
            const option = radioOptions[wi];
            el = h('input', { class: 'form-input', type: 'radio', name: `radio-${name}`, checked: field.getSelected() === option });
            controls.push({ el });
          } else if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
            if (wi > 0) return;
            const current = field.getSelected()[0] || '';
            el = h('select', { class: 'form-input' }, h('option', { value: '' }, ''),
              field.getOptions().map((o) => h('option', { value: o, selected: o === current }, o)));
            controls.push({ el });
            el._fontPt = Math.max(6, Math.min(12, hPt * 0.6));
          } else {
            return;
          }
          el.disabled = readOnly;
          el.setAttribute('aria-label', name);
          el.title = name;
          el.addEventListener('input', () => ctx.dirty());
          Object.assign(el.style, {
            left: `${box.left * 100}%`, top: `${box.top * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%`,
          });
          el._page = p;
          p.overlay.append(el);
        });
      }

      const fitFonts = () => controls.forEach(({ el }) => {
        if (!el._fontPt) return;
        const cssW = el._page.overlay.getBoundingClientRect().width;
        el.style.fontSize = `${(el._fontPt * cssW) / el._page.vp1.width}px`;
      });
      window.addEventListener('resize', fitFonts);
      cleanupFns.push(() => window.removeEventListener('resize', fitFonts));

      let flatten = false;
      const runBtn = btn(t('fill.run'), { variant: 'primary', big: true, block: true, iconName: 'check', onClick: () => run() });
      runBtn.dataset.run = '';
      clear(root).append(h('p', { class: 'muted small', style: { marginBottom: '12px' } }, t('fill.hint')), viewer.el);
      clear(side).append(h('div', { class: 'panel' },
        h('h3', null, plural(fields.length, 'fill.oneField', 'fill.nFields')),
        hadXfa ? notice(t('fill.xfa'), 'warn') : null,
        hasSignatureField ? notice(t('fill.sigField')) : null,
        checkbox(t('fill.flatten'), flatten, (v) => { flatten = v; }, t('fill.flattenHint')),
        h('div', { class: 'panel-actions' }, runBtn,
          btn(t('fill.clearAll'), { variant: 'ghost', onClick: () => controls.forEach(({ el }) => {
            if (el.disabled) return;
            if (el.type === 'checkbox' || el.type === 'radio') el.checked = false; else el.value = '';
          }) }))));
      ctx.showSide(true);
      requestAnimationFrame(fitFonts);

      const run = () => runJob(ctx, async (progress) => {
        progress(0.2, t('fill.working'));
        const out = await loadPdfLib(src.bytes);
        const outForm = out.getForm();
        if (outForm.hasXFA()) outForm.deleteXFA();
        // Re-bind the controls to fields of the fresh copy, so filling twice never stacks changes.
        const byName = new Map(outForm.getFields().map((f) => [f.getName(), f]));
        const origByName = new Map(fields.map((f) => [f.getName(), f]));
        for (const c of controls) {
          const name = c.el.getAttribute('aria-label');
          const target = byName.get(name);
          if (target) applyTo(target, origByName.get(name), c);
        }
        let unsupportedChars = false;
        try {
          outForm.updateFieldAppearances();
        } catch {
          // Standard PDF fonts cannot draw some scripts; let the reader app draw those fields instead.
          unsupportedChars = true;
          out.catalog.getOrCreateAcroForm().dict.set(PDFName.of('NeedAppearances'), PDFBool.True);
        }
        if (flatten && !unsupportedChars) outForm.flatten();
        progress(0.85, t('common.saving'));
        const bytes = await out.save({ updateFieldAppearances: !unsupportedChars });
        return {
          files: [{ name: `${baseName(src.file.name)}-filled.pdf`, blob: pdfBlob(bytes) }],
          summary: unsupportedChars ? t('fill.charsNote') : null,
        };
      });
    };

    function applyTo(target, orig, c) {
      const el = c.el;
      if (target instanceof PDFTextField) target.setText(el.value || undefined);
      else if (target instanceof PDFCheckBox) { if (el.checked) target.check(); else target.uncheck(); }
      else if (target instanceof PDFRadioGroup) {
        if (el.checked) {
          const opts = orig.getOptions();
          const siblings = [...document.getElementsByName(el.name)];
          target.select(opts[siblings.indexOf(el)] ?? opts[0]);
        }
      } else if (target instanceof PDFDropdown || target instanceof PDFOptionList) {
        if (el.value) target.select(el.value); else target.clear();
      }
    }

    const cleanupFns = [];
    if (ctx.files?.length) start(ctx.files); else pickFiles(root, {}, start);
    return () => { viewer?.destroy(); cleanupFns.forEach((f) => f()); };
  },
};
