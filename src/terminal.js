'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { IS_WIN, which } = require('./util');

const IS_MAC = process.platform === 'darwin';
const PROFILE_GUID = '{6d1a7c2e-5f0b-4b8e-9a2d-da7c1e5e11a0}';
const PROFILE_NAME = "DaVinci's Shell";
const FONT_SIZE = 6; // 50% of the usual 12pt
const OPACITY = 0.6; // see-through, blurred background, like VS Code's Vibrancy extension

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

const ANSI = ['black', 'red', 'green', 'yellow', 'blue', 'purple', 'cyan', 'white'];
const BRIGHT = ANSI.map((n) => 'bright' + n[0].toUpperCase() + n.slice(1));
const PALETTE16 = [...ANSI, ...BRIGHT].map((n) => SCHEME[n]);

const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

function fontDirs() {
  const home = os.homedir();
  if (IS_WIN) {
    const dirs = [path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts')];
    if (process.env.LOCALAPPDATA) dirs.push(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Windows', 'Fonts'));
    return dirs;
  }
  if (IS_MAC) return [path.join(home, 'Library', 'Fonts'), '/Library/Fonts', '/System/Library/Fonts'];
  return [path.join(home, '.local', 'share', 'fonts'), path.join(home, '.fonts'), '/usr/share/fonts', '/usr/local/share/fonts'];
}

function fontInstalled(prefix) {
  if (!IS_WIN && !IS_MAC && which('fc-list')) {
    const r = spawnSync('fc-list', [':', 'family'], { encoding: 'utf8' });
    if (r.status === 0) return r.stdout.toLowerCase().replace(/\s/g, '').includes(prefix);
  }
  const has = (dir, depth) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    return entries.some((e) =>
      e.isDirectory() ? depth > 0 && has(path.join(dir, e.name), depth - 1) : e.name.toLowerCase().startsWith(prefix),
    );
  };
  return fontDirs().some((d) => has(d, 2));
}

// JetBrains Mono if it's there, otherwise a monospace font every machine of that kind has.
function pickFont() {
  if (fontInstalled('jetbrainsmono')) return { face: 'JetBrains Mono', postscript: 'JetBrainsMono-Regular' };
  if (IS_WIN) return { face: 'Cascadia Code' }; // ships inside Windows Terminal
  if (IS_MAC) return { face: 'Menlo', postscript: 'Menlo-Regular' };
  return { face: 'DejaVu Sans Mono' };
}

function launch() {
  return [process.execPath, path.resolve(__dirname, '..', 'bin', 'davinci.js')];
}

const quote = (s) => `"${s.replace(/(["\\$`])/g, '\\$1')}"`;

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}

// --- one builder per terminal: each returns the file contents it needs ---

function windowsTerminalFragment(font) {
  const [node, script] = launch();
  return {
    profiles: [
      {
        guid: PROFILE_GUID,
        name: PROFILE_NAME,
        commandline: `"${node}" "${script}"`,
        startingDirectory: os.homedir(),
        icon: '🎨',
        colorScheme: SCHEME.name,
        font: { face: font.face, size: FONT_SIZE, weight: 'normal' },
        cursorShape: 'bar',
        padding: '14, 12',
        opacity: Math.round(OPACITY * 100),
        useAcrylic: true,
        unfocusedAppearance: { opacity: Math.round(OPACITY * 100) },
        tabColor: '#D4A84B',
      },
    ],
    schemes: [SCHEME],
  };
}

function itermProfile(font) {
  const color = (hex) => {
    const [r, g, b] = rgb(hex);
    return { 'Red Component': r / 255, 'Green Component': g / 255, 'Blue Component': b / 255, 'Color Space': 'sRGB' };
  };
  const profile = {
    Name: PROFILE_NAME,
    Guid: 'davincis-shell',
    'Custom Command': 'Yes',
    Command: launch().map(quote).join(' '),
    'Normal Font': `${font.postscript || font.face} ${FONT_SIZE}`,
    'Cursor Type': 1, // vertical bar
    Transparency: 1 - OPACITY,
    Blur: true,
    'Blur Radius': 20,
    'Background Color': color(SCHEME.background),
    'Foreground Color': color(SCHEME.foreground),
    'Cursor Color': color(SCHEME.cursorColor),
    'Selection Color': color(SCHEME.selectionBackground),
    'Tab Color': color('#D4A84B'),
    'Use Tab Color': true,
  };
  PALETTE16.forEach((hex, i) => (profile[`Ansi ${i} Color`] = color(hex)));
  return { Profiles: [profile] };
}

