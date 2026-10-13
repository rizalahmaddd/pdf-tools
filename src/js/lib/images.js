import { loadImageBitmap, canvasToBlob } from './files.js';

export const PAGE_SIZES = {
  a4: [595.28, 841.89],
  letter: [612, 792],
  legal: [612, 1008],
};

// Browsers apply EXIF rotation when drawing to a canvas, pdf-lib does not,
// so photos are always re-encoded through a canvas before embedding.
export async function embedImageFile(pdfDoc, file, { maxSide = 4000 } = {}) {
  const bmp = await loadImageBitmap(file);
  const w0 = bmp.width, h0 = bmp.height;
  const k = Math.min(1, maxSide / Math.max(w0, h0));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w0 * k);
  canvas.height = Math.round(h0 * k);
  const ctx = canvas.getContext('2d');
  const keepAlpha = /png|gif|webp/i.test(file.type);
  if (!keepAlpha) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  const png = keepAlpha && hasTransparency(ctx, canvas.width, canvas.height);
  const blob = await canvasToBlob(canvas, png ? 'image/png' : 'image/jpeg', 0.9);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const image = png ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
  return { image, width: w0, height: h0 };
}

function hasTransparency(ctx, w, h) {
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 40000)));
  const data = ctx.getImageData(0, 0, w, h).data;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      if (data[(y * w + x) * 4 + 3] < 250) return true;
    }
  }
  return false;
}

export function addImagePage(pdfDoc, { image, width, height }, { size = 'fit', orientation = 'auto', margin = 0 } = {}) {
  let pw, ph;
  if (size === 'fit') {
    pw = width * 0.75 + margin * 2;
    ph = height * 0.75 + margin * 2;
  } else {
    [pw, ph] = PAGE_SIZES[size];
    const landscape = orientation === 'landscape' || (orientation === 'auto' && width > height);
    if (landscape) [pw, ph] = [ph, pw];
  }
  const page = pdfDoc.addPage([pw, ph]);
  const boxW = pw - margin * 2, boxH = ph - margin * 2;
  const k = size === 'fit' ? 0.75 : Math.min(boxW / width, boxH / height);
  const dw = width * k, dh = height * k;
  page.drawImage(image, { x: (pw - dw) / 2, y: (ph - dh) / 2, width: dw, height: dh });
  return page;
}
