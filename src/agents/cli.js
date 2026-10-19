'use strict';

const { which, spawnCommand, killTree } = require('../util');

const MAX_TURNS = 6;
const MAX_REPLY_CHARS = 3000;

// Expand an agent's arg template: "{mode}" becomes the mode's flags,
// "{prompt}" becomes the prompt (otherwise the prompt goes over stdin).
function buildArgs(template, modeArgs, prompt) {
  const args = [];
  let promptInArgs = false;
  for (const arg of template) {
    if (arg === '{mode}') args.push(...modeArgs);
    else if (arg.includes('{prompt}')) {
      args.push(arg.split('{prompt}').join(prompt));
      promptInArgs = true;
    } else args.push(arg);
  }
  return { args, promptInArgs };
}

// Any command-line agent that takes a prompt and prints an answer
// (Codex, Gemini, `ollama run <model>`, your own script...). DaVinci keeps
// the recent conversation and hands it back each turn so it has context.
class CliAgent {
  constructor(name, cfg) {
    this.name = name;
    this.cfg = cfg;
    this.history = [];
    this.child = null;
  }

  get description() {
    return this.cfg.description || [this.cfg.command, ...(this.cfg.args || [])].join(' ');
  }

  command() {
    return which(this.cfg.command);
  }

  isLinked() {
    return Boolean(this.command());
  }

  reset() {
    this.history = [];
  }

  cancel() {
    killTree(this.child);
  }

  _fullPrompt(prompt, systemPrompt) {
    const parts = [systemPrompt];
    if (this.history.length) {
      parts.push(
        'Conversation so far:\n' + this.history.map((t) => `User: ${t.user}\nYou: ${t.agent}`).join('\n\n')
      );
    }
    parts.push(`User's request:\n${prompt}`);
    return parts.join('\n\n');
  }

  run(prompt, { cwd, mode, systemPrompt, out }) {
    const full = this._fullPrompt(prompt, systemPrompt);
    const modeArgs = (this.cfg.modes && this.cfg.modes[mode]) || [];
    const { args, promptInArgs } = buildArgs(this.cfg.args || [], modeArgs, full);

    return new Promise((resolve) => {
      let settled = false;
      let reply = '';
      const started = Date.now();
      const finish = (value) => {
        if (settled) return;
        settled = true;
        this.child = null;
        resolve(value);
      };

      const child = spawnCommand(this.command(), args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
      this.child = child;
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        reply += chunk;
        out.raw(chunk);
      });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => out.rawDim(chunk));
      child.on('error', (err) => {
        out.error(`couldn't start ${this.name}: ${err.message}`);
        finish({ ok: false });
      });
      child.on('close', (code) => {
        if (reply && !reply.endsWith('\n')) out.raw('\n');
        this.history.push({ user: prompt, agent: reply.trim().slice(-MAX_REPLY_CHARS) });
        if (this.history.length > MAX_TURNS) this.history.shift();
        if (code !== 0) out.error(`${this.name} exited with code ${code}`);
        finish({ ok: code === 0, durationMs: Date.now() - started });
      });
      child.stdin.on('error', () => {});
      child.stdin.end(promptInArgs ? '' : full);
    });
  }
}

module.exports = { CliAgent, buildArgs };
