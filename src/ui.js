'use strict';

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;

const wrap = (open, close) => (s) => (useColor ? `\x1b[${open}m${s}\x1b[${close}m` : String(s));

const c = {
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  italic: wrap(3, 23),
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  blue: wrap(34, 39),
  magenta: wrap(35, 39),
  cyan: wrap(36, 39),
  gray: wrap(90, 39),
  gold: wrap('38;5;178', 39),
};

// Just enough markdown to make agent replies readable in a terminal.
function renderMarkdown(text) {
  let inFence = false;
  return text
    .split(/\r?\n/)
    .map((line) => {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        return c.gray(line);
      }
      if (inFence) return c.cyan(line);
      const heading = line.match(/^#{1,6}\s+(.*)$/);
      if (heading) return c.bold(c.gold(heading[1]));
      return line
        .replace(/^(\s*)[-*]\s+/, '$1• ')
        .replace(/\*\*([^*]+)\*\*/g, (_, s) => c.bold(s))
        .replace(/`([^`]+)`/g, (_, s) => c.cyan(s));
    })
    .join('\n');
}

function banner(version) {
  const line = c.gold('─'.repeat(46));
  return [
    '',
    `  ${line}`,
    `   ${c.gold('◆')}  ${c.bold("DaVinci's Shell")}  ${c.gray('v' + version)}`,
    `      ${c.italic(c.gray('type what you want — your agents do it'))}`,
    `  ${line}`,
    '',
  ].join('\n');
}

module.exports = { c, renderMarkdown, banner };
