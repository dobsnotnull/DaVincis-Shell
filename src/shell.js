'use strict';

const os = require('os');
const readline = require('readline');
const { spawn } = require('child_process');
const config = require('./config');
const { createAgents } = require('./agents');
const { commands, getCommand } = require('./commands');
const { c, renderMarkdown, banner } = require('./ui');
const { IS_WIN, which, desktopDir, tildify, expandTemplate, parseInput } = require('./util');
const { version } = require('../package.json');

// Terminal output for agent runs and commands.
const out = {
  text: (md) => process.stdout.write(renderMarkdown(md.trim()) + '\n\n'),
  tool: (name, detail) => process.stdout.write(c.gray(`  ↳ ${c.bold(name)} ${detail}`) + '\n'),
  toolError: (msg) => process.stdout.write(c.red(`    ✗ ${msg}`) + '\n'),
  raw: (chunk) => process.stdout.write(chunk),
  rawDim: (chunk) => process.stdout.write(c.gray(chunk)),
  dim: (msg) => console.log(c.gray(msg)),
  info: (msg) => console.log(`  ${msg}`),
  ok: (msg) => console.log(`  ${c.green('✓')} ${msg}`),
  warn: (msg) => console.log(`  ${c.yellow('!')} ${msg}`),
  hint: (msg) => console.log(c.gray(`  ${msg}`)),
  error: (msg) => console.log(`  ${c.red('✗')} ${msg}`),
};

class Shell {
  constructor({ agent, mode } = {}) {
    this.config = config.load();
    this.agents = createAgents(this.config);
    this.mode = mode || this.config.mode || 'normal';
    this.cwd = process.cwd();
    this.out = out;
    this.busy = false;
    this.running = null;
    this.hasGh = Boolean(which('gh'));

    const wanted = agent || this.config.defaultAgent;
    const linked = [...this.agents].find(([, a]) => a.isLinked());
    this.agentName = this.agents.get(wanted) && this.agents.get(wanted).isLinked() ? wanted : linked ? linked[0] : wanted;
  }

  get agent() {
    return this.agents.get(this.agentName);
  }

  systemPrompt() {
    return [
      "You are being driven from DaVinci's Shell, a terminal where the user types plain-language requests.",
      'Act on them directly: run commands, read and edit files, and use your tools rather than explaining how.',
      `Machine: ${os.type()} (${process.platform}${IS_WIN ? ', prefer PowerShell commands' : ''}).`,
      `Home folder: ${os.homedir()}. Desktop: ${desktopDir()}. Current folder: ${this.cwd}.`,
      this.hasGh ? 'The GitHub CLI (gh) is installed and logged in; use it for anything on GitHub.' : '',
      'Keep replies short, this is a terminal.',
      'Before anything destructive or hard to undo (deleting files or repos, force-pushing, making things public), stop and ask first.',
    ]
      .filter(Boolean)
      .join(' ');
  }

  async runAgent(agent, prompt) {
    if (!agent.isLinked()) {
      out.error(`${agent.name} isn't installed. See /agents, or /link your own.`);
      return { ok: false };
    }
    console.log();
    this.running = agent;
    const result = await agent.run(prompt, { cwd: this.cwd, mode: this.mode, systemPrompt: this.systemPrompt(), out });
    this.running = null;
    const bits = [];
    if (result.durationMs) bits.push(`${(result.durationMs / 1000).toFixed(1)}s`);
    if (result.costUsd) bits.push(`$${result.costUsd.toFixed(4)}`);
    if (result.ok) console.log(c.gray(`  ${c.green('✓')} ${agent.name}${bits.length ? ' · ' + bits.join(' · ') : ''}`));
    console.log();
    return result;
  }

  runShell(cmdline) {
    const [cmd, args] = IS_WIN ? ['powershell', ['-NoProfile', '-Command', cmdline]] : [process.env.SHELL || 'sh', ['-c', cmdline]];
    return new Promise((resolve) => {
      const child = spawn(cmd, args, { cwd: this.cwd, stdio: 'inherit' });
      child.on('error', (err) => {
        out.error(err.message);
        resolve();
      });
      child.on('close', resolve);
    });
  }

