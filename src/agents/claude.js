'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { IS_WIN, isFile, which, spawnCommand, killTree, firstLine } = require('../util');

// How each DaVinci mode maps onto Claude Code's permission system.
const MODE_ARGS = {
  safe: ['--permission-mode', 'plan'],
  normal: ['--permission-mode', 'auto'],
  yolo: ['--dangerously-skip-permissions'],
};

// Find the Claude Code binary: config override, PATH, standalone install,
// or the copy bundled with the VS Code / Cursor / Windsurf extension.
function findClaude(configured) {
  if (configured) return which(configured);
  const onPath = which('claude');
  if (onPath) return onPath;

  const home = os.homedir();
  const exe = IS_WIN ? 'claude.exe' : 'claude';
  for (const p of [path.join(home, '.local', 'bin', exe), path.join(home, '.claude', 'local', exe)]) {
    if (isFile(p)) return p;
  }

  const found = [];
  for (const editor of ['.vscode', '.vscode-insiders', '.cursor', '.windsurf']) {
    const dir = path.join(home, editor, 'extensions');
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.startsWith('anthropic.claude-code')) continue;
      const p = path.join(dir, entry, 'resources', 'native-binary', exe);
      try {
        found.push({ p, mtime: fs.statSync(p).mtimeMs });
      } catch {
        // extension without a bundled binary
      }
    }
  }
  found.sort((a, b) => b.mtime - a.mtime);
  return found.length ? found[0].p : null;
}

function summarizeInput(input = {}) {
  const v =
    input.command ||
    input.file_path ||
    input.path ||
    input.pattern ||
    input.url ||
    input.query ||
    input.description ||
    input.prompt;
  return firstLine(v || JSON.stringify(input), 100);
}

function toolResultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((b) => b.text || '').join('\n');
  return '';
}

class ClaudeAgent {
  constructor(name, cfg) {
    this.name = name;
    this.cfg = cfg;
    this.sessionId = null;
    this.costUsd = 0;
    this.child = null;
    this._command = undefined;
  }

  get description() {
    return this.cfg.description;
  }

  command() {
    if (this._command === undefined) this._command = findClaude(this.cfg.command);
    return this._command;
  }

  isLinked() {
    return Boolean(this.command());
  }

  reset() {
    this.sessionId = null;
  }

  cancel() {
    killTree(this.child);
  }

  run(prompt, { cwd, mode, systemPrompt, out }) {
    const args = ['-p', '--output-format', 'stream-json', '--verbose', ...(MODE_ARGS[mode] || MODE_ARGS.normal)];
    args.push('--append-system-prompt', systemPrompt);
    if (this.cfg.model) args.push('--model', this.cfg.model);
    if (this.sessionId) args.push('--resume', this.sessionId);

    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        this.child = null;
        resolve(value);
      };

      const child = spawnCommand(this.command(), args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
      this.child = child;
      let buf = '';
      let stderr = '';
      let result = null;

      const handleLine = (line) => {
        const ev = this._parse(line, out);
        if (ev && ev.type === 'result') result = ev;
      };

      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        buf += chunk;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (line) handleLine(line);
        }
      });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => (stderr += chunk));
      child.on('error', (err) => {
        out.error(`couldn't start Claude: ${err.message}`);
        finish({ ok: false });
      });
      child.on('close', (code) => {
        if (buf.trim()) handleLine(buf.trim());
        if (!result && code !== 0) out.error(stderr.trim() || `Claude exited with code ${code}`);
        finish({
          ok: code === 0 && !(result && result.is_error),
          durationMs: result && result.duration_ms,
          costUsd: result && result.total_cost_usd,
        });
      });
      child.stdin.on('error', () => {}); // child may exit before reading stdin
      child.stdin.end(prompt);
    });
  }

  _parse(line, out) {
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      out.dim(line);
      return null;
    }
    switch (ev.type) {
      case 'system':
        if (ev.subtype === 'init' && ev.session_id) this.sessionId = ev.session_id;
        break;
      case 'assistant':
        if (ev.parent_tool_use_id) break; // subagent chatter
        for (const block of (ev.message && ev.message.content) || []) {
          if (block.type === 'text' && block.text.trim()) out.text(block.text);
          else if (block.type === 'tool_use') out.tool(block.name, summarizeInput(block.input));
        }
        break;
      case 'user':
        for (const block of (ev.message && ev.message.content) || []) {
          if (block.type === 'tool_result' && block.is_error) out.toolError(firstLine(toolResultText(block.content)));
        }
        break;
      case 'result': {
        if (ev.session_id) this.sessionId = ev.session_id;
        if (typeof ev.total_cost_usd === 'number') this.costUsd += ev.total_cost_usd;
        if (ev.is_error && ev.result) out.error(ev.result);
        const denials = ev.permission_denials || [];
        for (const d of denials) out.warn(`blocked: ${d.tool_name} ${summarizeInput(d.tool_input)}`);
        if (denials.length) out.hint('Some actions were blocked. Use /mode yolo to allow everything, or allow them in your Claude settings.');
        break;
      }
    }
    return ev;
  }
}

module.exports = { ClaudeAgent, findClaude };
