'use strict';

const os = require('os');
const readline = require('readline');
const { spawn } = require('child_process');
const config = require('./config');
const { createAgents } = require('./agents');
const { commands, getCommand } = require('./commands');
const { c, hex, renderMarkdown, banner, agentColor, Rain, useColor } = require('./ui');
const { Live } = require('./live');
const { IS_WIN, which, desktopDir, tildify, expandTemplate, parseInput } = require('./util');
const { version } = require('../package.json');

const live = new Live();
let speaker = 'claude';
// Set by the Shell: reads one line from the user while an agent waits on it (null = cancelled).
let readAnswer = async () => null;

// Anything printed while an agent runs goes above the live region (spinner, queue, prompt).
const say = (fn) => (...args) => live.print(() => fn(...args));
const write = say((s) => process.stdout.write(s));

// Pause the spinner, show a question, and wait for the user's reply.
async function ask(lines) {
  const wasSpinning = live.pauseSpinner();
  write(lines.join('\n') + '\n');
  const answer = await readAnswer(`  ${hex(agentColor(speaker))('❯')} `);
  if (wasSpinning && answer !== null) live.resumeSpinner();
  return answer;
}

// CLI agents stream raw text that can end mid-line; only whole lines go above the live region.
const rawBuf = { out: '', err: '' };
function raw(key, chunk) {
  rawBuf[key] += chunk;
  const i = rawBuf[key].lastIndexOf('\n');
  if (i < 0) return;
  const done = rawBuf[key].slice(0, i + 1);
  rawBuf[key] = rawBuf[key].slice(i + 1);
  write(key === 'err' ? c.gray(done) : done);
}

// Terminal output for agent runs and commands.
const out = {
  text: say((md) => {
    const [first, ...rest] = renderMarkdown(md.trim()).split('\n');
    const body = [first, ...rest.map((l) => '  ' + l)].join('\n');
    process.stdout.write(`${hex(agentColor(speaker))('●')} ${body}\n\n`);
  }),
  tool: say((name, detail) =>
    process.stdout.write(`  ${hex(agentColor(speaker))('↳')} ${c.bold(name)} ${c.gray(detail)}\n`)
  ),
  // A tool call made by one of the agent's own subagents.
  subtool: say((name, detail) => process.stdout.write(c.gray(`      ↳ ${name} ${detail}`) + '\n')),
  toolResult: say((msg) => process.stdout.write(c.gray(`    ⎿ ${msg}`) + '\n')),
  toolError: say((msg) => process.stdout.write(c.red(`    ✗ ${msg}`) + '\n')),
  // A question from the agent with numbered options. Resolves to the chosen label(s) or free text.
  choose: async (q) => {
    const color = hex(agentColor(speaker));
    const opts = q.options || [];
    const lines = [`${color('?')} ${q.header ? c.bold(q.header) + c.gray(' · ') : ''}${q.question}`];
    opts.forEach((o, i) =>
      lines.push(`    ${color(i + 1 + '.')} ${o.label}${o.description ? c.gray(' — ' + o.description) : ''}`)
    );
    lines.push(c.gray(`    ${q.multiSelect ? 'numbers separated by commas' : 'a number'}, or type your own answer`));
    const a = await ask(lines);
    if (a === null) return null;
    const picks = a.split(/[\s,]+/).filter(Boolean).map(Number);
    if (picks.length && picks.every((n) => Number.isInteger(n) && n >= 1 && n <= opts.length)) {
      return (q.multiSelect ? picks : picks.slice(0, 1)).map((n) => opts[n - 1].label).join(', ');
    }
    return a.trim() || (opts[0] ? opts[0].label : '');
  },
  // A yes/no from the agent. Resolves to 'yes', 'always', 'no', free text, or null if cancelled.
  confirm: async (title, detail = '', always = null) => {
    const color = hex(agentColor(speaker));
    const keys = [`${color('y')} yes`, always && `${color('a')} always allow ${always}`, `${color('n')} no`];
    const a = await ask([
      `${color('?')} ${c.bold(title)} ${c.gray(detail)}`,
      c.gray(`    ${keys.filter(Boolean).join(c.gray(' · '))} · or say what to do instead`),
    ]);
    if (a === null) return null;
    const t = a.trim().toLowerCase();
    if (t === '' || t === 'y' || t === 'yes') return 'yes';
    if (always && (t === 'a' || t === 'always')) return 'always';
    if (t === 'n' || t === 'no') return 'no';
    return a.trim();
  },
  raw: (chunk) => raw('out', chunk),
  rawDim: (chunk) => raw('err', chunk),
  // Print whatever is left of a raw stream once the agent is done.
  flush: () => {
    for (const key of ['out', 'err']) if (rawBuf[key]) raw(key, '\n');
  },
  dim: say((msg) => console.log(c.gray(msg))),
  info: say((msg) => console.log(`  ${msg}`)),
  ok: say((msg) => console.log(`  ${c.green('✓')} ${msg}`)),
  warn: say((msg) => console.log(`  ${c.yellow('!')} ${msg}`)),
  hint: say((msg) => console.log(c.gray(`  ${msg}`))),
  error: say((msg) => console.log(`  ${c.red('✗')} ${msg}`)),
};

