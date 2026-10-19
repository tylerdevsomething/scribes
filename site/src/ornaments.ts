// The frame's dot ornaments, drawn live. There is one generated version per view of the explore page
// (ornaments.json); as the views scroll, the dots dissolve from one version into the next, each dot
// switching at its own point, so the ornaments look as if they are being recomputed.
import data from './ornaments.json' with { type: 'json' };

type Dot = [number, number, number];
const V: { corner: Dot[][]; crest: Dot[][] } = data as never;
const P = 3, R = .9, CREST_W = 297;

// a steady random number per dot, so a dot always switches at the same point of the scroll
const hash = (a: number, b: number, c: number) => {
  let h = (a * 73856093) ^ (b * 19349663) ^ (c * 83492791);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995); return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
};

export function drawOrnaments(canvas: HTMLCanvasElement, at: number) {
  const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(r.width * dpr) || canvas.height !== Math.round(r.height * dpr)) {
    canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, r.width, r.height);
  const css = getComputedStyle(document.documentElement);
  const col = [css.getPropertyValue('--purple').trim(), css.getPropertyValue('--green').trim()];
  const n = V.corner.length, a = ((Math.floor(at) % n) + n) % n, b = (a + 1) % n, f = at - Math.floor(at);
  const W = r.width, H = r.height;
  const dot = (x: number, y: number, c: number) => { ctx.fillStyle = col[c]; ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill(); };
  // every dot of the outgoing version stays until the scroll passes its point; the incoming one's appear
  const each = (cb: (d: Dot) => void) => {
    for (const d of V.corner[a]) if (hash(d[0], d[1], a) >= f) cb(d);
    for (const d of V.corner[b]) if (hash(d[0], d[1], b) < f) cb(d);
  };
  const eachCrest = (cb: (d: Dot) => void) => {
    for (const d of V.crest[a]) if (hash(d[0], d[1], a + 50) >= f) cb(d);
    for (const d of V.crest[b]) if (hash(d[0], d[1], b + 50) < f) cb(d);
  };
  each(([gx, gy, c]) => {
    const x = gx * P + P / 2, y = gy * P + P / 2;
    dot(9 + x, 9 + y, c); dot(W - 9 - x, 9 + y, c); dot(9 + x, H - 9 - y, c); dot(W - 9 - x, H - 9 - y, c);
  });
  const left = W / 2 - CREST_W / 2;
  eachCrest(([gx, gy, c]) => {
    const x = gx * P + P / 2, y = gy * P + P / 2;
    dot(left + x, 12 + y, c); dot(left + x, H - 12 - y, c);
  });
}
