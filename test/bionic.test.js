'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { score } = require('../src/bionic');

const full = { mode: 'normal', linked: true, git: true, gh: true, ghLoggedIn: true, mcp: ['x'], skills: 1, plugins: 0 };

test('a fully set up Claude agent is 100% bionic', () => {
  assert.strictEqual(score('claude', {}, full).percent, 100);
});

test('safe mode and missing tools lower the score', () => {
  const { percent } = score('claude', {}, { ...full, mode: 'safe', gh: false, ghLoggedIn: false });
  assert.ok(percent < 100 && percent > 50);
});

test('plain CLI agents get partial credit for modes and memory', () => {
  const cfg = { args: ['{mode}'], modes: { safe: [], normal: ['-a'] } };
  const { checks, percent } = score('cli', cfg, full);
  assert.strictEqual(checks.find((c) => c.label.includes('modes')).got, 2 / 3);
  assert.strictEqual(checks.find((c) => c.label.includes('memory')).got, 0.5);
  assert.ok(percent < 50);
});