process.on('exit', () => live.stop());

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
    this.answering = null;
    this.answerPrompt = '';
    this.queue = live.queue; // lines typed while something runs, shown under the spinner
    readAnswer = (prompt) => this.question(prompt);

    const wanted = agent || this.config.defaultAgent;
    const linked = [...this.agents].find(([, a]) => a.isLinked());
    this.agentName = this.agents.get(wanted) && this.agents.get(wanted).isLinked() ? wanted : linked ? linked[0] : wanted;
  }

  get agent() {
    return this.agents.get(this.agentName);
  }

  // The prompt can be typed into while an agent runs (stdin is a terminal and the shell is open).
  get liveInput() {
    return Boolean(this.rl && process.stdin.isTTY);
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
    speaker = agent.name;
    if (this.liveInput) {
      this.rl.setPrompt(this.queuePrompt());
      this.resumeInput();
    }
    live.start({
      color: agentColor(agent.name),
      input: this.liveInput,
      hint: this.liveInput ? 'esc to stop · type to queue' : 'ctrl+c to stop',
    });
    const result = await agent.run(prompt, { cwd: this.cwd, mode: this.mode, systemPrompt: this.systemPrompt(), out });
    out.flush();
    live.stop();
    if (this.liveInput) this.suspendInput();
    this.running = null;
    const bits = [];
    if (result.durationMs) bits.push(`${(result.durationMs / 1000).toFixed(1)}s`);
    // With a Claude Pro/Max login the cost Claude Code reports is notional, not billed,
    // so only show it when an API key (which is billed) is in use.
    if (result.costUsd && process.env.ANTHROPIC_API_KEY) bits.push(`$${result.costUsd.toFixed(4)}`);
    if (result.ok) console.log(c.gray(`  ${c.green('✓')} ${agent.name}${bits.length ? ' · ' + bits.join(' · ') : ''}`));
    console.log();
    return result;
  }

  // Stop the running agent; anything queued still runs afterwards.
  stop() {
    if (!this.running) return;
    const { name } = this.running;
    this.running.cancel();
    out.warn(`stopped ${name}`);
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
    if (input.kind === 'mention') {
      const agent = this.agents.get(input.name);
      return this.runAgent(agent || this.agent, agent ? input.rest : line.trim());
    }

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
    const color = hex(agentColor(this.agentName));
    return `${c.gold('◆')} ${c.bold(color(this.agentName))}${mode} ${c.gray(tildify(this.cwd))} ${color('❯')} `;
  }

  queuePrompt() {
    return `  ${c.gray('❯')} `;
  }

  completer(line) {
    const names = [...Object.keys(commands), ...Object.keys(this.config.macros)].map((n) => '/' + n);
    const agentCmd = line.match(/^\/(agent|use|ask|unlink)\s+(\S*)$/);
    if (agentCmd) {
      const hits = [...this.agents.keys()].filter((n) => n.startsWith(agentCmd[2]));
      return [hits.map((h) => `/${agentCmd[1]} ${h}`), line];
    }
    const mention = line.match(/^@(\S*)$/);
    if (mention) return [[...this.agents.keys()].filter((n) => n.startsWith(mention[1])).map((n) => `@${n} `), line];
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

  // Read one line for an agent's question while it waits. Resolves to null on Ctrl+C.
  question(prompt) {
    if (!this.rl) {
      // one-shot mode (`davinci "<request>"`): borrow the terminal just for this answer
      live.hide();
      return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        let answer = null;
        rl.question(prompt, (a) => {
          answer = a;
          rl.close();
        });
        rl.on('SIGINT', () => rl.close());
        rl.on('close', () => {
          live.show();
          resolve(answer);
        });
      });
    }
    return new Promise((resolve) => {
      this.answering = resolve;
      this.answerPrompt = prompt;
      this.rl.setPrompt(prompt);
      if (live.active && live.input) return live.refresh();
      this.resumeInput();
      this.rl.prompt();
    });
  }

  answer(value) {
    const resolve = this.answering;
    this.answering = null;
    if (live.active && live.input) {
      this.rl.setPrompt(this.queuePrompt());
      live.refresh();
    } else {
      this.suspendInput();
    }
    resolve(value);
  }

  // Rain falls across the top of the screen until the user starts typing.
  animateBanner(rain, rows, linesBelow) {
    if (!rain || !process.stdin.isTTY) return;
    const timer = setInterval(() => {
      rain.step();
      let s = '\x1b7\x1b[?25l';
      rain.rows().forEach((row, i) => (s += `\x1b8\x1b[${rows + linesBelow - i}A\r${row}`));
      process.stdout.write(s + '\x1b8\x1b[?25h');
    }, 80);
    const stop = () => {
      clearInterval(timer);
      process.stdin.off('keypress', stop);
      process.stdout.off('resize', stop);
    };
    process.stdin.on('keypress', stop);
    process.stdout.on('resize', stop);
  }

  start() {
    const linked = [...this.agents].filter(([, a]) => a.isLinked()).map(([n]) => n);
    const info = { agent: this.agentName, mode: this.mode, cwd: tildify(this.cwd), linked };
    const rain = useColor && process.stdout.isTTY ? new Rain(Math.max(1, (process.stdout.columns || 80) - 1)) : null;
    const text = banner(version, info, rain);
    console.log(text);
    let below = 2;
    if (!linked.length) {
      out.warn('no agents found — install Claude Code (https://claude.com/claude-code) or /link one');
      below++;
    }
    console.log(`  ${c.gray('/help for commands · @agent to ask another agent · esc stops a running agent · keep typing to queue')}\n`);

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      history: config.loadHistory().reverse(),
      historySize: 500,
      completer: (line) => this.completer(line),
    });

    let lastSigint = 0;
    this.rl.on('SIGINT', () => {
      if (this.answering) {
        if (!live.active) process.stdout.write('\n');
        return this.answer(null);
      }
      if (this.rl.line) {
        this.rl.write(null, { ctrl: true, name: 'e' });
        this.rl.write(null, { ctrl: true, name: 'u' });
        return;
      }
      if (this.running) return this.stop();
      if (this.busy) return;
      if (Date.now() - lastSigint < 1500) return this.exit();
      lastSigint = Date.now();
      console.log(c.gray('\n  (Ctrl+C again or /exit to quit)'));
      this.rl.prompt();
    });
    process.on('SIGINT', () => this.stop());
    // Esc stops the running agent, like in the editor chat.
    process.stdin.on('keypress', (s, key) => {
      if (!key || key.name !== 'escape' || !this.running || !live.active) return;
      if (this.answering) this.answer(null);
      else this.stop();
    });

    // Lines typed (or piped) while something is running wait their turn.
    let closed = false;
    const drain = async () => {
      if (this.busy) return;
      this.busy = true;
      this.suspendInput();
      while (this.queue.length) {
        const { line, echo } = this.queue.shift();
        if (echo) console.log(this.promptText() + line);
        try {
          await this.handleLine(line);
        } catch (err) {
          out.error(err.message);
        }
      }
      this.busy = false;
      if (closed) return this.exit();
      this.resumeInput();
      this.rl.setPrompt(this.promptText());
      this.rl.prompt(true);
    };
    this.rl.on('line', (line) => {
      if (live.active && live.input) live.submitted(this.rl.getPrompt(), line);
      if (this.answering) {
        if (live.active) write(this.answerPrompt + line + '\n');
        return this.answer(line);
      }
      if (this.busy) {
        // a few commands act right away instead of waiting in the queue
        const input = parseInput(line);
        const command = input.kind === 'command' && getCommand(input.name);
        if (command && command.instant) command.run(this, input.rest);
        else if (input.kind !== 'empty') this.queue.push({ line, echo: true });
        return live.refresh();
      }
      this.queue.push({ line, echo: false });
      drain();
    });
    this.rl.on('close', () => {
      closed = true;
      if (this.answering) this.answer(null);
      if (!this.busy) this.exit();
    });

    this.rl.setPrompt(this.promptText());
    this.rl.prompt();
    this.animateBanner(rain, text.split('\n').length, below);
  }

  exit() {
    live.stop();
    console.log(c.gray('\n  ciao 👋\n'));
    process.exit(0);
  }
}

module.exports = { Shell };
