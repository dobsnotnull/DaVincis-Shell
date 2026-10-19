# ◆ DaVinci's Shell

A terminal where you type what you want and an AI agent does it: on your computer, in your files, and on GitHub.

```
ｹ3 ｾ ﾗ6=+ﾒｹ  ｹ  ｼ ｿ   ﾃ7  ﾇ   9 ﾋ       ﾋﾋ          9   <ﾁ0=  ｱ ﾂ
ﾔｶ ｳﾇﾜｳﾘﾎ ﾚ >8  ﾆﾍ0 ﾙ  ﾔｾ ﾋ  >ﾖ ﾑ  1     ﾍ          2 ﾑ ﾁ8*:   ﾄ
 ﾆ ﾔﾍ91 ｵ   ﾊ   ﾓﾖｹ ｿ  ﾋ1 ﾃ  *       3   ｽ+  =ﾉ ﾓ ｲｾﾑ ﾕ ﾁﾑ4  ｦ8
    ﾌﾙ= +       ｵ+ﾏ ﾃﾊ ｾﾐ ﾐ  ﾋ      ﾄｽ   6ﾚﾓ <ﾛ ﾆ ﾐｵﾚ8  ﾙﾏ   ﾜ  =

  DaVinci's Shell  v0.3.0  type what you want — your agents do it
  claude · normal · ~Desktop   agents claude · codex

◆ claude ~Desktop ❯ move all the screenshots on my desktop into a Screenshots folder

  ↳ PowerShell Get-ChildItem -File "C:UsersyouDesktop" -Filter "Screenshot*"
  ↳ PowerShell New-Item -ItemType Directory Screenshots; Move-Item Screenshot* Screenshots
 Mixing pigments..  (3s · esc to stop · type to queue)
  ⧗ queued  @codex write a README for the Screenshots folder
  ❯ |
```
```

Claude is the default agent. DaVinci's Shell isn't tied to one AI, though: you can link **Codex**, **Gemini**, a local **Ollama** model, or any other command-line agent, and switch between them with `/agent <name>`.

- [Setup guide](#setup-guide)
- [Using it](#using-it)
- [Commands](#commands)
- [Architecture](#architecture)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)

---

## Setup guide

### 1. Install Node.js

You need **Node.js 18 or newer**. Download it from [nodejs.org](https://nodejs.org), then check the version:

```sh
node --version
```

### 2. Install at least one agent

DaVinci's Shell doesn't contain an AI itself. It drives agents that are already installed on your machine. Pick one or more:

| Agent | Install | Sign in |
| --- | --- | --- |
| **Claude** (default) | [Claude Code](https://claude.com/claude-code): `npm install -g @anthropic-ai/claude-code`, or the VS Code extension | run `claude` once and log in |
| **Codex** | `npm install -g @openai/codex` | run `codex` once and log in |
| **Gemini** | `npm install -g @google/gemini-cli` | run `gemini` once and log in |
| **Ollama** (local, free) | [ollama.com](https://ollama.com), then `ollama pull llama3.2` | none |

DaVinci finds Claude Code on your PATH, in `~/.local/bin`, or bundled inside the VS Code, Cursor or Windsurf extension. It uses your existing Claude login, so you don't need an API key.

### 3. (Optional) Install the GitHub CLI

GitHub tasks need the [GitHub CLI](https://cli.github.com). Install it, then sign in:

```sh
gh auth login
```

DaVinci tells the agent that `gh` is available. The `/repos`, `/issues` and `/prs` commands also use it.

### 4. Install DaVinci's Shell

```sh
git clone https://github.com/dobsnotnull/DaVincis-Shell.git
cd DaVincis-Shell
npm link
```

`npm link` puts a `davinci` command on your PATH. Nothing else is downloaded because the project has no dependencies.

### 5. Run it

```sh
davinci
```

The banner lists the agents it found. Type `/agents` to see their status, then type a request in plain language.

### 6. (Optional) Make the terminal look the part

```sh
davinci --setup-terminal
```

On Windows, this adds a **DaVinci's Shell** profile to Windows Terminal. The profile has a warm "DaVinci" colour scheme, a bar cursor, a small 6pt font, a see-through blurred (acrylic) background like VS Code's Vibrancy extension, and the [JetBrains Mono](https://www.jetbrains.com/lp/mono/) font if it's installed (otherwise Cascadia Code). Restart Windows Terminal and pick the profile from the ▾ menu. Your existing `settings.json` isn't changed, because the profile is installed as a separate fragment.

To use the font in VS Code's terminal, add this to your settings:

```json
"terminal.integrated.fontFamily": "'JetBrains Mono', Consolas, monospace"
```

## The look

- **Hyperspace**: stars streak out from the centre across the full width of the top of the screen when DaVinci starts, a few rows tall. It stops as soon as you start typing.
- **The thinking line** shows a shimmering verb while the agent works, such as *Ruminating*, *Percolating*, or one of Leonardo's: *Mixing pigments*, *Mirror-writing*, *Designing flying machines*. Dots fill in after it (`.`, `..`, `...`) as a loading animation, and it shows the elapsed time.
- **Each agent has its own colour.** Claude is clay, Codex is green, Gemini is blue, and linked agents are gold. The colour appears in the prompt, the reply bullets and the tool lines.
- Colours are 24-bit where the terminal supports them, with a 256-colour fallback. `NO_COLOR` turns colour off.

---

## Using it

Type a request and press Enter:

```
open spotify
what's taking up the most space in my Downloads folder?
create a private repo called recipe-box with a README and push it
summarize the open issues on dobsnotnull/task-ops
```

Follow-up requests continue the same conversation. Use `/new` to start over.

### While an agent works

The prompt stays open, like the chat panel in VS Code:

- **Keep typing.** Each message you send is queued and shown under the thinking line (`⧗ queued …`). They run in order once the agent finishes.
- `/queue` lists what's waiting, `/queue undo` drops the last one, `/queue clear` drops them all. These run straight away instead of being queued.
- **Esc** (or **Ctrl+C**, or `/stop`) stops the running agent. Anything queued still runs afterwards.
- Questions and permission checks from the agent appear in the same place; type the answer and press Enter.
- When Claude hands work to its own subagents, their tool calls show up indented under the `Agent` call.

### Talking to other agents

Start a message with `@<agent>` to send it to another linked agent without switching, the same as `/ask`:

```
@codex write a fizzbuzz in rust
@gemini summarize this folder
```

Tab completes agent names after `@`. You can queue messages for different agents while one is working.

Lines starting with `!` run straight in your shell (PowerShell on Windows), with no agent involved:

```
!git status
```

You can also run a single request without opening the shell:

```sh
davinci "rename every .jpeg on my desktop to .jpg"
davinci -a codex "write a fizzbuzz in rust"
davinci -m safe "what would it take to upgrade this project to React 19?"
```

## Commands

| Command | What it does |
| --- | --- |
| `/agents` | list agents and which ones are linked |
| `/agent <name>` | switch agents (alias `/use`) |
| `/ask <agent> <request>`, `@<agent> <request>` | send one request to another agent without switching |
| `/stop` | stop the running agent (also Esc or Ctrl+C) |
| `/queue [clear|undo]` | list, clear or trim messages queued while an agent works |
| `/link <name> <command> [args…]` | link any CLI agent, e.g. `/link llama ollama run llama3.2` |
| `/unlink <name>` | remove a linked agent |
| `/mode [safe\|normal\|yolo]` | set how much the agent can do on its own |
| `/model [name\|default]` | change the model (Claude: `opus`, `sonnet`, …) |
| `/new` | start a fresh conversation |
| `/status` | show the agent, mode, folder, session and spend |
| `/cd`, `/desktop`, `/home`, `/pwd`, `/ls` | move around; agents work in the current folder |
| `/open <file\|folder\|url\|app>` | open something with its default app |
| `/repos`, `/issues`, `/prs`, `/web` | quick GitHub views (no agent, instant) |
| `/gh <args…>` | run any `gh` command |
| `/macros`, `/macro add <name> <text>` | list or create your own `/commands` |
| `/terminal` | add the themed Windows Terminal profile |
| `/history`, `/config`, `/clear`, `/exit` | the usual |

Press Tab to complete commands and agent names. **Esc** or **Ctrl+C** stops a running agent; pressing Ctrl+C twice at an empty prompt quits.

### Modes

| Mode | Claude | Codex | Gemini |
| --- | --- | --- | --- |
| `safe`: look and plan only | `plan` | `--sandbox read-only` | default approvals |
| `normal` (default): acts, with risky steps checked first | `auto` | `--full-auto` | `--approval-mode auto_edit` |
| `yolo`: no checks | `--dangerously-skip-permissions` | `--dangerously-bypass-approvals-and-sandbox` | `--yolo` |

### Macros

A macro is a saved request that runs as a `/command`. Several come built in:

- `/commit`
- `/tidy`
- `/standup [days]`
- `/newrepo <name>`
- `/explain <thing>`
- `/fix <problem>`

To add your own:

```
/macro add deploy run the tests, and if they pass, push to main and tell me the commit hash {args}
/deploy
```

Macros can use these placeholders: `{args}`, `{args|fallback}`, `{cwd}`, `{desktop}`, `{home}`.

---

## Architecture

DaVinci's Shell is a thin layer that **routes** what you type. It doesn't do the thinking itself; each request goes to the active agent, and the agent's tools act on your machine.

```
you type a line
      │
      ▼
