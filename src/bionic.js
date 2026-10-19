'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { IS_WIN, which } = require('./util');

// "Bionic compatibility": how much of the shell an agent can actually use,
// measured against an agent with every integration DaVinci knows how to wire up.
// Each check scores 0..1 and is weighted; the total is a percentage.

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function ghLoggedIn() {
  const dir =
    process.env.GH_CONFIG_DIR ||
    (IS_WIN
      ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'GitHub CLI')
      : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'gh'));
  try {
    // hosts.yml lists one top-level key per host gh is signed in to
    return /^\S+:/m.test(fs.readFileSync(path.join(dir, 'hosts.yml'), 'utf8'));
  } catch {
    return false;
  }
}

// Claude Code's MCP servers for this folder: global, per-project and .mcp.json.
function claudeMcpServers(cwd) {
  const names = new Set();
  const user = readJson(path.join(os.homedir(), '.claude.json')) || {};
  Object.keys(user.mcpServers || {}).forEach((n) => names.add(n));
  const key = cwd.replace(/\\/g, '/').toLowerCase();
  for (const [p, proj] of Object.entries(user.projects || {})) {
    if (p.toLowerCase() === key) Object.keys((proj && proj.mcpServers) || {}).forEach((n) => names.add(n));
  }
  const local = readJson(path.join(cwd, '.mcp.json')) || {};
  Object.keys(local.mcpServers || {}).forEach((n) => names.add(n));
  return [...names];
}

// Skills (folders with a SKILL.md, up to two levels deep) and enabled plugins.
function claudeExtensions(cwd) {
  let skills = 0;
  const scan = (dir, depth) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const sub = path.join(dir, e.name);
      if (fs.existsSync(path.join(sub, 'SKILL.md'))) skills++;
      else if (depth > 0) scan(sub, depth - 1);
    }
  };
  scan(path.join(os.homedir(), '.claude', 'skills'), 1);
  scan(path.join(cwd, '.claude', 'skills'), 1);
  const settings = readJson(path.join(os.homedir(), '.claude', 'settings.json')) || {};
  const plugins = Object.values(settings.enabledPlugins || {}).filter(Boolean).length;
  return { skills, plugins };
}

// Everything about the machine the checks need, gathered in one place.
function probe(agent, { cwd, mode }) {
  const isClaude = agent.cfg.type === 'claude';
  return {
    mode,
    linked: agent.isLinked(),
    git: Boolean(which('git')),
    gh: Boolean(which('gh')),
    ghLoggedIn: ghLoggedIn(),
    mcp: isClaude ? claudeMcpServers(cwd) : [],
    ...(isClaude ? claudeExtensions(cwd) : { skills: 0, plugins: 0 }),
  };
}

// Pure scoring: agent kind + config + probed facts -> weighted checks.
function score(kind, cfg, facts) {
  const claude = kind === 'claude';
  const modes = cfg.modes || {};
  const hasModeSlot = (cfg.args || []).includes('{mode}');
  const modeCoverage = claude ? 1 : hasModeSlot ? ['safe', 'normal', 'yolo'].filter((m) => modes[m]).length / 3 : 0;

  const checks = [
    // how the shell and the agent talk to each other
    ['Wiring', 'agent installed', 12, facts.linked ? 1 : 0, 'install it, or set its command in /config'],
    ['Wiring', 'live tool calls shown in the shell', 10, claude ? 1 : 0, 'needs a structured (stream-json) adapter; plain CLIs only print text'],
    ['Wiring', 'permission prompts answered in the shell', 10, claude ? 1 : 0, 'needs an adapter that forwards permission requests'],
    ['Wiring', 'agent questions answered in the shell', 8, claude ? 1 : 0, 'needs an adapter that forwards questions'],
    ['Wiring', 'plan approval in the shell', 6, claude ? 1 : 0, 'needs an adapter with a plan mode'],
    ['Wiring', 'real session memory', 8, claude ? 1 : 0.5, 'DaVinci replays the last few turns instead of a real session'],
    ['Wiring', 'safe / normal / yolo modes mapped', 8, modeCoverage, 'add {mode} to its args and "modes" for safe, normal and yolo in /config'],
    ['Wiring', 'model switching with /model', 4, claude ? 1 : 0, 'only the Claude adapter passes --model'],
    ['Wiring', 'subagent activity shown', 4, claude ? 1 : 0, 'only the Claude adapter reports subagents'],
    ['Wiring', 'spend tracking', 3, claude ? 1 : 0, 'only the Claude adapter reports cost'],
    // what the agent can reach from here
    ['Reach', 'mode lets it act (not safe)', 8, facts.mode === 'safe' ? 0 : 1, '/mode normal'],
    ['Reach', 'git on PATH', 4, facts.git ? 1 : 0, 'install git from https://git-scm.com'],
    ['Reach', 'GitHub CLI installed', 4, facts.gh ? 1 : 0, 'install gh from https://cli.github.com'],
    ['Reach', 'GitHub CLI signed in', 4, facts.ghLoggedIn ? 1 : 0, '!gh auth login'],
    ['Reach', 'MCP servers connected', 4, claude ? Math.min(1, facts.mcp.length) : 0, claude ? 'add one with !claude mcp add' : 'not available to plain CLI agents'],
    ['Reach', 'skills or plugins installed', 3, claude ? Math.min(1, facts.skills + facts.plugins) : 0, claude ? 'add skills under ~/.claude/skills or /plugin in Claude Code' : 'not available to plain CLI agents'],
  ].map(([group, label, weight, got, fix]) => ({ group, label, weight, got, fix }));

  const total = checks.reduce((s, c) => s + c.weight, 0);
  const earned = checks.reduce((s, c) => s + c.weight * c.got, 0);
  return { checks, percent: Math.round((earned / total) * 100) };
}

function check(agent, opts) {
  const kind = agent.cfg.type === 'claude' ? 'claude' : 'cli';
  const facts = probe(agent, opts);
  return { facts, ...score(kind, agent.cfg, facts) };
}

module.exports = { check, score };
