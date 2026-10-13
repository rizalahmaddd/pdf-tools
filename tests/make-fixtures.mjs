import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import fs from 'node:fs';
import zlib from 'node:zlib';
const dir = 'tests/fixtures';

async function textPdf(name, pages, rotateSecond = false) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) {
    const p = doc.addPage([595, 842]);
    p.drawText(`${name} page ${i}`, { x: 60, y: 760, size: 28, font });
    p.drawText('Secret account number 4455-1234 belongs to Budi Santoso.', { x: 60, y: 700, size: 14, font });
    p.drawRectangle({ x: 60, y: 300, width: 200, height: 150, color: rgb(0.8, 0.4, 0.2) });
    if (rotateSecond && i === 2) p.setRotation(degrees(90));
  }
  fs.writeFileSync(`${dir}/${name}.pdf`, await doc.save());
}

// A big noisy RGB image stored with FlateDecode, like many scanner or Word exports produce.
async function imagePdf() {
  const doc = await PDFDocument.create();
  const w = 1600, h = 1200;
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 3;
    raw[o] = (x * 255) / w; raw[o + 1] = (y * 255) / h; raw[o + 2] = (Math.sin(x / 20) * 60 + 128 + Math.random() * 40) | 0;
  }
  const stream = doc.context.flateStream(raw, { Type: 'XObject', Subtype: 'Image', Width: w, Height: h, ColorSpace: 'DeviceRGB', BitsPerComponent: 8 });
  const ref = doc.context.register(stream);
  const page = doc.addPage([595, 842]);
  page.node.setXObject(doc.context.obj('Im1'), ref);
  const { pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject } = await import('pdf-lib');
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(500, 0, 0, 375, 47, 300), drawObject('Im1'), popGraphicsState());
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Photo report', { x: 60, y: 760, size: 24, font });
  fs.writeFileSync(`${dir}/photo.pdf`, await doc.save());
}

async function formPdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const form = doc.getForm();
  page.drawText('Full name', { x: 60, y: 745, size: 12, font });
  form.createTextField('full_name').addToPage(page, { x: 160, y: 738, width: 300, height: 24 });
  page.drawText('Agree', { x: 60, y: 700, size: 12, font });
  form.createCheckBox('agree').addToPage(page, { x: 160, y: 696, width: 18, height: 18 });
  const dd = form.createDropdown('city');
  dd.addOptions(['Jakarta', 'Malang', 'Surabaya']);
  page.drawText('City', { x: 60, y: 655, size: 12, font });
  dd.addToPage(page, { x: 160, y: 648, width: 200, height: 24 });
  const rg = form.createRadioGroup('size');
  page.drawText('Size', { x: 60, y: 610, size: 12, font });
  rg.addOptionToPage('S', page, { x: 160, y: 606, width: 16, height: 16 });
  rg.addOptionToPage('L', page, { x: 200, y: 606, width: 16, height: 16 });
  fs.writeFileSync(`${dir}/form.pdf`, await doc.save());
}

await textPdf('report', 5, true);
await textPdf('annex', 2);
await imagePdf();
await formPdf();
console.log(fs.readdirSync(dir));
{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([842, 595]);
  p.drawText('Landscape employee leave report', { x: 40, y: 540, size: 18, font });
  for (let r = 0; r < 6; r++) {
    p.drawRectangle({ x: 40, y: 480 - r * 24, width: 760, height: 22, borderColor: rgb(0.2, 0.4, 0.3), borderWidth: 0.5, color: r ? undefined : rgb(0.15, 0.4, 0.3) });
    p.drawText(r ? `EMP-2026-000${r}   Budi Santoso   Operasional   05 Okt 2026   Disetujui` : 'NO  NIK  NAMA  DEPARTEMEN  STATUS', { x: 48, y: 487 - r * 24, size: 10, font, color: r ? rgb(0, 0, 0) : rgb(1, 1, 1) });
  }
  fs.writeFileSync(`${dir}/landscape.pdf`, await doc.save());
}