DaVinci's Shell (readline prompt → parseInput)
      │
      ├── /command ────▶ handled locally (commands.js)
      ├── !cmd ────────▶ runs in PowerShell / sh
      ├── @agent ──────▶ that agent, once ─────────┐
      ├── /macro ──────▶ expanded into a request ──┤
      └── plain text ──────────────────────────────┤
                                                   ▼
                                  active (or @mentioned) agent adapter
                    ┌──────────────────────────────┴───────────────────────────┐
                    ▼                                                          ▼
          claude adapter                                              cli adapter
          claude -p --output-format stream-json                       codex · gemini · ollama
          --resume <session> --permission-mode <mode>                 · any command
                    │                                                          │
                    └──────────────────────────────┬───────────────────────────┘
                                                   ▼
                         the agent's own tools (shell, file edits, gh, web …)
                                                   ▼
                               your desktop · your files · GitHub
```

### Project layout

```
bin/davinci.js        entry point: argument parsing, one-shot mode
src/shell.js          the REPL: prompt, input queue, Ctrl+C handling, system note
src/commands.js       every /command
src/agents/claude.js  Claude Code adapter (streaming JSON, sessions, permissions)
src/agents/cli.js     generic adapter for any command-line agent
src/agents/index.js   builds agent instances from the config
src/config.js         ~/.davinci/config.json, defaults, history
src/ui.js             colours, hyperspace banner, thinking line, markdown rendering
src/live.js           the live region while an agent works: thinking line, queue, open prompt
src/terminal.js       Windows Terminal profile + colour scheme (--setup-terminal)
src/util.js           PATH lookup, process spawning, arg parsing, templates
test/                 unit tests (node --test)
```

### What happens when you press Enter

1. **Queue.** The line goes into a queue. While an agent works the prompt stays live, so anything you type is queued (and shown) and runs afterwards.
2. **Parse.** `parseInput()` sorts the line into one of four kinds: a `/command`, a `!shell` line, a macro, or a plain request.
3. **Context.** For agent requests, the shell builds a short **system note**: your OS, home folder, Desktop, current folder, whether `gh` is available, and an instruction to ask before doing anything destructive.
4. **Dispatch.** The adapter starts the agent as a child process in your current folder. The prompt is always sent on **stdin**, so the shell never interprets the text of a request.
5. **Stream.** Output appears as it arrives. The Claude adapter reads Claude Code's `stream-json` events and shows each tool call (`↳ PowerShell …`) with a short result line, errors, the reply, and the time. When Claude needs a permission, a plan approval, or asks you a question, it appears right in the shell for you to answer. Cost is only shown with an API key; on a Claude Pro/Max login usage comes out of your plan.
6. **Remember.** Claude's session ID is kept, so the next request continues the same session with `--resume`. Generic agents get their last few exchanges passed back to them.

### Agent adapters

| | `claude` adapter | `cli` adapter |
| --- | --- | --- |
| Talks to | Claude Code (`claude -p`) | any command (Codex, Gemini, Ollama, scripts…) |
| Output | structured `stream-json` events | raw stdout and stderr |
| Memory | native sessions (`--resume`) | DaVinci re-sends the last 6 exchanges |
| Permissions | Claude Code permission modes | per-mode flags from the config |
| Auth | your Claude login | whatever the tool uses |

Adding a new kind of agent means writing a class with `isLinked()`, `run()`, `reset()` and `cancel()` and registering it in `src/agents/index.js`.

### Built with

- **Node.js** standard library only (`readline`, `child_process`, `fs`), with **no npm dependencies**
- **Claude Code** in headless mode as the default agent
- **GitHub CLI** for GitHub features
- **PowerShell** on Windows, `sh` on macOS and Linux
- `node:test` for tests

---

## Configuration

Settings are stored in `~/.davinci/config.json` (`/config` opens it). The file is created the first time you run DaVinci. Set `DAVINCI_HOME` to keep it somewhere else.

```json
{
  "defaultAgent": "claude",
  "mode": "normal",
  "agents": {
    "claude": { "type": "claude", "command": null, "model": "opus" },
    "llama":  { "type": "cli", "command": "ollama", "args": ["run", "llama3.2"] },
    "codex":  {
      "type": "cli",
      "command": "codex",
      "args": ["exec", "--skip-git-repo-check", "{mode}", "-"],
      "modes": { "safe": ["--sandbox", "read-only"], "normal": ["--full-auto"], "yolo": [] }
    }
  },
  "macros": {
    "deploy": "run the tests, and if they pass, push to main {args}"
  }
}
```

- `command: null` means auto-detect. To pin a binary, set it to a full path.
- In `cli` agents, `{mode}` is replaced by that mode's flags. `{prompt}` puts the prompt in an argument instead of sending it on stdin.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `no agents found` | Install Claude Code (or another agent) and sign in once, or set `agents.claude.command` to the full path of `claude` |
| `blocked: Bash …` after a request | `normal` mode stopped an action. Approve the action in your Claude settings, or use `/mode yolo` if you trust the request |
| `davinci` not found after `npm link` | Make sure npm's global bin folder is on your PATH (`npm prefix -g`) |
| GitHub requests fail | Run `gh auth status`, then `gh auth login` if needed |
| PowerShell blocks `davinci.ps1` | Run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, or use `davinci.cmd` |

## Development

```sh
npm test     # unit tests
npm start    # run from the repo without npm link
```

## License

[MIT](LICENSE)
