'use strict';

const os = require('os');
const readline = require('readline');
const { spawn } = require('child_process');
const config = require('./config');
const { createAgents } = require('./agents');
const { commands, getCommand } = require('./commands');
const { c, hex, renderMarkdown, banner, agentColor, Spinner, visibleWidth } = require('./ui');
const { IS_WIN, which, desktopDir, tildify, expandTemplate, parseInput } = require('./util');
const { version } = require('../package.json');

const spinner = new Spinner();
let speaker = 'claude';
// Set by the Shell: reads one line from the user while an agent waits on it (null = cancelled).
let readAnswer = async () => null;

// Anything printed while the spinner runs clears its line first; it redraws on the next tick.
const say = (fn) => (...args) => {
  spinner.clear();
  fn(...args);
};

// Pause the spinner, show a question, and wait for the user's reply.
async function ask(lines) {
  const started = spinner.started;
  const wasActive = spinner.active;
  spinner.stop();
  process.stdout.write(lines.join('\n') + '\n');
  const answer = await readAnswer(`  ${hex(agentColor(speaker))('❯')} `);
  if (wasActive && answer !== null) {
    console.log();
    spinner.start(agentColor(speaker), started);
  }
  return answer;
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
  // Raw streams from CLI agents can end mid-line, so the spinner bows out for good.
  raw: (chunk) => {
    spinner.stop();
    process.stdout.write(chunk);
  },
  rawDim: (chunk) => {
    spinner.stop();
    process.stdout.write(c.gray(chunk));
  },
  dim: say((msg) => console.log(c.gray(msg))),
  info: say((msg) => console.log(`  ${msg}`)),
  ok: say((msg) => console.log(`  ${c.green('✓')} ${msg}`)),
  warn: say((msg) => console.log(`  ${c.yellow('!')} ${msg}`)),
  hint: say((msg) => console.log(c.gray(`  ${msg}`))),
  error: say((msg) => console.log(`  ${c.red('✗')} ${msg}`)),
};

process.on('exit', () => spinner.stop());

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
    readAnswer = (prompt) => this.question(prompt);

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
    speaker = agent.name;
    spinner.start(agentColor(agent.name));
    const result = await agent.run(prompt, { cwd: this.cwd, mode: this.mode, systemPrompt: this.systemPrompt(), out });
    spinner.stop();
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
    const color = hex(agentColor(this.agentName));
    return `${c.gold('◆')} ${c.bold(color(this.agentName))}${mode} ${c.gray(tildify(this.cwd))} ${color('❯')} `;
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

  // Read one line for an agent's question while it waits. Resolves to null on Ctrl+C.
  question(prompt) {
    if (!this.rl) {
      // one-shot mode (`davinci "<request>"`): borrow the terminal just for this answer
      return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        let answer = null;
        rl.question(prompt, (a) => {
          answer = a;
          rl.close();
        });
        rl.on('SIGINT', () => rl.close());
        rl.on('close', () => resolve(answer));
      });
    }
    return new Promise((resolve) => {
      this.answering = resolve;
      this.resumeInput();
      this.rl.setPrompt(prompt);
      this.rl.prompt();
    });
  }

  answer(value) {
    const resolve = this.answering;
    this.answering = null;
    this.suspendInput();
    resolve(value);
  }

  // The banner creature wanders about until the user starts typing.
  animateBanner(info, linesBelow) {
    if (!process.stdout.isTTY || !process.stdin.isTTY) return;
    const first = banner(version, info).split('\n');
    if ((process.stdout.columns || 0) <= visibleWidth(first[1])) return; // a wrapped box would smear
    const rows = [3, 4]; // the creature's lines within the banner
    let tick = 0;
    const timer = setInterval(() => {
      const lines = banner(version, info, ++tick).split('\n');
      let s = '\x1b7\x1b[?25l';
      for (const i of rows) s += `\x1b8\x1b[${first.length + linesBelow - i}A\r${lines[i]}`;
      process.stdout.write(s + '\x1b8\x1b[?25h');
    }, 160);
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
    console.log(banner(version, info));
    let below = 2;
    if (!linked.length) {
      out.warn('no agents found — install Claude Code (https://claude.com/claude-code) or /link one');
      below++;
    }
    console.log(`  ${c.gray('/help for commands · /agent <name> to switch · ctrl+c stops a running agent')}\n`);

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
        process.stdout.write('\n');
        return this.answer(null);
      }
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
      if (this.answering) return this.answer(line);
      queue.push(line);
      drain();
    });
    this.rl.on('close', () => {
      closed = true;
      if (this.answering) this.answer(null);
      if (!this.busy) this.exit();
    });

    this.rl.setPrompt(this.promptText());
    this.rl.prompt();
    this.animateBanner(info, below);
  }

  exit() {
    console.log(c.gray('\n  ciao 👋\n'));
    process.exit(0);
  }
}

module.exports = { Shell };
