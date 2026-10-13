# Dokumentasi Teknis

Dokumentasi arsitektur, modul engine, alur pemrosesan, dan panduan teknis pengembangan **PDF Toolkit**.

---

## 1. Arsitektur Client-Side & Offline-First

Aplikasi ini dirancang dengan prinsip **Zero-Server Processing** dan **100% Client-Side Privacy**. Tidak ada data dokumen yang dikirim ke server backend mana pun.

```
                      ┌─────────────────────────────────────────┐
                      │             Browser Client              │
                      │  (HTML5 / Modern JavaScript ES2022)     │
                      └────┬───────────────┬───────────────┬────┘
                           │               │               │
            ┌──────────────▼─────┐  ┌──────▼──────┐  ┌─────▼───────────────┐
            │   pdf-lib Engine   │  │   PDF.js    │  │ Tesseract.js (WASM) │
            │  (Manipulasi PDF)  │  │  (Renderer) │  │  (Optical OCR Core) │
            └────────────────────┘  └─────────────┘  └─────────────────────┘
                           │               │               │
                           └───────────────┼───────────────┘
                                           │
                           ┌───────────────▼───────────────┐
                           │      Web Workers / Blobs      │
                           │   (Thread Terpisah di Latar)  │
                           └───────────────────────────────┘
```

### Solusi Protokol `file://` (Bypass Pembatasan Browser)
Saat file HTML dibuka langsung dari media penyimpanan (klik ganda tanpa server HTTP lokal), peramban modern (Chrome, Edge, Safari, Firefox) memberlakukan kebijakan CORS ketat yang memblokir `fetch()` lokal dan pemanggilan worker `new Worker('file://...')`.

Untuk mengatasi ini:
1. Skrip pembangun (`build.mjs`) mengonversi file worker PDF.js, Tesseract.js Core, dan data model bahasa (`traineddata.gz`) menjadi format **Base64 string**.
2. Di runtime, worker dan modul WASM diinisialisasi melalui **Blob URL** (`URL.createObjectURL(new Blob([code], { type: 'application/javascript' }))`).
3. Dengan pendekatan ini, aplikasi dapat berjalan identik baik saat dihosting di server statis (`https://pdf.solusikoding.com`) maupun saat dijalankan offline tanpa koneksi internet sama sekali.

---

## 2. Peta Modul & Struktur Kode

| Modul / Komponen | Berkas Sumber | Fungsi & Engine |
|---|---|---|
| **Entry Point & Router** | `src/js/main.js` | Inisialisasi antarmuka, routing navigasi antar-alat, batch processing queue, drag-and-drop global, tema (dark/light). |
| **Konfigurasi & i18n** | `src/js/config.js`<br>`src/js/i18n.js`<br>`src/js/i18n/{id,en}.js` | Metadata aplikasi, toggle bahasa Indonesia & Inggris tanpa reload halaman. |
| **Gabung PDF (Merge)** | `src/js/tools/merge.js` | Menggabungkan banyak dokumen PDF menjadi satu berkas berurutan via `pdf-lib`. |
| **Pisah PDF (Split)** | `src/js/tools/split.js` | Ekstraksi rentang halaman tertentu atau pemisahan file per halaman. |
| **Atur Halaman (Organize)** | `src/js/tools/organize.js` | Thumbnail visual interaktif dengan `SortableJS` untuk rotasi, reorder drag-and-drop, dan hapus halaman. |
| **Tanda Tangan (Sign)** | `src/js/tools/sign.js` | Kanvas tanda tangan bebas, stempel gambar transparan, dan penempatan presisi di atas viewer `PDF.js` sebelum di-embed via `pdf-lib`. |
| **Isi Formulir (Fill Form)** | `src/js/tools/fill.js` | Deteksi otomatis form field (AcroForms: Text, Checkbox, Dropdown) dan pengisian interaktif. |
| **Redaksi (Redact)** | `src/js/tools/redact.js` | Penarikan kotak sensor hitam permanen pada teks atau area rahasia. |
| **Kompresi PDF** | `src/js/tools/compress.js` | Raster rendering ulang tiap halaman ke resolusi terkontrol dengan kompresi JPEG adaptif. |
| **OCR (Optical Character Recognition)** | `src/js/tools/ocr.js` | Pengenalan karakter teks dari pindaian menggunakan Tesseract LSTM WASM (`eng` & `ind`). |
| **Ekstrak Teks** | `src/js/tools/extract-text.js` | Pembacaan stream teks murni dari dokumen PDF via `PDF.js` TextContent API. |
| **Watermark** | `src/js/tools/watermark.js` | Pembubuhan teks tanda air kustom dengan kontrol sudut putar, opasitas, font, dan warna. |
| **Nomor Halaman** | `src/js/tools/page-numbers.js` | Penomoran halaman otomatis dengan fleksibilitas format (`Halaman {n} dari {total}`, dsb.) dan posisi 9-titik. |
| **PDF ke Gambar** | `src/js/tools/to-image.js` | Konversi halaman PDF menjadi berkas gambar PNG/JPEG beresolusi tinggi, diarsipkan otomatis via `JSZip`. |
| **Gambar ke PDF** | `src/js/tools/from-image.js` | Kompilasi gambar raster (JPG, PNG, WebP) menjadi lembar dokumen PDF rapi. |

