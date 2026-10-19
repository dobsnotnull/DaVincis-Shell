'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const IS_WIN = process.platform === 'win32';

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

// Resolve a command name to a full path using PATH (and PATHEXT on Windows).
function which(cmd) {
  if (!cmd) return null;
  if (path.isAbsolute(cmd) || cmd.includes('/') || cmd.includes('\\')) {
    return isFile(cmd) ? cmd : null;
  }
  const exts = IS_WIN
    ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    if (IS_WIN && path.extname(cmd) && isFile(path.join(dir, cmd))) return path.join(dir, cmd);
    for (const ext of exts) {
      const p = path.join(dir, cmd + ext);
      if (isFile(p)) return p;
    }
  }
  return null;
}

function quoteWinArg(arg) {
  const s = String(arg);
  if (s === '') return '""';
  return /[\s"&|<>^()%!]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Spawn a command. .cmd/.bat shims on Windows (npm-installed CLIs) need a shell,
// so we build the command line ourselves; user prompts always go over stdin.
function spawnCommand(cmd, args, opts = {}) {
  if (IS_WIN && /\.(cmd|bat)$/i.test(cmd)) {
    const line = [cmd, ...args].map(quoteWinArg).join(' ');
    return spawn(line, { ...opts, shell: true, windowsHide: true });
  }
  return spawn(cmd, args, { ...opts, windowsHide: true });
}

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (IS_WIN) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } else {
    child.kill('SIGINT');
    setTimeout(() => child.exitCode === null && child.kill('SIGKILL'), 2000).unref();
  }
}

function desktopDir() {
  const home = os.homedir();
  const candidates = [path.join(home, 'Desktop'), path.join(home, 'OneDrive', 'Desktop')];
  return candidates.find((p) => fs.existsSync(p)) || candidates[0];
}

function tildify(p) {
  const home = os.homedir();
  return p.toLowerCase().startsWith(home.toLowerCase()) ? '~' + p.slice(home.length) : p;
}

function expandHome(p) {
  return p === '~' || p.startsWith('~/') || p.startsWith('~\\') ? path.join(os.homedir(), p.slice(1)) : p;
}

// Split a string into args, honouring "double" and 'single' quotes.
function splitArgs(str) {
  const out = [];
  let cur = '';
  let quote = null;
  let has = false;
  for (const ch of str) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (cur || has) out.push(cur);
      cur = '';
      has = false;
    } else {
      cur += ch;
    }
  }
  if (cur || has) out.push(cur);
  return out;
}

// Fill {name} and {name|fallback} placeholders. Unknown names are left alone.
function expandTemplate(tpl, vars) {
  return tpl.replace(/\{(\w+)(?:\|([^}]*))?\}/g, (match, key, fallback) => {
    const v = vars[key];
    if (v === undefined) return match;
    return v === '' && fallback !== undefined ? fallback : v;
  });
}

// Classify a line typed at the prompt.
function parseInput(line) {
  const text = line.trim();
  if (!text) return { kind: 'empty' };
  if (text.startsWith('!')) return { kind: 'shell', rest: text.slice(1).trim() };
  const m = text.match(/^\/([a-zA-Z][\w-]*)(?:\s+([\s\S]*))?$/);
  if (m) return { kind: 'command', name: m[1].toLowerCase(), rest: (m[2] || '').trim() };
  const at = text.match(/^@([\w-]+)\s+([\s\S]+)$/);
  if (at) return { kind: 'mention', name: at[1].toLowerCase(), rest: at[2].trim() };
  return { kind: 'prompt', rest: text };
}

function firstLine(s, max = 160) {
  const line = String(s || '').split(/\r?\n/).find((l) => l.trim()) || '';
  return line.length > max ? line.slice(0, max - 1) + '…' : line;
}

module.exports = {
  IS_WIN,
  isFile,
  which,
  spawnCommand,
  killTree,
  desktopDir,
  tildify,
  expandHome,
  splitArgs,
  expandTemplate,
  parseInput,
  firstLine,
};
