import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculate, enabledTools } from '../src/tools.ts';

test('the calculator does arithmetic and nothing else', () => {
  assert.equal(calculate('2 + 3 * 4'), 14);
  assert.equal(calculate('(2 + 3) * 4'), 20);
  assert.equal(calculate('2 ^ 3 ^ 2'), 512);
  assert.equal(calculate('-1.5 * 4'), -6);
  assert.equal(calculate('10 / 4'), 2.5);
  for (const bad of ['alert(1)', '2 + ', '(1 + 2', 'process.exit()', '1e9', '2 ** 3']) assert.throws(() => calculate(bad), Error, bad);
});

test('declared tools map to the official set; anything else stays declared only', () => {
  assert.deepEqual(enabledTools(['Calculator', 'web search', 'wallet', 'teleport']), ['calculator', 'read_wallet', 'web_search']);
  assert.deepEqual(enabledTools(['propose_transfer']), ['propose_transfer']);
  assert.deepEqual(enabledTools(undefined), []);
});