---

## 3. Alur Pemrosesan Batch (Multi-File Queue)

Aplikasi mendukung pengunggahan banyak berkas secara serentak di halaman utama maupun di dalam masing-masing modul:

1. **Seleksi File**: Pengguna memilih banyak file atau melakukan drag-and-drop batch ke zona unggah.
2. **Normalisasi Antrean**: `main.js` membaca seluruh `FileList` dan memasukkannya ke dalam state antrean dokumen.
3. **Penyaluran ke Modul**:
   - Untuk alat agregator (**Merge**, **From Image**): Seluruh file digabung langsung ke dalam satu daftar urutan kerja.
   - Untuk alat per-dokumen (**Compress**, **Watermark**, **OCR**, **Page Numbers**, **Extract Text**): Dokumen diproses satu per satu secara berurutan dengan indikator kemajuan (progress bar), kemudian disajikan untuk diunduh individual atau sekaligus.

---

## 4. Build Pipeline & Distribusi

Pipeline build dikelola oleh skrip ES Module:

- **`build.mjs`**:
  - Mengompilasi kode sumber JavaScript dan CSS menggunakan `esbuild` (`target: es2022`, `format: iife`, `minify: true`).
  - Mengemas worker eksternal (`pdfjs-dist/build/pdf.worker.mjs` dan `tesseract.js`) beserta file WASM ke dalam bundel JavaScript inline.
  - Memasukkan font open-source (`Fraunces`, `Atkinson Hyperlegible`, `Dancing Script`, `Caveat`) via Data URL Base64 sehingga bebas dependensi eksternal / CDN.
  - Menghasilkan file tunggal siap pakai `dist/index.html` dan `dist/PDF Toolkit.html`.
- **`release.mjs`**:
  - Menjalankan pengujian dan kompilasi build final.
  - Mengambil tangkapan layar otomatis untuk dokumentasi dan materi promosi.
  - Mengompresi seluruh bundel distribusi menjadi berkas ZIP rilis.

---

## 5. Pengujian & Perintah Pengembangan

### Kebutuhan Lingkungan
- Node.js versi 18 atau lebih tinggi
- NPM

### Perintah Penting

```bash
# Pasang dependensi
npm install

# Kompilasi bundel aplikasi ke folder dist/
node build.mjs

# Mode pengamatan (watch mode) untuk pengembangan aktif
node build.mjs --watch

# Menjalankan pengujian E2E (Playwright)
node tests/e2e.mjs

# Membangun paket rilis lengkap
node release.mjs
```
