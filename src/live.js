'use strict';

const { c, Spinner, visibleWidth } = require('./ui');

const CSI = '\x1b[';
const FRAME_MS = 100;
const SHOW_QUEUED = 3;

const clip = (s, n) => ([...s].length > n ? [...s].slice(0, n - 1).join('') + '…' : s);

// The bottom of the screen while an agent works: the thinking line, any queued
// messages, and a prompt you can keep typing into. Agent output scrolls above it.
class Live {
  constructor(stream = process.stdout) {
    this.stream = stream;
    this.rl = null;
    this.queue = []; // the shell's pending lines ({ line }), shown under the spinner
    this.spinner = new Spinner();
    this.hint = '';
    this.active = false;
    this.input = false; // the prompt is part of the region
    this.hidden = false;
    this.drawn = false;
    this.footerRows = 0;
    this.timer = null;
  }

  cols() {
    return this.stream.columns || 80;
  }

  footer() {
    const lines = [];
    if (this.spinner.on) lines.push(this.spinner.line(this.hint));
    const width = this.cols() - 14;
    for (const item of this.queue.slice(0, SHOW_QUEUED)) lines.push(`  ${c.gray('⧗ queued')}  ${clip(item.line.trim(), width)}`);
    if (this.queue.length > SHOW_QUEUED) lines.push(c.gray(`  ⧗ +${this.queue.length - SHOW_QUEUED} more · /queue clear to drop them`));
    return lines;
  }

  // Put the prompt and what's been typed back, with the cursor where readline thinks it is.
  promptSeq() {
    const rl = this.rl;
    const cols = this.cols();
    const len = visibleWidth(rl.getPrompt()) + [...rl.line].length;
    let s = rl.getPrompt() + rl.line;
    const endRow = Math.floor(len / cols);
    if (len > 0 && len % cols === 0) s += ' \b'; // step off the pending wrap
    const cur = rl.getCursorPos();
    if (endRow > cur.rows) s += `${CSI}${endRow - cur.rows}A`;
    return s + '\r' + (cur.cols ? `${CSI}${cur.cols}C` : '');
  }

  clearSeq() {
    if (!this.drawn) return '';
    this.drawn = false;
    const up = this.footerRows + (this.input ? this.rl.getCursorPos().rows : 0);
    return '\r' + (up ? `${CSI}${up}A` : '') + `${CSI}J`;
  }

  drawSeq() {
    if (!this.active || this.hidden || !this.stream.isTTY) return '';
    const lines = this.footer();
    this.footerRows = lines.length;
    this.drawn = true;
    return lines.map((l) => l + '\n').join('') + (this.input ? this.promptSeq() : '');
  }

  refresh() {
    const s = this.clearSeq() + this.drawSeq();
    if (s) this.stream.write(s);
  }

  // Print something above the region; the region redraws underneath it.
  print(fn) {
    if (!this.drawn) return fn();
    this.stream.write(this.clearSeq());
    try {
      fn();
    } finally {
      this.refresh();
    }
  }

  // readline has just echoed Enter, so the typed line now sits inside the region: wipe it all.
  submitted(prompt, line) {
    if (!this.drawn) return;
    const rows = Math.max(1, Math.ceil((visibleWidth(prompt) + [...line].length) / this.cols()));
    this.stream.write(`\r${CSI}${this.footerRows + rows}A${CSI}J`);
    this.drawn = false;
  }

  start({ color, hint, input }) {
    this.active = true;
    this.input = Boolean(input && this.rl);
    this.hint = hint;
    this.spinner.start(color);
    if (this.stream.isTTY) {
      if (!this.input) this.stream.write(`${CSI}?25l`);
      this.timer = this.timer || setInterval(() => this.refresh(), FRAME_MS);
    }
    this.refresh();
  }

  stop() {
    if (!this.active) return;
    if (this.drawn) this.stream.write(this.clearSeq());
    this.active = false;
    this.spinner.stop();
    clearInterval(this.timer);
    this.timer = null;
    if (this.stream.isTTY) this.stream.write(`${CSI}?25h`);
  }

  // Step aside while something else owns the terminal (a one-shot question).
  hide() {
    if (this.drawn) this.stream.write(this.clearSeq());
    this.hidden = true;
  }

  show() {
    this.hidden = false;
    this.refresh();
  }

  pauseSpinner() {
    const was = this.spinner.on;
    this.spinner.on = false;
    this.refresh();
    return was;
  }

  resumeSpinner() {
    if (!this.active) return;
    this.spinner.on = true;
    this.refresh();
  }
}

module.exports = { Live };
