// The hero's screen: a scribe being inscribed one bit at a time. An empty block waits; the keyboard
// types each bit of a byte on its 1 or 0 key and the bit appears; when all eight are in, the block's
// rules draw in to seal it and a link joins it to the chain. The chain slides left as it grows. Blocks
// use the frame's own lines and the border's 0s and 1s, on the computer's 3px dot grid.

type Opts = {
  ox: number; oy: number;                 // where the canvas sits on the computer's dot grid
  onKey?: (one: boolean) => void;         // a bit was typed
  colors?: [string, string]; ink?: string;
};
type Block = { gx: number; bits: boolean[]; shown: number; seal: number; link: number; c: string };

const P = 3, CW = 15, CH = 15, GAP = 4;

export function startChain(canvas: HTMLCanvasElement, opts: Opts): () => void {
  const o = { colors: ['#0047ff', '#e5141a'] as [string, string], ink: '#1a1410', ...opts };
  const ctx = canvas.getContext('2d')!;
  let W = 0, H = 0, blocks: Block[] = [], shift = 0, shiftTo = 0, n = 0, alive = true, raf = 0;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const size = () => {
    const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    W = r.width; H = r.height; canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  const dot = (gx: number, gy: number, c: string) => {
    ctx.fillStyle = c; ctx.beginPath(); ctx.arc(gx * P + P / 2 - o.ox, gy * P + P / 2 - o.oy, .9, 0, Math.PI * 2); ctx.fill();
  };
  // a 0 or 1 as the border draws it
  const bit = (one: boolean, cx: number, cy: number) => {
    ctx.strokeStyle = o.ink; ctx.lineWidth = 1.4; ctx.lineCap = 'square'; ctx.beginPath();
    if (one) { ctx.moveTo(cx - 1.4, cy - 2.1); ctx.lineTo(cx, cy - 3); ctx.lineTo(cx, cy + 3); }
    else ctx.ellipse(cx, cy, 1.8, 3, 0, 0, Math.PI * 2);
    ctx.stroke();
  };

  const newBlock = () => {
    const byte = Math.floor(Math.random() * 256);
    const gx = blocks.length ? blocks[blocks.length - 1].gx + CW + GAP : Math.round((W / P - CW) / 2);
    blocks.push({ gx, bits: Array.from({ length: 8 }, (_, k) => ((byte >> (7 - k)) & 1) === 1), shown: 0, seal: 0, link: 0, c: o.colors[n++ % 2] });
    const want = Math.round(W * .6 / P) - CW;
    if (gx - shiftTo > want) shiftTo = gx - want;
    blocks = blocks.filter((b) => b.gx - shiftTo > -(CW + GAP) * 2);
  };

  const drawBlock = (b: Block, gx: number, gy: number) => {
    const x0 = gx * P - o.ox, y0 = gy * P - o.oy, w = CW * P, h = CH * P, cx = x0 + w / 2, cy = y0 + h / 2;
    if (b.seal < 1) for (let i = 0; i < CW; i++) for (let j = 0; j < CH; j++) if (i === 0 || j === 0 || i === CW - 1 || j === CH - 1) dot(gx + i, gy + j, b.c);
    if (b.seal > 0) {
      // the frame's 3px rule, a 3px gap and a 1px rule, drawn in around the block
      ctx.save(); ctx.strokeStyle = b.c; ctx.setLineDash([2 * (w + h) * b.seal, 4 * (w + h)]);
      ctx.lineWidth = 3; ctx.strokeRect(x0 + 1.5, y0 + 1.5, w - 3, h - 3);
      ctx.lineWidth = 1; ctx.strokeRect(x0 + 6.5, y0 + 6.5, w - 13, h - 13);
      ctx.restore();
    }
    for (let k = 0; k < b.shown; k++) bit(b.bits[k], cx - 12 + (k % 4) * 8, cy + (k < 4 ? -5 : 5));
  };

  const drawLink = (gxFrom: number, gxTo: number, gy: number, c: string, k: number) => {
    const x0 = gxFrom * P - o.ox, x1 = gxTo * P - o.ox, y = gy * P + P / 2 - o.oy, m = (x0 + x1) / 2;
    ctx.save(); ctx.globalAlpha = k; ctx.strokeStyle = c;
    ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(m - 4, y); ctx.moveTo(m + 4, y); ctx.lineTo(x1, y); ctx.stroke();
    ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(m, y, 4, 3, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  };

  const draw = () => {
    shift += (shiftTo - shift) * .08;
    const sh = Math.round(shift), gy = Math.round((Math.floor(H / P) - CH) / 2);
    ctx.clearRect(0, 0, W, H);
    blocks.forEach((b, i) => {
      if (i > 0 && b.seal >= 1) drawLink(blocks[i - 1].gx - sh + CW, b.gx - sh, gy + Math.floor(CH / 2), b.c, Math.min(1, b.link));
      drawBlock(b, b.gx - sh, gy);
    });
    if (alive) raf = requestAnimationFrame(draw);
  };

  const wait = (ms: number) => new Promise<void>((r) => { const t = setTimeout(() => { timers.delete(t); r(); }, ms); timers.add(t); });
  const tween = (ms: number, f: (k: number) => void) => new Promise<void>((res) => {
    const t0 = performance.now();
    const step = (t: number) => { if (!alive) return; const k = Math.min(1, (t - t0) / ms); f(k); if (k < 1) requestAnimationFrame(step); else res(); };
    requestAnimationFrame(step);
  });

  const run = async () => {
    while (alive) {
      newBlock(); const b = blocks[blocks.length - 1];
      await wait(500);
      for (let k = 0; k < 8 && alive; k++) { b.shown = k + 1; o.onKey?.(b.bits[k]); await wait(300); }
      await tween(450, (k) => { b.seal = k; });
      await tween(300, (k) => { b.link = k; });
      await wait(1100);
    }
  };

  // measured again whenever the screen changes size (the computer drawing can load after this starts)
  size();
  const seen = new ResizeObserver(size);
  seen.observe(canvas);
  raf = requestAnimationFrame(draw);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    // a still, sealed chain of three
    for (let i = 0; i < 3; i++) { newBlock(); Object.assign(blocks[blocks.length - 1], { shown: 8, seal: 1, link: 1 }); }
    shift = shiftTo;
  } else run();

  return () => { alive = false; cancelAnimationFrame(raf); timers.forEach(clearTimeout); seen.disconnect(); };
}
