'use strict';

const env = process.env;
const useColor = env.FORCE_COLOR ? env.FORCE_COLOR !== '0' : process.stdout.isTTY && !env.NO_COLOR;
const truecolor =
  /truecolor|24bit/i.test(env.COLORTERM || '') || Boolean(env.WT_SESSION) || env.TERM_PROGRAM === 'vscode';

const wrap = (open, close) => (s) => (useColor ? `\x1b[${open}m${s}\x1b[${close}m` : String(s));

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function fgCode([r, g, b]) {
  if (truecolor) return `38;2;${r};${g};${b}`;
  const q = (v) => Math.round((v / 255) * 5);
  return `38;5;${16 + 36 * q(r) + 6 * q(g) + q(b)}`;
}

function mix(a, b, t) {
  return a.map((v, i) => Math.round(v + (b[i] - v) * t));
}

// Colour a string with a hex colour (24-bit where the terminal supports it).
const hex = (color) => (s) => (useColor ? `\x1b[${fgCode(hexToRgb(color))}m${s}\x1b[39m` : String(s));

function gradient(text, from, to) {
  if (!useColor) return text;
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  const chars = [...text];
  return (
    chars.map((ch, i) => `\x1b[${fgCode(mix(a, b, chars.length > 1 ? i / (chars.length - 1) : 0))}m${ch}`).join('') +
    '\x1b[39m'
  );
}

const PALETTE = {
  gold: '#D4A84B',
  clay: '#D97757',
  parchment: '#EDE3D1',
  ink: '#8A8378',
};

const AGENT_COLORS = { claude: PALETTE.clay, codex: '#10A37F', gemini: '#4796E3' };
const agentColor = (name) => AGENT_COLORS[name] || PALETTE.gold;

const c = {
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  italic: wrap(3, 23),
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  blue: wrap(34, 39),
  magenta: wrap(35, 39),
  cyan: wrap(36, 39),
  gray: wrap(90, 39),
  gold: hex(PALETTE.gold),
  clay: hex(PALETTE.clay),
  hex,
};

const stripAnsi = (s) => String(s).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
const visibleWidth = (s) => [...stripAnsi(s)].length;
const padVisible = (s, width) => s + ' '.repeat(Math.max(0, width - visibleWidth(s)));

