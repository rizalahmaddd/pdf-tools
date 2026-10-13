import {
  PDFDocument, StandardFonts, pushGraphicsState, popGraphicsState, beginText, endText,
  setFontAndSize, setTextRenderingMode, TextRenderingMode, rotateAndSkewTextDegreesAndTranslate, showText,
} from 'pdf-lib';
import { h, btn, clear } from '../ui/dom.js';
import { t, plural, getLang } from '../i18n.js';
import { dropzone, checkbox, notice } from '../ui/components.js';
import { isPdf, readBytes, loadPdfLib, pdfBlob, baseName } from '../lib/files.js';
import { openPdf, renderPage } from '../lib/pdfjs.js';
import { embedImageFile, addImagePage } from '../lib/images.js';
import { createOcr } from '../lib/ocr.js';
import { runJob, errorMessage } from './common.js';

const OCR_DPI = 250;
const MAX_SIDE = 3400;

function wordsOf(data) {
  const out = [];
  for (const b of data.blocks || []) {
    for (const p of b.paragraphs || []) {
      for (const l of p.lines || []) {
        for (const w of l.words || []) {
          if (w.text?.trim() && w.confidence > 20) out.push({ text: w.text.trim(), bbox: w.bbox });
        }
      }
    }
  }
  return out;
}

// Writes each recognised word as invisible text over the page, so it can be searched and copied.
function addTextLayer(page, font, words, imgW, imgH, toPdf) {
  const key = page.node.newFontDictionary(font.name, font.ref);
  const ops = [pushGraphicsState(), beginText(), setTextRenderingMode(TextRenderingMode.Invisible)];
  let count = 0;
  for (const w of words) {
    let encoded;
    try { encoded = font.encodeText(w.text); } catch { continue; }
    const frac = { x: w.bbox.x0 / imgW, y: w.bbox.y0 / imgH, w: (w.bbox.x1 - w.bbox.x0) / imgW, h: (w.bbox.y1 - w.bbox.y0) / imgH };
    const b = toPdf(frac);
    const unit = font.widthOfTextAtSize(w.text, 1) || 1;
    const size = Math.max(1, Math.min(b.height * 1.1, b.width / unit));
    ops.push(
      setFontAndSize(key, size),
      rotateAndSkewTextDegreesAndTranslate(b.rotate, 0, 0, b.x, b.y + (b.rotate ? 0 : b.height * 0.18)),
      showText(encoded));
    count++;
  }
  ops.push(endText(), popGraphicsState());
  if (count) page.pushOperators(...ops);
}

