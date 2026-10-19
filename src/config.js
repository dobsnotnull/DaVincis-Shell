'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const CONFIG_DIR = process.env.DAVINCI_HOME || path.join(os.homedir(), '.davinci');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const HISTORY_FILE = path.join(CONFIG_DIR, 'history');

const DEFAULTS = {
  defaultAgent: 'claude',
  mode: 'normal',
  agents: {
    claude: {
      type: 'claude',
      description: 'Anthropic Claude via Claude Code (uses your Claude login)',
      command: null, // auto-detected; set a path here to override
      model: null,
    },
    codex: {
      type: 'cli',
      description: 'OpenAI Codex CLI',
      command: 'codex',
      args: ['exec', '--skip-git-repo-check', '{mode}', '-'],
      modes: {
        safe: ['--sandbox', 'read-only'],
        normal: ['--full-auto'],
        yolo: ['--dangerously-bypass-approvals-and-sandbox'],
      },
    },
    gemini: {
      type: 'cli',
      description: 'Google Gemini CLI',
      command: 'gemini',
      args: ['{mode}'],
      modes: {
        safe: [],
        normal: ['--approval-mode', 'auto_edit'],
        yolo: ['--yolo'],
      },
    },
  },
  macros: {
    commit: 'Look at the git changes in the current directory, write a clear commit message, commit, and push to the current branch. {args}',
    tidy: 'Organize the files on my Desktop ({desktop}) into folders by type. Show me the plan as a list first, then do it. Never delete anything. {args}',
    standup: 'Use the gh CLI to summarize what I did on GitHub in the last {args|7} days: commits, pull requests, issues and reviews.',
    newrepo: 'Create a new private GitHub repo named "{args}" with gh, clone it into {cwd}, add a README and push it.',
    explain: 'Explain what this is and how it works, briefly: {args}',
    fix: 'Find and fix this problem: {args}. Run the tests afterwards if the project has any.',
  },
};

function load() {
  let user = {};
  try {
    user = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`warning: couldn't read ${CONFIG_FILE}: ${err.message} (using defaults)`);
    }
  }
  const config = {
    ...DEFAULTS,
    ...user,
    agents: { ...DEFAULTS.agents },
    macros: { ...DEFAULTS.macros, ...(user.macros || {}) },
  };
  for (const [name, agent] of Object.entries(user.agents || {})) {
    config.agents[name] = { ...(DEFAULTS.agents[name] || {}), ...agent };
  }
  if (!fs.existsSync(CONFIG_FILE)) save(config);
  return config;
}

function save(config) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n');
}

function loadHistory() {
  try {
    return fs.readFileSync(HISTORY_FILE, 'utf8').split('\n').filter(Boolean).slice(-500);
  } catch {
    return [];
  }
}

function appendHistory(line) {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.appendFileSync(HISTORY_FILE, line.replace(/\r?\n/g, ' ') + '\n');
  } catch {
    // history is a convenience; never fail a command over it
  }
}

module.exports = { CONFIG_DIR, CONFIG_FILE, HISTORY_FILE, DEFAULTS, load, save, loadHistory, appendHistory };
