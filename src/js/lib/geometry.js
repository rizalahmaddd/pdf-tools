// Maps "visual" coordinates (points, origin at the top-left of the page as a reader sees it)
// to PDF user space, taking the page's /Rotate and crop box into account.
export function visualFrame(page) {
  const r = ((page.getRotation().angle % 360) + 360) % 360;
  const { x: x0, y: y0, width: w, height: h } = page.getCropBox();
  const sideways = r === 90 || r === 270;
  return {
    width: sideways ? h : w,
    height: sideways ? w : h,
    rotate: r,
    toPdf(vx, vy) {
      if (r === 90) return { x: x0 + vy, y: y0 + vx };
      if (r === 180) return { x: x0 + w - vx, y: y0 + vy };
      if (r === 270) return { x: x0 + w - vy, y: y0 + h - vx };
      return { x: x0 + vx, y: y0 + h - vy };
    },
  };
}

// Anchor for drawing a box of size (bw, bh) centred on visual point (cx, cy), rotated by `angle` degrees.
export function centredAnchor(frame, cx, cy, bw, bh, angle) {
  const c = frame.toPdf(cx, cy);
  const total = ((angle + frame.rotate) * Math.PI) / 180;
  return {
    x: c.x - (bw / 2) * Math.cos(total) + (bh / 2) * Math.sin(total),
    y: c.y - (bw / 2) * Math.sin(total) - (bh / 2) * Math.cos(total),
    rotate: angle + frame.rotate,
  };
}

export function parsePageSelection(text, max) {
  const s = (text || '').trim();
  if (!s) return new Set(Array.from({ length: max }, (_, i) => i));
  const set = new Set();
  for (const part of s.split(/[,;]+/)) {
    const m = part.trim().match(/^(\d+)?\s*-\s*(\d+)?$/);
    if (m) {
      const a = m[1] ? +m[1] : 1, b = m[2] ? +m[2] : max;
      for (let i = Math.max(1, a); i <= Math.min(max, b); i++) set.add(i - 1);
    } else if (/^\d+$/.test(part.trim())) {
      const n = +part.trim();
      if (n >= 1 && n <= max) set.add(n - 1);
    } else if (part.trim()) {
      throw new RangeError(part.trim());
    }
  }
  return set;
}