export default {
  id: 'ocr',
  icon: 'ocr',
  group: 'convert',
  accept: 'pdf+image',
  multiple: true,
  mount(ctx) {
    const { root, side } = ctx;
    const state = { eng: true, ind: getLang() === 'id', skipText: true, files: [] };
    let cancelled = false;
    const status = h('div');
    const runBtn = btn(t('ocr.run'), { variant: 'primary', big: true, block: true, iconName: 'ocr', onClick: () => run() });
    runBtn.dataset.run = '';
    const stopBtn = btn(t('ocr.stop'), { variant: 'danger', block: true, onClick: () => { cancelled = true; stopBtn.disabled = true; } });
    stopBtn.hidden = true;

    const setFiles = (files) => {
      state.files = files;
      ctx.dirty();
      show();
    };

    const show = () => {
      if (!state.files.length) {
        ctx.showSide(false);
        clear(root).append(dropzone({ accept: 'pdf+image', multiple: true, title: t('ocr.dropTitle'), sub: t('ocr.dropSub'), onFiles: setFiles }));
        return;
      }
      ctx.showSide(true);
      clear(root).append(h('div', { class: 'panel' },
        h('h3', null, state.files.length === 1 ? state.files[0].name : plural(state.files.length, 'common.oneFile', 'common.nFiles')),
        h('p', { class: 'muted' }, t('ocr.explain')),
        h('p', { class: 'muted small', style: { marginTop: '8px' } }, t('ocr.speed'))));
    };

    const validate = () => {
      runBtn.disabled = !(state.eng || state.ind);
    };

    side.append(h('div', { class: 'panel' },
      h('h3', null, t('ocr.language')),
      checkbox('English', state.eng, (v) => { state.eng = v; validate(); }),
      checkbox('Bahasa Indonesia', state.ind, (v) => { state.ind = v; validate(); }),
      h('p', { class: 'hint muted small' }, t('ocr.languageHint')),
      checkbox(t('ocr.skipText'), state.skipText, (v) => { state.skipText = v; }, t('ocr.skipTextHint')),
      status,
      h('div', { class: 'panel-actions' }, runBtn, stopBtn)));

    const run = () => {
      cancelled = false;
      stopBtn.hidden = false;
      stopBtn.disabled = false;
      return runJob(ctx, async (progress) => {
        const langs = [state.ind && 'ind', state.eng && 'eng'].filter(Boolean);
        progress(0, t('ocr.loadingEngine'));
        let current = { i: 0, total: 1, fileIndex: 0, totalFiles: 1 };
        const ocr = await createOcr(langs, (m) => {
          if (m.status === 'recognizing text') {
            const fileFrac = (current.i + m.progress) / current.total;
            const frac = (current.fileIndex + fileFrac) / current.totalFiles;
            progress(frac, current.totalFiles > 1
              ? `${current.fileName || ''}: ${t('ocr.readingPage', { n: current.i + 1, total: current.total })}`
              : t('ocr.readingPage', { n: current.i + 1, total: current.total }));
          }
        });
        try {
          if (state.files.every((f) => !isPdf(f))) {
            return await ocrImages(ocr, state.files, progress, current);
          }
          if (state.files.length === 1) {
            return await ocrPdf(ocr, state.files[0], progress, current, 0, 1);
          }
          const outFiles = [];
          let totalDone = 0, totalSkipped = 0, totalWords = 0;
          for (let f = 0; f < state.files.length; f++) {
            current.fileName = state.files[f].name;
            const res = isPdf(state.files[f])
              ? await ocrPdf(ocr, state.files[f], progress, current, f, state.files.length)
              : await ocrImages(ocr, [state.files[f]], progress, current, f, state.files.length);
            outFiles.push(...res.files);
            totalDone += res.done || 0;
            totalSkipped += res.skipped || 0;
            totalWords += res.words || 0;
          }
          return {
            files: outFiles,
            summary: [
              t('ocr.done', { pages: plural(totalDone, 'common.onePage', 'common.nFiles'), words: totalWords }),
              totalSkipped ? t('ocr.skipped', { n: totalSkipped }) : '',
              !totalWords ? t('ocr.noWords') : '',
            ].filter(Boolean).join(' '),
          };
        } finally {
          ocr.terminate();
          stopBtn.hidden = true;
        }
      }, { label: t('ocr.loadingEngine') });
    };

    const checkCancel = () => { if (cancelled) throw new Error(t('ocr.stopped')); };

    const ocrPdf = async (ocr, file, progress, current, fileIndex = 0, totalFiles = 1) => {
      const bytes = await readBytes(file);
      const doc = await openPdf(bytes);
      const lib = await loadPdfLib(bytes);
      const font = await lib.embedFont(StandardFonts.Helvetica);
      const pages = lib.getPages();
      const texts = [];
      let done = 0, skipped = 0;
      current.total = doc.numPages;
      current.fileIndex = fileIndex;
      current.totalFiles = totalFiles;
      for (let i = 0; i < doc.numPages; i++) {
        checkCancel();
        current.i = i;
        const page = await doc.getPage(i + 1);
        if (state.skipText) {
          const tc = await page.getTextContent();
          const existing = tc.items.map((x) => x.str).join(' ').trim();
          if (existing.length > 30) {
            texts.push(existing);
            skipped++;
            continue;
          }
        }
        const fileFraction = (i / doc.numPages);
        const overallFraction = (fileIndex + fileFraction) / totalFiles;
        progress(overallFraction, totalFiles > 1 ? `${file.name}: ${t('ocr.readingPage', { n: i + 1, total: doc.numPages })}` : t('ocr.readingPage', { n: i + 1, total: doc.numPages }));
        const vp1 = page.getViewport({ scale: 1 });
        const scale = Math.min(OCR_DPI / 72, MAX_SIDE / Math.max(vp1.width, vp1.height));
        const canvas = await renderPage(page, { scale });
        const data = await ocr.recognize(canvas);
        texts.push(data.text.trim());
        addTextLayer(pages[i], font, wordsOf(data), canvas.width, canvas.height, (f) => {
          const [ax, ay] = vp1.convertToPdfPoint(f.x * vp1.width, (f.y + f.h) * vp1.height);
          return { x: ax, y: ay, width: f.w * vp1.width, height: f.h * vp1.height, rotate: page.rotate % 360 };
        });
        canvas.width = canvas.height = 0;
        page.cleanup();
        done++;
      }
      await doc.loadingTask.destroy();
      progress((fileIndex + 0.97) / totalFiles, t('common.saving'));
      const base = baseName(file.name);
      const out = await lib.save({ useObjectStreams: true });
      return result(base, out, texts, done, skipped);
    };

    const ocrImages = async (ocr, files, progress, current) => {
      const out = await PDFDocument.create();
      const font = await out.embedFont(StandardFonts.Helvetica);
      const texts = [];
      current.total = files.length;
      for (let i = 0; i < files.length; i++) {
        checkCancel();
        current.i = i;
        progress(i / files.length, t('ocr.readingPage', { n: i + 1, total: files.length }));
        let embedded;
        try {
          embedded = await embedImageFile(out, files[i]);
        } catch (e) {
          throw new Error(`${files[i].name}: ${errorMessage(e)}`);
        }
        const page = addImagePage(out, embedded, { size: 'fit' });
        const bmpUrl = URL.createObjectURL(files[i]);
        let data;
        try {
          const img = new Image();
          img.src = bmpUrl;
          await img.decode();
          const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
          const c = document.createElement('canvas');
          c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
          const g = c.getContext('2d');
          g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
          g.drawImage(img, 0, 0, c.width, c.height);
          data = await ocr.recognize(c);
          const { width: pw, height: ph } = page.getSize();
          addTextLayer(page, font, wordsOf(data), c.width, c.height, (f) => ({
            x: f.x * pw, y: ph - (f.y + f.h) * ph, width: f.w * pw, height: f.h * ph, rotate: 0,
          }));
        } finally {
          URL.revokeObjectURL(bmpUrl);
        }
        texts.push(data.text.trim());
      }
      progress(0.97, t('common.saving'));
      const base = files.length === 1 ? baseName(files[0].name) : 'scanned-images';
      return result(base, await out.save({ useObjectStreams: true }), texts, files.length, 0);
    };

    const result = (base, pdfBytes, texts, done, skipped) => {
      const text = texts.map((x, i) => `--- ${t('common.pageN', { n: i + 1 })} ---\n${x}`).join('\n\n');
      const words = texts.join(' ').split(/\s+/).filter(Boolean).length;
      return {
        files: [
          { name: `${base}-searchable.pdf`, blob: pdfBlob(pdfBytes) },
          { name: `${base}-text.txt`, blob: new Blob([text], { type: 'text/plain;charset=utf-8' }) },
        ],
        done,
        skipped,
        words,
        summary: [
          t('ocr.done', { pages: plural(done, 'common.onePage', 'common.nPages'), words }),
          skipped ? t('ocr.skipped', { n: skipped }) : '',
          !words ? t('ocr.noWords') : '',
        ].filter(Boolean).join(' '),
      };
    };

    if (ctx.files?.length) setFiles(ctx.files); else show();
    validate();
  },
};
