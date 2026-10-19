'use strict';

const test = require('node:test');
const assert = require('node:assert');
const t = require('../src/terminal');

const font = { face: 'JetBrains Mono', postscript: 'JetBrainsMono-Regular' };

test('every terminal profile gets the scheme, the small font and the see-through background', () => {
  const wt = t.windowsTerminalFragment(font).profiles[0];
  assert.strictEqual(wt.font.size, 6);
  assert.strictEqual(wt.opacity, 60);

  const iterm = t.itermProfile(font).Profiles[0];
  assert.strictEqual(iterm['Normal Font'], 'JetBrainsMono-Regular 6');
  assert.ok(Math.abs(iterm.Transparency - 0.4) < 1e-9);
  assert.ok(iterm['Ansi 15 Color']);

  const kitty = t.kittyConf(font);
  assert.match(kitty, /^background_opacity 0\.6$/m);
  assert.match(kitty, /^color15 #FFF8EB$/m);

  const alacritty = t.alacrittyToml(font);
  assert.match(alacritty, /^opacity = 0\.6$/m);
  assert.match(alacritty, /^magenta = "#C38FBF"$/m);

  const konsole = t.konsoleFiles(font);
  assert.match(konsole.scheme, /^Opacity=0\.6$/m);
  assert.match(konsole.scheme, /^\[Color7Intense\]$/m);
  assert.match(konsole.profile, /^Font=JetBrains Mono,6,/m);

  const gnome = t.gnomeKeyfile(font);
  assert.match(gnome, /^background-transparency-percent=40$/m);
  assert.strictEqual((gnome.match(/^palette=\[(.*)\]$/m)[1].match(/#/g) || []).length, 16);
});
