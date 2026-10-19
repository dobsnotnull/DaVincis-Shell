'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { splitArgs, expandTemplate, parseInput } = require('../src/util');
const { buildArgs } = require('../src/agents/cli');

test('parseInput tells prompts, commands and shell lines apart', () => {
  assert.deepStrictEqual(parseInput('   '), { kind: 'empty' });
  assert.deepStrictEqual(parseInput('!git status'), { kind: 'shell', rest: 'git status' });
  assert.deepStrictEqual(parseInput('/agent codex'), { kind: 'command', name: 'agent', rest: 'codex' });
  assert.deepStrictEqual(parseInput('/HELP'), { kind: 'command', name: 'help', rest: '' });
  assert.deepStrictEqual(parseInput('clean up my desktop'), { kind: 'prompt', rest: 'clean up my desktop' });
  assert.deepStrictEqual(parseInput('@Codex write a fizzbuzz'), { kind: 'mention', name: 'codex', rest: 'write a fizzbuzz' });
  assert.deepStrictEqual(parseInput('@codex'), { kind: 'prompt', rest: '@codex' });
});

test('splitArgs honours quotes', () => {
  assert.deepStrictEqual(splitArgs('llama ollama run "llama 3"'), ['llama', 'ollama', 'run', 'llama 3']);
  assert.deepStrictEqual(splitArgs("a '' b"), ['a', '', 'b']);
});

test('expandTemplate fills placeholders and fallbacks', () => {
  assert.strictEqual(expandTemplate('last {args|7} days', { args: '' }), 'last 7 days');
  assert.strictEqual(expandTemplate('last {args|7} days', { args: '30' }), 'last 30 days');
  assert.strictEqual(expandTemplate('keep {unknown}', {}), 'keep {unknown}');
});

test('buildArgs expands {mode} and {prompt}', () => {
  assert.deepStrictEqual(buildArgs(['exec', '{mode}', '-'], ['--full-auto'], 'hi'), {
    args: ['exec', '--full-auto', '-'],
    promptInArgs: false,
  });
  assert.deepStrictEqual(buildArgs(['run', '{prompt}'], [], 'hi'), { args: ['run', 'hi'], promptInArgs: true });
});
