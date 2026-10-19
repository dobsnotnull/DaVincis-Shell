'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { IS_WIN } = require('./util');

const PROFILE_GUID = '{6d1a7c2e-5f0b-4b8e-9a2d-da7c1e5e11a0}';

// A warm, parchment-on-umber scheme to match the shell's gold and clay accents.
const SCHEME = {
  name: 'DaVinci',
  background: '#1A1714',
  foreground: '#EDE3D1',
  cursorColor: '#D4A84B',
  selectionBackground: '#3A3229',
  black: '#1A1714',
  red: '#D9615B',
  green: '#8BBF7A',
  yellow: '#D4A84B',
  blue: '#7EA3C9',
  purple: '#C38FBF',
  cyan: '#7BBFB5',
  white: '#DCD3C4',
  brightBlack: '#6B645A',
  brightRed: '#E8857F',
  brightGreen: '#A8D497',
  brightYellow: '#E8C474',
  brightBlue: '#A3C0DE',
  brightPurple: '#D8AED5',
  brightCyan: '#9DD4CB',
  brightWhite: '#FFF8EB',
};

function fontInstalled(prefix) {
  const dirs = [path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts')];
  if (process.env.LOCALAPPDATA) dirs.push(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Windows', 'Fonts'));
  return dirs.some((d) => {
    try {
      return fs.readdirSync(d).some((f) => f.toLowerCase().startsWith(prefix));
    } catch {
      return false;
    }
  });
}

// Install a Windows Terminal "fragment": a profile + colour scheme that Windows
// Terminal picks up on its next launch, without touching the user's settings.json.
function setupWindowsTerminal() {
  if (!IS_WIN || !process.env.LOCALAPPDATA) {
    return { ok: false, message: 'Terminal setup is Windows-only for now — set your terminal font to a monospace font like JetBrains Mono.' };
  }
  // Cascadia Code ships inside Windows Terminal, so it's a safe fallback.
  const font = fontInstalled('jetbrainsmono') ? 'JetBrains Mono' : 'Cascadia Code';
  const script = path.resolve(__dirname, '..', 'bin', 'davinci.js');
  const fragment = {
    profiles: [
      {
        guid: PROFILE_GUID,
        name: "DaVinci's Shell",
        commandline: `"${process.execPath}" "${script}"`,
        startingDirectory: os.homedir(),
        icon: '🎨',
        colorScheme: SCHEME.name,
        font: { face: font, size: 6, weight: 'normal' }, // 50% of the usual 12pt
        cursorShape: 'bar',
        padding: '14, 12',
        // see-through, blurred background, like VS Code's Vibrancy extension
        opacity: 60,
        useAcrylic: true,
        unfocusedAppearance: { opacity: 60 },
        tabColor: '#D4A84B',
      },
    ],
    schemes: [SCHEME],
  };
  const dir = path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Windows Terminal', 'Fragments', 'DaVincis-Shell');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'davinci.json');
  fs.writeFileSync(file, JSON.stringify(fragment, null, 2) + '\n');
  return {
    ok: true,
    font,
    file,
    message: `Added a "DaVinci's Shell" profile to Windows Terminal (font: ${font}). Restart Windows Terminal and pick it from the ▾ menu.`,
  };
}

module.exports = { setupWindowsTerminal, SCHEME };
