import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';

export const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
export const isImage = (f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(f.name);

export async function readBytes(file) {
  return new Uint8Array(await file.arrayBuffer());
}

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 2 : 1)} MB`;
}

export function baseName(name) {
  return name.replace(/\.[^.]+$/, '');
}

export function pdfBlob(bytes) {
  return new Blob([bytes], { type: 'application/pdf' });
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function zipFiles(files) {
  const zip = new JSZip();
  const used = new Set();
  for (const f of files) {
    let name = f.name;
    for (let i = 2; used.has(name); i++) name = f.name.replace(/(\.[^.]+)?$/, `-${i}$1`);
    used.add(name);
    zip.file(name, f.blob);
  }
  return zip.generateAsync({ type: 'blob', compression: 'STORE' });
}

export class EncryptedPdfError extends Error {
  constructor() {
    super('encrypted');
    this.code = 'encrypted';
  }
}

export async function loadPdfLib(bytes) {
  let doc;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    if (/encrypted/i.test(e.message)) throw new EncryptedPdfError();
    throw e;
  }
  return doc;
}

export function parseRanges(text, max) {
  const groups = [];
  for (const part of text.split(/[,;]+/)) {
    const s = part.trim();
    if (!s) continue;
    const m = s.match(/^(\d+)?\s*-\s*(\d+)?$/);
    let from, to;
    if (m) {
      from = m[1] ? +m[1] : 1;
      to = m[2] ? +m[2] : max;
    } else if (/^\d+$/.test(s)) {
      from = to = +s;
    } else {
      throw new RangeError(s);
    }
    if (from < 1 || to > max || from > to) throw new RangeError(s);
    const pages = [];
    for (let p = from; p <= to; p++) pages.push(p - 1);
    groups.push({ label: from === to ? `${from}` : `${from}-${to}`, pages });
  }
  return groups;
}

export function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.9) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas export failed'))), type, quality));
}

export async function loadImageBitmap(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}
