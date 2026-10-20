// Fails if any file in the repo uses a banned name (words from an earlier, unrelated project).
// The words are stored encoded so this file does not trip its own check.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const BANNED = ['c2VxdWVudHM=', 'cHJvb2Y=', 'c3RyaWtl', 'ZW52ZWxvcGU=', 'dmF1bHQ=', 'bWVsdA==', 'ZGVzaw==', 'b3JpZ2lu', 'Y3VydmU=']
  .map((b) => Buffer.from(b, 'base64').toString('utf8'));

// Platform identifiers we cannot rename (third-party APIs). Keep this list short.
const ALLOWED = [
  'isOnCurve', 'getVaultPda', 'vaultTransactionCreate', 'vaultIndex', 'location.origin', 'remote add origin', 'push -u origin',
  'Cross-Origin-Opener-Policy', 'Cross-Origin-Embedder-Policy', 'cross-origin-resource-policy', 'crossOriginIsolated', 'same-origin', 'access-control-allow-origin', 'crossorigin',
  'quadraticCurveTo', 'transform-origin', // canvas and CSS
];

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
  .split('\n').filter(Boolean).filter((f) => f !== 'package-lock.json' && f !== 'Cargo.lock'); // lockfiles: third-party package names

let hits = 0;
for (const f of files) {
  for (const word of BANNED) {
    if (f.toLowerCase().includes(word)) { console.log(`${f}: file name contains a banned word`); hits++; }
  }
  let text: string;
  try { text = readFileSync(f, 'utf8'); } catch { continue; }
  text.split('\n').forEach((line, i) => {
    let l = line;
    for (const a of ALLOWED) l = l.split(a).join('');
    const low = l.toLowerCase();
    for (const word of BANNED) {
      if (low.includes(word)) { console.log(`${f}:${i + 1}: ${line.trim().slice(0, 120)}`); hits++; }
    }
  });
}
if (hits) { console.log(`\n${hits} banned name(s) found`); process.exit(1); }
console.log(`names check: ${files.length} files clean`);