function kittyConf(font) {
  return [
    `# ${PROFILE_NAME}: kitty --config ~/.config/kitty/davinci.conf`,
    `font_family ${font.face}`,
    `font_size ${FONT_SIZE}`,
    'cursor_shape beam',
    'window_padding_width 12',
    `background_opacity ${OPACITY}`,
    'background_blur 20',
    `foreground ${SCHEME.foreground}`,
    `background ${SCHEME.background}`,
    `cursor ${SCHEME.cursorColor}`,
    `selection_background ${SCHEME.selectionBackground}`,
    ...PALETTE16.map((hex, i) => `color${i} ${hex}`),
    `shell ${launch().map(quote).join(' ')}`,
    '',
  ].join('\n');
}

function alacrittyToml(font) {
  const [node, script] = launch();
  const names = ANSI.map((n) => (n === 'purple' ? 'magenta' : n));
  const block = (title, keys) => [`[${title}]`, ...names.map((n, i) => `${n} = "${keys[i]}"`), ''];
  return [
    `# ${PROFILE_NAME}: alacritty --config-file ~/.config/alacritty/davinci.toml`,
    '[window]',
    `opacity = ${OPACITY}`,
    'blur = true',
    'padding = { x = 14, y = 12 }',
    '',
    '[font]',
    `size = ${FONT_SIZE}`,
    `normal = { family = "${font.face}" }`,
    '',
    '[cursor.style]',
    'shape = "Beam"',
    '',
    '[terminal.shell]',
    `program = ${JSON.stringify(node)}`,
    `args = [${JSON.stringify(script)}]`,
    '',
    '[colors.primary]',
    `background = "${SCHEME.background}"`,
    `foreground = "${SCHEME.foreground}"`,
    '',
    '[colors.cursor]',
    `cursor = "${SCHEME.cursorColor}"`,
    '',
    '[colors.selection]',
    `background = "${SCHEME.selectionBackground}"`,
    '',
    ...block('colors.normal', PALETTE16.slice(0, 8)),
    ...block('colors.bright', PALETTE16.slice(8)),
  ].join('\n');
}

function konsoleFiles(font) {
  const c = (hex) => rgb(hex).join(',');
  const scheme = [
    '[General]',
    `Description=${SCHEME.name}`,
    `Opacity=${OPACITY}`,
    'Blur=true',
    '',
    '[Background]', `Color=${c(SCHEME.background)}`, '',
    '[BackgroundIntense]', `Color=${c(SCHEME.background)}`, '',
    '[Foreground]', `Color=${c(SCHEME.foreground)}`, '',
    '[ForegroundIntense]', `Color=${c(SCHEME.brightWhite)}`, '',
    ...ANSI.flatMap((_, i) => [
      `[Color${i}]`, `Color=${c(PALETTE16[i])}`, '',
      `[Color${i}Intense]`, `Color=${c(PALETTE16[i + 8])}`, '',
    ]),
  ].join('\n');
  const profile = [
    '[Appearance]',
    `ColorScheme=${SCHEME.name}`,
    `Font=${font.face},${FONT_SIZE},-1,5,50,0,0,0,0,0`,
    '',
    '[Cursor Options]',
    'CursorShape=1',
    '',
    '[General]',
    `Command=${launch().map(quote).join(' ')}`,
    `Name=${PROFILE_NAME}`,
    'Parent=FALLBACK/',
    '',
  ].join('\n');
  return { scheme, profile };
}

function gnomeKeyfile(font) {
  const s = (v) => `'${String(v).replace(/'/g, "\\'")}'`;
  return [
    '[/]',
    `visible-name=${s(PROFILE_NAME)}`,
    'use-theme-colors=false',
    `background-color=${s(SCHEME.background)}`,
    `foreground-color=${s(SCHEME.foreground)}`,
    `palette=[${PALETTE16.map(s).join(', ')}]`,
    'use-transparent-background=true',
    `background-transparency-percent=${Math.round((1 - OPACITY) * 100)}`,
    'use-system-font=false',
    `font=${s(`${font.face} ${FONT_SIZE}`)}`,
    "cursor-shape='ibeam'",
    'use-custom-command=true',
    `custom-command=${s(launch().map(quote).join(' '))}`,
    '',
  ].join('\n');
}

// --- installers: each sets up one terminal it finds on this machine ---

const GNOME_UUID = '6d1a7c2e-5f0b-4b8e-9a2d-da7c1e5e11a0';
const GNOME_ROOT = '/org/gnome/terminal/legacy/profiles:/';

