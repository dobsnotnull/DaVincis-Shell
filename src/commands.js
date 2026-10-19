'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { IS_WIN, which, splitArgs, desktopDir, tildify, expandHome } = require('./util');
const { createAgent } = require('./agents');
const config = require('./config');
const { c, hex, agentColor } = require('./ui');
const { setupTerminal } = require('./terminal');

const MODES = {
  safe: 'look and plan only — no changes',
  normal: 'edits files and runs commands; risky actions get checked first',
  yolo: 'no permission checks at all (be careful)',
};

// Run a process attached to this terminal and wait for it.
function runAttached(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: 'inherit', ...opts });
    child.on('error', (err) => {
      console.log(c.red(`  ${err.message}`));
      resolve(1);
    });
    child.on('close', (code) => resolve(code));
  });
}

function gh(shell, args) {
  if (!which('gh')) {
    shell.out.error('GitHub CLI (gh) is not installed — get it from https://cli.github.com');
    return Promise.resolve(1);
  }
  return runAttached('gh', args, { cwd: shell.cwd });
}

function openTarget(target, cwd) {
  if (IS_WIN) {
    // Pass the target through the environment so nothing in it is parsed as PowerShell.
    return runAttached('powershell', ['-NoProfile', '-Command', 'Start-Process -FilePath $env:DAVINCI_TARGET'], {
      cwd,
      env: { ...process.env, DAVINCI_TARGET: target },
    });
  }
  return runAttached(process.platform === 'darwin' ? 'open' : 'xdg-open', [target], { cwd });
}

