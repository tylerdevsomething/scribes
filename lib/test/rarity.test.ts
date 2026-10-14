import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankAll, traits, type ScribeFacts } from '../src/rarity.ts';

const base = (i: number, over: Partial<ScribeFacts> = {}): ScribeFacts => ({
  address: `s${i}`, birthNumber: i, autograph: false, verified: false, brain: 'inscribed', model: 'aa',
  weightBytes: 92_000_000, personalityWords: 40, tools: 0, memory: 0, ...over,
});

test('free-form values land in buckets, so exact numbers are not "1 of 1"', () => {
  assert.equal(traits(base(0, { personalityWords: 1840 })).Personality, '500–2,000 words');
  assert.equal(traits(base(0, { personalityWords: 1841 })).Personality, '500–2,000 words');
  assert.equal(traits(base(0, { weightBytes: 480_000_000 })).Weight, '150–500 MB');
  assert.equal(traits(base(0, { brain: 'bound', weightBytes: null })).Weight, 'n/a (bound)');
  assert.equal(traits(base(0, { tools: 4 })).Tools, '3–5 tools');
  assert.equal(traits(base(0, { memory: 12 })).Memory, '11–50 entries');
});

test('birth buckets are 1-based', () => {
  assert.equal(traits(base(0)).Birth, 'Genesis #1–100');
  assert.equal(traits(base(99)).Birth, 'Genesis #1–100');
  assert.equal(traits(base(100)).Birth, '#101–1,000');
});

test('shares and ranks: what cannot be manufactured counts most', () => {
  const all = Array.from({ length: 200 }, (_, i) => base(i));
  all[150] = base(150, { verified: true });
  all[160] = base(160, { personalityWords: 3000 }); // a rare but self-chosen value
  const r = rankAll(all);
  assert.equal(r.get('s150')!.shares.Verified, 1 / 200);
  // Same rarity of value, but Verified weighs double, so it ranks above the self-chosen one.
  assert.ok(r.get('s150')!.rank < r.get('s160')!.rank);
  // Genesis scribes (first 100) share a rarer birth bucket than later ones... here half are genesis.
  assert.equal(r.get('s0')!.shares.Birth, 0.5);
  // Ranks are 1..n with no gaps.
  const ranks = [...r.values()].map((x) => x.rank).sort((a, b) => a - b);
  assert.deepEqual(ranks, Array.from({ length: 200 }, (_, i) => i + 1));
});

test('ties go to the earlier birth', () => {
  const r = rankAll([base(5), base(3)]);
  assert.equal(r.get('s3')!.rank, 1);
});
