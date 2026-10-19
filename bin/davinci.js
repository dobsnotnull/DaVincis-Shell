#!/usr/bin/env node
'use strict';

const { Shell } = require('../src/shell');
const { version } = require('../package.json');

const HELP = `DaVinci's Shell v${version}

usage:
  davinci                         start the shell
  davinci "<request>"             run one request and exit
  davinci -a <agent> "<request>"  ...with a specific agent

options:
  -a, --agent <name>   agent to start with (claude, codex, gemini, or one you linked)
  -m, --mode <mode>    safe | normal | yolo
  -v, --version        print the version
  -h, --help           show this help
`;

async function main(argv) {
  const opts = {};
  const words = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') return console.log(HELP);
    if (arg === '-v' || arg === '--version') return console.log(version);
    if (arg === '-a' || arg === '--agent') opts.agent = argv[++i];
    else if (arg === '-m' || arg === '--mode') opts.mode = argv[++i];
    else words.push(arg);
  }

  const shell = new Shell(opts);
  if (!words.length) return shell.start();

  process.on('SIGINT', () => shell.agent.cancel());
  const result = await shell.runAgent(shell.agent, words.join(' '));
  process.exitCode = result.ok ? 0 : 1;
}

main(process.argv.slice(2));