const commands = {
  help: {
    group: 'Shell',
    desc: 'show this help',
    run(shell) {
      const groups = {};
      for (const [name, cmd] of Object.entries(commands)) {
        (groups[cmd.group] = groups[cmd.group] || []).push([name, cmd]);
      }
      console.log();
      console.log(`  Just type what you want and press Enter. ${c.gray('Lines starting with ! run directly in your shell.')}`);
      console.log(c.gray('  @<agent> <request> asks another agent · keep typing while an agent works to queue messages · Esc stops it'));
      for (const [group, list] of Object.entries(groups)) {
        console.log(`\n  ${c.bold(c.gold(group))}`);
        for (const [name, cmd] of list) {
          const usage = `/${name}${cmd.usage ? ' ' + cmd.usage : ''}`;
          console.log(`    ${c.cyan(usage.padEnd(28))} ${c.gray(cmd.desc)}`);
        }
      }
      const macros = Object.keys(shell.config.macros);
      if (macros.length) {
        console.log(`\n  ${c.bold(c.gold('Macros'))} ${c.gray('(see /macros)')}`);
        console.log('    ' + macros.map((m) => c.cyan('/' + m)).join('  '));
      }
      console.log();
    },
  },

  agents: {
    group: 'Agents',
    desc: 'list agents and which ones are linked',
    run(shell) {
      console.log();
      for (const [name, agent] of shell.agents) {
        const active = name === shell.agentName;
        const mark = active ? hex(agentColor(name))('●') : ' ';
        const status = agent.isLinked() ? c.green('linked'.padEnd(14)) : c.gray('not installed'.padEnd(14));
        const label = agent.isLinked() ? hex(agentColor(name))(name.padEnd(10)) : c.gray(name.padEnd(10));
        console.log(`  ${mark} ${active ? c.bold(label) : label} ${status} ${c.gray(agent.description)}`);
      }
      console.log(c.gray('\n  /agent <name> to switch · /link <name> <command...> to add your own\n'));
    },
  },

  agent: {
    group: 'Agents',
    usage: '<name>',
    desc: 'switch to another agent',
    run(shell, rest) {
      if (!rest) return commands.agents.run(shell);
      const agent = shell.agents.get(rest);
      if (!agent) return shell.out.error(`no agent called "${rest}" — see /agents`);
      if (!agent.isLinked()) {
        return shell.out.error(`${rest} isn't installed (looked for "${agent.cfg.command || rest}" on your PATH)`);
      }
      shell.agentName = rest;
      shell.out.ok(`now talking to ${c.bold(rest)}`);
    },
  },

  ask: {
    group: 'Agents',
    usage: '<agent> <request>',
    desc: 'one request to another agent, without switching',
    async run(shell, rest) {
      const [name, ...words] = rest.split(/\s+/);
      const agent = shell.agents.get(name);
      if (!agent || !words.length) return shell.out.error('usage: /ask <agent> <request>');
      if (!agent.isLinked()) return shell.out.error(`${name} isn't installed`);
      await shell.runAgent(agent, words.join(' '));
    },
  },

  stop: {
    group: 'Agents',
    instant: true,
    desc: 'stop the running agent (also Esc or Ctrl+C)',
    run(shell) {
      if (!shell.running) return shell.out.hint('nothing is running');
      shell.stop();
    },
  },

  queue: {
    group: 'Agents',
    instant: true,
    usage: '[clear|undo]',
    desc: 'messages waiting for the agent: list, clear, or drop the last one',
    run(shell, rest) {
      const q = shell.queue;
      if (rest === 'clear') {
        const n = q.splice(0).length;
        return shell.out.ok(n ? `dropped ${n} queued message${n > 1 ? 's' : ''}` : 'the queue is empty');
      }
      if (rest === 'undo') {
        const last = q.pop();
        return last ? shell.out.ok(`dropped "${last.line.trim()}"`) : shell.out.hint('the queue is empty');
      }
      if (!q.length) return shell.out.hint('the queue is empty — type while an agent works to queue a message');
      q.forEach((item, i) => shell.out.info(`${c.gray(String(i + 1) + '.')} ${item.line.trim()}`));
    },
  },

  link: {
    group: 'Agents',
    usage: '<name> <command> [args...]',
    desc: 'link any CLI agent (prompt is sent on stdin)',
    run(shell, rest) {
      const [name, command, ...args] = splitArgs(rest);
      if (!name || !command) {
        return shell.out.error('usage: /link <name> <command> [args...]   e.g. /link llama ollama run llama3.2');
      }
      const cfg = { type: 'cli', description: [command, ...args].join(' '), command, args };
      shell.config.agents[name] = cfg;
      shell.agents.set(name, createAgent(name, cfg));
      config.save(shell.config);
      const linked = shell.agents.get(name).isLinked();
      shell.out.ok(`linked ${c.bold(name)}${linked ? '' : c.yellow(` (but "${command}" isn't on your PATH yet)`)} — /agent ${name} to use it`);
    },
  },

  unlink: {
    group: 'Agents',
    usage: '<name>',
    desc: 'remove an agent',
    run(shell, rest) {
      if (!shell.agents.has(rest)) return shell.out.error(`no agent called "${rest}"`);
      if (rest === 'claude') return shell.out.error("claude is built in — it can't be unlinked");
      shell.agents.delete(rest);
      delete shell.config.agents[rest];
      config.save(shell.config);
      if (shell.agentName === rest) shell.agentName = 'claude';
      shell.out.ok(`unlinked ${rest}`);
    },
  },

  mode: {
    group: 'Agents',
    usage: '[safe|normal|yolo]',
    desc: 'how much the agent may do on its own',
    run(shell, rest) {
      if (!rest) {
        console.log();
        for (const [m, d] of Object.entries(MODES)) {
          console.log(`  ${m === shell.mode ? c.gold('●') : ' '} ${m.padEnd(8)} ${c.gray(d)}`);
        }
        console.log();
        return;
      }
      if (!MODES[rest]) return shell.out.error('modes: safe, normal, yolo');
      shell.mode = rest;
      shell.config.mode = rest;
      config.save(shell.config);
      shell.out.ok(`mode: ${rest === 'yolo' ? c.red(rest) : rest} — ${MODES[rest]}`);
    },
  },

  model: {
    group: 'Agents',
    usage: '[name|default]',
    desc: "set the current agent's model (claude: opus, sonnet...)",
    run(shell, rest) {
      const agent = shell.agent;
      if (!rest) return shell.out.info(`model: ${agent.cfg.model || 'default'}`);
      agent.cfg.model = rest === 'default' ? null : rest;
      shell.out.ok(`${agent.name} model: ${agent.cfg.model || 'default'}`);
    },
  },

  new: {
    group: 'Agents',
    desc: 'start a fresh conversation with the current agent',
    run(shell) {
      shell.agent.reset();
      shell.out.ok(`fresh conversation with ${shell.agentName}`);
    },
  },

  status: {
    group: 'Agents',
    desc: 'agent, mode, folder and spend for this session',
    run(shell) {
      const a = shell.agent;
      console.log();
      console.log(`  agent   ${c.bold(a.name)} ${c.gray(a.command() || '')}`);
      console.log(`  mode    ${shell.mode}`);
      console.log(`  folder  ${shell.cwd}`);
      if (a.sessionId) console.log(`  session ${c.gray(a.sessionId)}`);
      if (a.costUsd && process.env.ANTHROPIC_API_KEY) console.log(`  spend   ~$${a.costUsd.toFixed(4)}`);
      console.log();
    },
  },

  cd: {
    group: 'Files & desktop',
    usage: '<folder>',
    desc: 'change the folder agents work in',
    run(shell, rest) {
      const target = path.resolve(shell.cwd, expandHome(rest || '~'));
      if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
        return shell.out.error(`not a folder: ${target}`);
      }
      shell.cwd = target;
    },
  },

  desktop: {
    group: 'Files & desktop',
    desc: 'jump to your Desktop',
    run(shell) {
      shell.cwd = desktopDir();
    },
  },

  home: {
    group: 'Files & desktop',
    desc: 'jump to your home folder',
    run(shell) {
      shell.cwd = os.homedir();
    },
  },

  pwd: {
    group: 'Files & desktop',
    desc: 'show the current folder',
    run(shell) {
      console.log(`  ${shell.cwd}`);
    },
  },

  ls: {
    group: 'Files & desktop',
    usage: '[folder]',
    desc: 'list files',
    run(shell, rest) {
      const dir = path.resolve(shell.cwd, expandHome(rest || '.'));
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (err) {
        return shell.out.error(err.message);
      }
      entries.sort((a, b) => b.isDirectory() - a.isDirectory() || a.name.localeCompare(b.name));
      for (const e of entries) console.log('  ' + (e.isDirectory() ? c.blue(e.name + '/') : e.name));
    },
  },

  open: {
    group: 'Files & desktop',
    usage: '<file|folder|url|app>',
    desc: 'open something with its default app',
    async run(shell, rest) {
      if (!rest) return shell.out.error('usage: /open <file|folder|url|app>');
      const local = path.resolve(shell.cwd, expandHome(rest));
      await openTarget(fs.existsSync(local) ? local : rest, shell.cwd);
    },
  },

  repos: {
    group: 'GitHub',
    usage: '[owner]',
    desc: 'list your GitHub repos',
    run(shell, rest) {
      return gh(shell, ['repo', 'list', ...(rest ? [rest] : []), '--limit', '30']);
    },
  },

  issues: {
    group: 'GitHub',
    usage: '[owner/repo]',
    desc: 'open issues here, in a repo, or assigned to you',
    run(shell, rest) {
      if (rest) return gh(shell, ['issue', 'list', '-R', rest]);
      if (fs.existsSync(path.join(shell.cwd, '.git'))) return gh(shell, ['issue', 'list']);
      return gh(shell, ['search', 'issues', '--assignee', '@me', '--state', 'open']);
    },
  },

  prs: {
    group: 'GitHub',
    usage: '[owner/repo]',
    desc: 'open pull requests here, in a repo, or yours',
    run(shell, rest) {
      if (rest) return gh(shell, ['pr', 'list', '-R', rest]);
      if (fs.existsSync(path.join(shell.cwd, '.git'))) return gh(shell, ['pr', 'list']);
      return gh(shell, ['search', 'prs', '--author', '@me', '--state', 'open']);
    },
  },

  gh: {
    group: 'GitHub',
    usage: '<args...>',
    desc: 'run any gh command directly',
    run(shell, rest) {
      return gh(shell, splitArgs(rest));
    },
  },

  web: {
    group: 'GitHub',
    desc: "open this folder's repo on github.com",
    run(shell) {
      return gh(shell, ['repo', 'view', '--web']);
    },
  },

  macros: {
    group: 'Macros',
    desc: 'list your macros',
    run(shell) {
      console.log();
      for (const [name, tpl] of Object.entries(shell.config.macros)) {
        console.log(`  ${c.cyan(('/' + name).padEnd(12))} ${c.gray(tpl)}`);
      }
      console.log(c.gray('\n  placeholders: {args} {args|fallback} {cwd} {desktop} {home}\n'));
    },
  },

  macro: {
    group: 'Macros',
    usage: 'add <name> <text> | rm <name>',
    desc: 'make your own /commands',
    run(shell, rest) {
      const m = rest.match(/^(add|rm)\s+([\w-]+)\s*([\s\S]*)$/);
      if (!m) return shell.out.error('usage: /macro add <name> <text with {args}>  or  /macro rm <name>');
      const [, action, rawName, text] = m;
      const name = rawName.toLowerCase();
      if (action === 'add') {
        if (commands[name]) return shell.out.error(`/${name} is a built-in command`);
        if (!text) return shell.out.error('a macro needs some text');
        shell.config.macros[name] = text;
        shell.out.ok(`added /${name}`);
      } else {
        if (!shell.config.macros[name]) return shell.out.error(`no macro /${name}`);
        delete shell.config.macros[name];
        shell.out.ok(`removed /${name}`);
      }
      config.save(shell.config);
    },
  },

  history: {
    group: 'Shell',
    desc: 'your recent inputs',
    run() {
      const lines = config.loadHistory().slice(-20);
      lines.forEach((l, i) => console.log(`  ${c.gray(String(i + 1).padStart(3))}  ${l}`));
    },
  },

  config: {
    group: 'Shell',
    desc: 'open the config file',
    async run(shell) {
      shell.out.info(tildify(config.CONFIG_FILE));
      await openTarget(config.CONFIG_FILE, shell.cwd);
    },
  },

  terminal: {
    group: 'Shell',
    desc: 'add a themed DaVinci profile to your terminal',
    run(shell) {
      const result = setupTerminal();
      (result.ok ? shell.out.ok : shell.out.warn)(result.message);
    },
  },

  clear: {
    group: 'Shell',
    desc: 'clear the screen',
    run() {
      console.clear();
    },
  },

  exit: {
    group: 'Shell',
    desc: 'leave (also /quit, Ctrl+D)',
    run(shell) {
      shell.exit();
    },
  },
};

const aliases = { quit: 'exit', q: 'exit', use: 'agent', '?': 'help' };

function getCommand(name) {
  return commands[aliases[name] || name];
}

module.exports = { commands, getCommand, MODES };