  async handleLine(line) {
    const input = parseInput(line);
    if (input.kind === 'empty') return;
    config.appendHistory(line.trim());

    if (input.kind === 'shell') return this.runShell(input.rest);
    if (input.kind === 'prompt') return this.runAgent(this.agent, input.rest);

    const command = getCommand(input.name);
    if (command) return command.run(this, input.rest);

    const macro = this.config.macros[input.name];
    if (macro) {
      const prompt = expandTemplate(macro, { args: input.rest, cwd: this.cwd, desktop: desktopDir(), home: os.homedir() });
      console.log(c.gray(`  → ${prompt}`));
      return this.runAgent(this.agent, prompt);
    }
    out.error(`unknown command /${input.name} — try /help`);
  }

  promptText() {
    const mode = this.mode === 'normal' ? '' : this.mode === 'yolo' ? c.red(' yolo') : c.yellow(` ${this.mode}`);
    return `${c.gold('◆')} ${c.bold(this.agentName)}${mode} ${c.blue(tildify(this.cwd))} ${c.gold('❯')} `;
  }

  completer(line) {
    const names = [...Object.keys(commands), ...Object.keys(this.config.macros)].map((n) => '/' + n);
    const agentCmd = line.match(/^\/(agent|use|ask|unlink)\s+(\S*)$/);
    if (agentCmd) {
      const hits = [...this.agents.keys()].filter((n) => n.startsWith(agentCmd[2]));
      return [hits.map((h) => `/${agentCmd[1]} ${h}`), line];
    }
    if (line.startsWith('/') && !line.includes(' ')) return [names.filter((n) => n.startsWith(line)), line];
    return [[], line];
  }

  // While a command runs, hand Ctrl+C to the OS so it can interrupt the agent.
  suspendInput() {
    this.rl.pause();
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
  }

  resumeInput() {
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    this.rl.resume();
  }

  start() {
    console.log(banner(version));
    const linked = [...this.agents].filter(([, a]) => a.isLinked()).map(([n]) => n);
    if (linked.length) {
      console.log(`  ${c.gray('linked agents:')} ${linked.map((n) => (n === this.agentName ? c.bold(c.gold(n)) : n)).join(c.gray(', '))}`);
    } else {
      out.warn('no agents found — install Claude Code (https://claude.com/claude-code) or /link one');
    }
    console.log(`  ${c.gray('/help for commands · /agent <name> to switch · Ctrl+C stops a running agent')}\n`);

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      history: config.loadHistory().reverse(),
      historySize: 500,
      completer: (line) => this.completer(line),
    });

    let lastSigint = 0;
    this.rl.on('SIGINT', () => {
      if (this.rl.line) {
        this.rl.write(null, { ctrl: true, name: 'u' });
        return;
      }
      if (Date.now() - lastSigint < 1500) return this.exit();
      lastSigint = Date.now();
      console.log(c.gray('\n  (Ctrl+C again or /exit to quit)'));
      this.rl.prompt();
    });
    process.on('SIGINT', () => {
      if (this.running) {
        this.running.cancel();
        console.log(c.yellow(`\n  stopped ${this.running.name}`));
      }
    });

    // Lines typed (or piped) while something is running wait their turn.
    const queue = [];
    let closed = false;
    const drain = async () => {
      if (this.busy) return;
      this.busy = true;
      this.suspendInput();
      while (queue.length) {
        try {
          await this.handleLine(queue.shift());
        } catch (err) {
          out.error(err.message);
        }
      }
      this.busy = false;
      if (closed) return this.exit();
      this.resumeInput();
      this.rl.setPrompt(this.promptText());
      this.rl.prompt();
    };
    this.rl.on('line', (line) => {
      queue.push(line);
      drain();
    });
    this.rl.on('close', () => {
      closed = true;
      if (!this.busy) this.exit();
    });

    this.rl.setPrompt(this.promptText());
    this.rl.prompt();
  }

  exit() {
    console.log(c.gray('\n  ciao 👋\n'));
    process.exit(0);
  }
}

module.exports = { Shell };
