// Share cards: when a scribe's link is posted on X, Telegram or Discord, the preview shows its seal (or
// picture), name, birth number, rank and brain. /s/<address> is the page crawlers read (its tags point
// at /card/<address>.png); people who open it are sent on to the scribe's page.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { sigilMarkup } from '../../lib/src/sigil.ts';
import { modelName } from '../../lib/src/hybrid.ts';
import type { Indexer, ScribeView } from './indexer.ts';

const FONTS = ['Fraunces-SemiBold.ttf', 'Inter-Regular.ttf', 'Inter-SemiBold.ttf'].map((f) => join(import.meta.dirname, '..', 'fonts', f));
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

export function brainText(s: ScribeView): string {
  if (s.brain?.kind === 'bound') return `Thinks with ${modelName(s.brain.model)}`;
  if (s.model) return `${s.model.name ?? 'Its own model'} · brain fully on Solana`;
  return 'Inscribed on Solana';
}

// Wraps text to lines of at most `width` characters (the fonts are close enough to fixed for this).
function wrap(text: string, width: number, max: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if ((line + ' ' + word).trim().length > width && line) { lines.push(line); line = word; } else line = (line + ' ' + word).trim();
    if (lines.length === max) break;
  }
  if (lines.length < max && line) lines.push(line);
  if (lines.length === max && lines.join(' ').length < text.length) lines[max - 1] = lines[max - 1].replace(/\s*\S*$/, '') + '…';
  return lines;
}

// The scribe's own picture as a data URL, if it has one the renderer can draw (PNG or JPEG).
function picture(indexer: Indexer, s: ScribeView): string | null {
  const f = s.files.find((x) => x.role === 'picture');
  if (!f || s.status.state !== 'complete') return null;
  const path = indexer.filePath(f.sha256);
  if (!existsSync(path)) return null;
  const b = readFileSync(path);
  const type = b[0] === 0x89 && b[1] === 0x50 ? 'image/png' : b[0] === 0xff && b[1] === 0xd8 ? 'image/jpeg' : null;
  return type ? `data:${type};base64,${b.toString('base64')}` : null;
}

export function cardSvg(indexer: Indexer, s: ScribeView, total: number): string {
  const name = s.name ?? 'A scribe';
  const pic = picture(indexer, s);
  const art = pic
    ? `<image href="${pic}" x="80" y="80" width="470" height="470" preserveAspectRatio="xMidYMid slice"/>`
    : `<g transform="translate(80 80) scale(2.35)">${sigilMarkup(s.address, name.slice(0, 1).toUpperCase())}</g>`;
  const chips = [s.rarity ? `Rank ${s.rarity.rank} of ${total}` : null, s.verified ? 'Verified' : null, s.autograph ? 'Autograph' : null].filter(Boolean) as string[];
  let x = 610;
  const chipMarkup = chips.map((c) => {
    const w = c.length * 12.5 + 36;
    const out = `<rect x="${x}" y="456" width="${w}" height="44" rx="22" fill="#0f3129"/><text x="${x + w / 2}" y="485" text-anchor="middle" font-family="Inter" font-weight="600" font-size="21" fill="#34e3b4">${esc(c)}</text>`;
    x += w + 12;
    return out;
  }).join('');
  const purpose = wrap(s.purpose ?? '', 40, 3).map((l, i) => `<text x="610" y="${292 + i * 38}" font-family="Inter" font-size="28" fill="#b4bfbb">${esc(l)}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#06080a"/>
  <clipPath id="art"><rect x="80" y="80" width="470" height="470" rx="28"/></clipPath>
  <g clip-path="url(#art)">${art}</g>
  <rect x="80" y="80" width="470" height="470" rx="28" fill="none" stroke="#1f2c28" stroke-width="2"/>
  <text x="610" y="140" font-family="Inter" font-weight="600" font-size="22" letter-spacing="3" fill="#34e3b4">SCRIBE #${s.birthNumber + 1}</text>
  <text x="610" y="225" font-family="Fraunces" font-weight="600" font-size="${name.length > 14 ? 60 : 76}" fill="#f2efe8">${esc(name)}</text>
  ${purpose}
  <text x="610" y="428" font-family="Inter" font-weight="600" font-size="24" fill="#f2efe8">${esc(brainText(s))}</text>
  ${chipMarkup}
  <circle cx="1068" cy="560" r="14" fill="#34e3b4"/>
  <text x="1090" y="568" font-family="Fraunces" font-weight="600" font-size="24" fill="#f2efe8">Scribes</text>
  <text x="610" y="568" font-family="Inter" font-size="20" fill="#7f8c88">Inscribed on Solana · talk to it in your browser</text>
</svg>`;
}

const cache = new Map<string, Buffer>(); // by address and everything the card shows

export function cardPng(indexer: Indexer, s: ScribeView, total: number): Buffer {
  const key = JSON.stringify([s.address, s.name, s.purpose, s.rarity?.rank, total, s.verified, s.autograph, s.status.state, s.brain]);
  let png = cache.get(key);
  if (!png) {
    png = new Resvg(cardSvg(indexer, s, total), { font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: 'Inter' } }).render().asPng();
    if (cache.size > 500) cache.clear();
    cache.set(key, png);
  }
  return png;
}

// The page crawlers read for a scribe link; people are sent on to the scribe's page.
export function sharePage(s: ScribeView, base: string): string {
  const title = `${s.name ?? 'A scribe'} · Scribe #${s.birthNumber + 1}`;
  const description = [s.purpose, brainText(s)].filter(Boolean).join(' — ');
  const page = `${base}/#/scribe/${s.address}`;
  const image = `${base}/card/${s.address}.png`;
  return `<!doctype html><html><head><meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Scribes">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(`${base}/s/${s.address}`)}">
<meta property="og:image" content="${esc(image)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}"><meta name="twitter:image" content="${esc(image)}">
<meta http-equiv="refresh" content="0; url=${esc(page)}">
</head><body><a href="${esc(page)}">Open ${esc(s.name ?? 'this scribe')}</a><script>location.replace(${JSON.stringify(page)})</script></body></html>`;
}

