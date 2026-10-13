import merge from './merge.js';
import split from './split.js';
import organize from './organize.js';
import sign from './sign.js';
import fill from './fill.js';
import redact from './redact.js';
import compress from './compress.js';
import toImage from './to-image.js';
import fromImage from './from-image.js';
import ocr from './ocr.js';
import extractText from './extract-text.js';
import watermark from './watermark.js';
import numbers from './page-numbers.js';

export const groups = ['arrange', 'sign', 'convert', 'mark'];
export const tools = [merge, split, organize, sign, fill, redact, compress, toImage, fromImage, ocr, extractText, watermark, numbers];