const TERMINALS = [
  {
    name: 'Windows Terminal',
    found: () => IS_WIN && Boolean(process.env.LOCALAPPDATA),
    install(font) {
      // a "fragment" is picked up on the next launch without touching the user's settings.json
      const dir = path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Windows Terminal', 'Fragments', 'DaVincis-Shell');
      write(path.join(dir, 'davinci.json'), JSON.stringify(windowsTerminalFragment(font), null, 2) + '\n');
      return 'restart Windows Terminal and pick it from the ▾ menu';
    },
  },
  {
    name: 'iTerm2',
    found: () => IS_MAC && (fs.existsSync('/Applications/iTerm.app') || fs.existsSync(path.join(os.homedir(), 'Library', 'Application Support', 'iTerm2'))),
    install(font) {
      // dynamic profiles are loaded live, alongside the user's own
      const dir = path.join(os.homedir(), 'Library', 'Application Support', 'iTerm2', 'DynamicProfiles');
      write(path.join(dir, 'davincis-shell.json'), JSON.stringify(itermProfile(font), null, 2) + '\n');
      return 'pick it under Profiles';
    },
  },
  {
    name: 'kitty',
    found: () => Boolean(which('kitty')) || (IS_MAC && fs.existsSync('/Applications/kitty.app')),
    install(font) {
      write(path.join(os.homedir(), '.config', 'kitty', 'davinci.conf'), kittyConf(font));
      return 'run: kitty --config ~/.config/kitty/davinci.conf';
    },
  },
  {
    name: 'Alacritty',
    found: () => Boolean(which('alacritty')) || (IS_MAC && fs.existsSync('/Applications/Alacritty.app')),
    install(font) {
      write(path.join(os.homedir(), '.config', 'alacritty', 'davinci.toml'), alacrittyToml(font));
      return 'run: alacritty --config-file ~/.config/alacritty/davinci.toml';
    },
  },
  {
    name: 'Konsole',
    found: () => !IS_WIN && Boolean(which('konsole')),
    install(font) {
      const dir = path.join(os.homedir(), '.local', 'share', 'konsole');
      const { scheme, profile } = konsoleFiles(font);
      write(path.join(dir, `${SCHEME.name}.colorscheme`), scheme);
      write(path.join(dir, 'DaVinci.profile'), profile);
      return 'run: konsole --profile DaVinci';
    },
  },
  {
    name: 'GNOME Terminal',
    found: () => !IS_WIN && !IS_MAC && Boolean(which('gnome-terminal') && which('dconf')),
    install(font) {
      const load = spawnSync('dconf', ['load', `${GNOME_ROOT}:${GNOME_UUID}/`], { input: gnomeKeyfile(font), encoding: 'utf8' });
      if (load.status !== 0) throw new Error((load.stderr || 'dconf load failed').trim());
      const list = spawnSync('dconf', ['read', `${GNOME_ROOT}list`], { encoding: 'utf8' }).stdout || '';
      const ids = list.match(/[0-9a-f-]{36}/g) || [];
      if (!ids.includes(GNOME_UUID)) {
        ids.push(GNOME_UUID);
        spawnSync('dconf', ['write', `${GNOME_ROOT}list`, `[${ids.map((id) => `'${id}'`).join(', ')}]`]);
      }
      return 'pick it from the ▾ menu (GNOME Terminal is see-through but not blurred)';
    },
  },
];

// Add a themed "DaVinci's Shell" profile to every supported terminal on this machine,
// without changing the user's own profiles or config files.
function setupTerminal() {
  const font = pickFont();
  const done = [];
  const failed = [];
  for (const t of TERMINALS.filter((t) => t.found())) {
    try {
      done.push(`${t.name}: ${t.install(font)}`);
    } catch (err) {
      failed.push(`${t.name}: ${err.message}`);
    }
  }
  if (!done.length) {
    return {
      ok: false,
      message:
        `No supported terminal found (Windows Terminal, iTerm2, kitty, Alacritty, Konsole, GNOME Terminal)${failed.length ? ' — ' + failed.join('; ') : ''}. ` +
        `Set your terminal font to ${font.face} ${FONT_SIZE}pt and its opacity to ${Math.round(OPACITY * 100)}%.`,
    };
  }
  return {
    ok: true,
    font: font.face,
    message: [`Added a "${PROFILE_NAME}" profile (font: ${font.face} ${FONT_SIZE}pt):`, ...done, ...failed.map((f) => `failed — ${f}`)].join('\n  '),
  };
}

module.exports = {
  setupTerminal, SCHEME, windowsTerminalFragment, itermProfile, kittyConf, alacrittyToml, konsoleFiles, gnomeKeyfile,
};
