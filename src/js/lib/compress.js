import { PDFDocument, PDFName, PDFRawStream, PDFNumber, PDFArray, PDFDict, PDFRef, PDFBool } from 'pdf-lib';
import { canvasToBlob } from './files.js';
import { openPdf, renderPage } from './pdfjs.js';

const N = (s) => PDFName.of(s);

function componentsOf(ctx, cs) {
  cs = cs instanceof PDFRef ? ctx.lookup(cs) : cs;
  if (cs === N('DeviceRGB')) return 3;
  if (cs === N('DeviceGray')) return 1;
  if (cs instanceof PDFArray && cs.lookup(0) === N('ICCBased')) {
    const icc = cs.lookup(1);
    const n = icc?.dict?.get(N('N'));
    const v = n instanceof PDFNumber ? n.asNumber() : 0;
    return v === 3 || v === 1 ? v : 0;
  }
  return 0;
}

function singleFilter(dict) {
  const f = dict.lookup(N('Filter'));
  if (f instanceof PDFName) return f.asString();
  if (f instanceof PDFArray && f.size() === 1) return f.lookup(0).asString();
  return f ? 'multi' : 'none';
}

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function decodeImage(ctx, dict, contents) {
  const filter = singleFilter(dict);
  const w = dict.lookup(N('Width'))?.asNumber?.();
  const h = dict.lookup(N('Height'))?.asNumber?.();
  const bpc = dict.lookup(N('BitsPerComponent'))?.asNumber?.();
  const comps = componentsOf(ctx, dict.get(N('ColorSpace')));
  if (!w || !h || !comps) return null;
  if (dict.has(N('Decode'))) return null;

  if (filter === '/DCTDecode') {
    return createImageBitmap(new Blob([contents], { type: 'image/jpeg' }));
  }
  if (filter === '/FlateDecode' && bpc === 8) {
    const parms = dict.lookup(N('DecodeParms'));
    const predictor = parms instanceof PDFDict ? parms.lookup(N('Predictor'))?.asNumber?.() : 1;
    if (predictor && predictor > 1) return null;
    const raw = await inflate(contents);
    if (raw.length < w * h * comps) return null;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0, j = 0; i < w * h; i++, j += comps) {
      const o = i * 4;
      if (comps === 3) { rgba[o] = raw[j]; rgba[o + 1] = raw[j + 1]; rgba[o + 2] = raw[j + 2]; }
      else { rgba[o] = rgba[o + 1] = rgba[o + 2] = raw[j]; }
      rgba[o + 3] = 255;
    }
    return createImageBitmap(new ImageData(rgba, w, h));
  }
  return null;
}

// Re-encodes embedded photos as smaller JPEGs. Text and vector graphics are left untouched.
export async function recompressImages(bytes, { maxSide, quality, onProgress }) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const ctx = doc.context;
  const all = ctx.enumerateIndirectObjects();

  const maskRefs = new Set();
  for (const [, obj] of all) {
    if (obj instanceof PDFRawStream && obj.dict.get(N('Subtype')) === N('Image')) {
      const sm = obj.dict.get(N('SMask'));
      if (sm instanceof PDFRef) maskRefs.add(sm.toString());
      const m = obj.dict.get(N('Mask'));
      if (m instanceof PDFRef) maskRefs.add(m.toString());
    }
  }
  const images = all.filter(([ref, obj]) =>
    obj instanceof PDFRawStream && obj.dict.get(N('Subtype')) === N('Image')
    && !maskRefs.has(ref.toString()) && obj.dict.get(N('ImageMask')) !== PDFBool.True);

  let changed = 0;
  for (let i = 0; i < images.length; i++) {
    onProgress?.(i / Math.max(1, images.length));
    const [ref, obj] = images[i];
    let bmp;
    try {
      bmp = await decodeImage(ctx, obj.dict, obj.contents);
    } catch {
      bmp = null;
    }
    if (!bmp) continue;
    const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bmp.width * k));
    canvas.height = Math.max(1, Math.round(bmp.height * k));
    const c2d = canvas.getContext('2d');
    c2d.fillStyle = '#fff';
    c2d.fillRect(0, 0, canvas.width, canvas.height);
    c2d.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const jpeg = new Uint8Array(await (await canvasToBlob(canvas, 'image/jpeg', quality)).arrayBuffer());
    if (jpeg.length >= obj.contents.length * 0.9) continue;

    const dict = obj.dict.clone(ctx);
    dict.set(N('Filter'), N('DCTDecode'));
    dict.set(N('ColorSpace'), N('DeviceRGB'));
    dict.set(N('BitsPerComponent'), PDFNumber.of(8));
    dict.set(N('Width'), PDFNumber.of(canvas.width));
    dict.set(N('Height'), PDFNumber.of(canvas.height));
    dict.delete(N('DecodeParms'));
    dict.delete(N('Length'));
    ctx.assign(ref, PDFRawStream.of(dict, jpeg));
    changed++;
  }
  onProgress?.(1);
  const out = await doc.save({ useObjectStreams: true });
  return { bytes: out, changed, total: images.length };
}

// Last-resort mode for scans: every page becomes one JPEG. Text stops being selectable.
export async function rasterizePdf(bytes, { dpi, quality, onProgress }) {
  const src = await openPdf(bytes);
  const out = await PDFDocument.create();
  for (let i = 1; i <= src.numPages; i++) {
    onProgress?.((i - 1) / src.numPages);
    const page = await src.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const canvas = await renderPage(page, { scale: dpi / 72 });
    const jpeg = new Uint8Array(await (await canvasToBlob(canvas, 'image/jpeg', quality)).arrayBuffer());
    const img = await out.embedJpg(jpeg);
    const p = out.addPage([vp.width, vp.height]);
    p.drawImage(img, { x: 0, y: 0, width: vp.width, height: vp.height });
    canvas.width = canvas.height = 0;
    page.cleanup();
  }
  await src.loadingTask.destroy();
  onProgress?.(1);
  return { bytes: await out.save({ useObjectStreams: true }) };
}
