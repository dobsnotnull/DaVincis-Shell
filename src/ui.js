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

// Hyperspace for the top of the start-up screen: stars streak out from the centre.
const WARP_ROWS = 6;
const WARP_SHADES = 10;

class Hyperspace {
  constructor(width, rows = WARP_ROWS, color = '#A3C0DE') {
    this.w = width;
    this.h = rows;
    this.cx = (width - 1) / 2;
    this.cy = (rows - 1) / 2;
    const base = hexToRgb(color);
    const dark = [26, 23, 20]; // the DaVinci terminal background
    this.head = `\x1b[${fgCode(mix(base, [255, 255, 255], 0.8))}m`;
    this.shades = Array.from({ length: WARP_SHADES }, (_, i) => `\x1b[${fgCode(mix(dark, base, (i + 1) / WARP_SHADES))}m`);
    this.ch = Array(width * rows).fill(' ');
    this.lum = new Float32Array(width * rows);
    this.stars = Array.from({ length: Math.max(12, Math.round((width * rows) / 14)) }, () => this._star(true));
    for (let i = 0; i < 30; i++) this.step(); // start mid-jump, not on an empty sky
  }

  // d runs from the centre (0) to the edge (1); stars speed up as they fly out.
  _star(anywhere) {
    return { a: Math.random() * Math.PI * 2, d: anywhere ? Math.random() : 0.02 + Math.random() * 0.18, v: 0.008 + Math.random() * 0.02 };
  }

  _pos({ a, d }) {
    return [this.cx + Math.cos(a) * d * (this.cx + 1), this.cy + Math.sin(a) * d * (this.cy + 1)];
  }

  // A line character that follows the streak (cells are about twice as tall as wide).
  _streak(dx, dy) {
    if (Math.hypot(dx, dy * 2) < 1) return '·';
    const deg = Math.abs((Math.atan2(dy * 2, dx) * 180) / Math.PI);
    if (deg < 25 || deg > 155) return '─';
    if (deg > 65 && deg < 115) return '│';
    return dx * dy > 0 ? '╲' : '╱';
  }

  step() {
    const { w, h, lum, ch } = this;
    for (let i = 0; i < lum.length; i++) lum[i] *= 0.6;
    this.stars.forEach((s, n) => {
      const [x0, y0] = this._pos(s);
      s.d += s.v;
      s.v *= 1.12;
      const [x1, y1] = this._pos(s);
      const dx = x1 - x0;
      const dy = y1 - y0;
      const glyph = this._streak(dx, dy);
      const len = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)));
      for (let k = 0; k <= len; k++) {
        const t = len ? k / len : 1;
        const x = Math.round(x0 + dx * t);
        const y = Math.round(y0 + dy * t);
        if (x < 0 || x >= w || y < 0 || y >= h) continue;
        const i = y * w + x;
        const l = Math.min(1, 0.3 + 0.7 * t * Math.min(1, s.d * 2)); // brighter at the head and further out
        if (l >= lum[i]) {
          lum[i] = l;
          ch[i] = glyph;
        }
      }
      if (s.d > 1.05) this.stars[n] = this._star(false);
    });
  }

  rows() {
    const out = [];
    for (let r = 0; r < this.h; r++) {
      let s = '';
      let last = null;
      for (let x = 0; x < this.w; x++) {
        const i = r * this.w + x;
        const l = this.lum[i];
        if (l < 0.08) {
          s += ' ';
          continue;
        }
        const code = l >= 0.95 ? this.head : this.shades[Math.min(WARP_SHADES - 1, Math.floor(l * WARP_SHADES))];
        if (code !== last) s += code;
        last = code;
        s += this.ch[i];
      }
      out.push(s + '\x1b[39m');
    }
    return out;
  }
}

// The start-up screen: hyperspace across the full width (when there's colour), then who's listening.
function banner(version, { agent, mode, cwd, linked }, warp = null) {
  const agents = linked.length > 1 ? c.gray('   agents ') + linked.map((n) => hex(agentColor(n))(n)).join(c.gray(' · ')) : '';
  return [
    ...(warp ? warp.rows() : []),
    '',
    `  ${c.bold(gradient("DaVinci's Shell", PALETTE.gold, PALETTE.clay))}  ${c.gray('v' + version)}  ${c.italic(c.gray('type what you want — your agents do it'))}`,
    `  ${hex(agentColor(agent))(agent)}${c.gray(' · ' + mode + ' · ' + cwd)}${agents}`,
  ].join('\n');
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
const VERB_FRAMES = 40; // a new verb every few seconds
const DOT_FRAMES = 4; // one more dot every 4 frames: "", ".", "..", "..."

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

// The "thinking" line: a shimmering verb with dots that fill in as a loading state.
// It only builds the line; the live region (live.js) decides when to draw it.
class Spinner {
  constructor() {
    this.on = false;
    this.verb = null;
  }

  start(color = PALETTE.clay, started = Date.now()) {
    this.on = true;
    this.color = color;
    this.started = started;
    this.frame = 0;
    this.verb = this._pick();
  }

  stop() {
    this.on = false;
  }

  _pick() {
    let v;
    do v = VERBS[Math.floor(Math.random() * VERBS.length)];
    while (v === this.verb);
    return v;
  }

  line(hint = 'ctrl+c to stop') {
    if (this.frame > 0 && this.frame % VERB_FRAMES === 0) this.verb = this._pick();
    const dots = '.'.repeat(Math.floor(this.frame / DOT_FRAMES) % 4).padEnd(3);
    const secs = Math.floor((Date.now() - this.started) / 1000);
    const s = ` ${shimmer(this.verb, this.frame, this.color)}${hex(this.color)(dots)} ${c.gray(`(${secs}s · ${hint})`)}`;
    this.frame++;
    return s;
  }
}

module.exports = {
  c, hex, gradient, renderMarkdown, banner, agentColor, Spinner, Hyperspace, VERBS, PALETTE, useColor, stripAnsi, visibleWidth,
};
