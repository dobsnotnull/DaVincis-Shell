'use strict';

const { ClaudeAgent } = require('./claude');
const { CliAgent } = require('./cli');

function createAgent(name, cfg) {
  return cfg.type === 'claude' ? new ClaudeAgent(name, cfg) : new CliAgent(name, cfg);
}

function createAgents(config) {
  const agents = new Map();
  for (const [name, cfg] of Object.entries(config.agents)) agents.set(name, createAgent(name, cfg));
  return agents;
}

module.exports = { createAgent, createAgents };