// Just enough markdown to make agent replies readable in a terminal.
function renderMarkdown(text) {
  let inFence = false;
  return text
    .split(/\r?\n/)
    .map((line) => {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        return c.gray(line);
      }
      if (inFence) return c.cyan(line);
      const heading = line.match(/^#{1,6}\s+(.*)$/);
      if (heading) return c.bold(c.gold(heading[1]));
      return line
        .replace(/^(\s*)[-*]\s+/, '$1• ')
        .replace(/\*\*([^*]+)\*\*/g, (_, s) => c.bold(s))
        .replace(/`([^`]+)`/g, (_, s) => c.cyan(s));
    })
    .join('\n');
}

// The little Claude creature: a body and two leg frames, so it can walk.
const CREATURE = ['▐▛█▜▌', ' ▘ ▘ ', ' ▝ ▝ '];
const TRACK = 12; // columns the banner creature wanders across

// Two rows of creature at column `x` of the track, legs on frame `step`.
function creatureRows(x, step, color) {
  const pad = (s) => ' '.repeat(x) + hex(color)(s) + ' '.repeat(TRACK - x - s.length);
  return [pad(CREATURE[0]), pad(CREATURE[1 + (step % 2)])];
}

// Wandering back and forth: position and leg frame for a given tick.
function wander(tick, width = TRACK - CREATURE[0].length) {
  const span = width * 2;
  const p = tick % span;
  return { x: p <= width ? p : span - p, step: tick };
}

function banner(version, { agent, mode, cwd, linked }, tick = 0) {
  const { x, step } = wander(tick);
  const art = [' '.repeat(TRACK), ...creatureRows(x, step, agentColor(agent))];
  const maxInfo = 44;
  const where = cwd.length > maxInfo ? '…' + cwd.slice(-(maxInfo - 1)) : cwd;
  const text = [
    `${c.bold(gradient("DaVinci's Shell", PALETTE.gold, PALETTE.clay))}  ${c.gray('v' + version)}`,
    c.italic(c.gray('type what you want — your agents do it')),
    `${hex(agentColor(agent))(agent)}${c.gray(' · ' + mode + ' · ' + where)}`,
  ];
  const rows = art.map((a, i) => `  ${a}  ${text[i]}`);
  const width = Math.max(...rows.map(visibleWidth)) + 3;
  const edge = (s) => hex(PALETTE.gold)(s);
  const line = (s) => edge('│') + padVisible(s, width) + edge('│');
  const out = [
    '',
    edge('╭' + '─'.repeat(width) + '╮'),
    ...rows.map(line),
    edge('╰' + '─'.repeat(width) + '╯'),
  ];
  if (linked.length > 1) {
    out.push(`  ${c.gray('agents')} ${linked.map((n) => hex(agentColor(n))(n)).join(c.gray(' · '))}`);
  }
  return out.join('\n');
}

// Things the agent is "doing" while it thinks. A few are borrowed from Claude,
// the rest from Leonardo's notebooks.
const VERBS = [
  'Ruminating', 'Salivating', 'Pondering', 'Cogitating', 'Percolating', 'Noodling', 'Marinating',
  'Simmering', 'Conjuring', 'Brewing', 'Mulling', 'Musing', 'Scheming', 'Tinkering', 'Divining',
  'Contemplating', 'Ideating', 'Synthesizing', 'Philosophizing', 'Daydreaming', 'Vibing',
  'Sketching', 'Mixing pigments', 'Studying anatomy', 'Mirror-writing', 'Sfumato-ing',
  'Designing flying machines', 'Perfecting the smile', 'Measuring the Vitruvian man',
  'Inventing', 'Sculpting', 'Painting', 'Engineering',
];
const GLYPHS = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢'];
const FRAME_MS = 80;
const VERB_FRAMES = 40;

function shimmer(text, frame, base) {
  if (!useColor) return text;
  const chars = [...text];
  const baseRgb = hexToRgb(base);
  const pos = (frame % (chars.length + 12)) - 6;
  return (
    chars
      .map((ch, i) => {
        const d = Math.abs(i - pos);
        const t = d > 3 ? 0 : 0.65 * (1 - d / 4);
        return `\x1b[${fgCode(mix(baseRgb, [255, 248, 235], t))}m${ch}`;
      })
      .join('') + '\x1b[39m'
  );
}

class Spinner {
  constructor(stream = process.stdout) {
    this.stream = stream;
    this.timer = null;
  }

  get active() {
    return this.timer !== null;
  }

  start(color = PALETTE.clay, started = Date.now()) {
    if (!this.stream.isTTY || this.timer) return;
    this.color = color;
    this.started = started;
    this.frame = 0;
    this.verb = this._pick();
    this.stream.write('\x1b[?25l');
    this.timer = setInterval(() => this._render(), FRAME_MS);
    this._render();
  }

  _pick() {
    let v;
    do v = VERBS[Math.floor(Math.random() * VERBS.length)];
    while (v === this.verb);
    return v;
  }

  line() {
    if (this.frame > 0 && this.frame % VERB_FRAMES === 0) this.verb = this._pick();
    const glyph = GLYPHS[Math.floor(this.frame / 2) % GLYPHS.length];
    const { x } = wander(Math.floor(this.frame / 3), 6);
    const walker = ' '.repeat(x) + hex(this.color)(CREATURE[0]) + ' '.repeat(6 - x);
    const secs = Math.floor((Date.now() - this.started) / 1000);
    return ` ${walker} ${hex(this.color)(glyph)} ${shimmer(this.verb + '…', this.frame, this.color)} ${c.gray(`(${secs}s · ctrl+c to stop)`)}`;
  }

  _render() {
    this.stream.write('\r\x1b[2K' + this.line());
    this.frame++;
  }

  // Wipe the spinner line so other output can be printed; it redraws on the next tick.
  clear() {
    if (this.timer) this.stream.write('\r\x1b[2K');
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    this.stream.write('\r\x1b[2K\x1b[?25h');
  }
}

module.exports = { c, hex, gradient, renderMarkdown, banner, agentColor, Spinner, CREATURE, VERBS, PALETTE, stripAnsi, visibleWidth };
