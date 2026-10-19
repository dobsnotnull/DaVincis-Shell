# ◆ DaVinci's Shell

A terminal where you type what you want and an AI agent does it: on your computer, in your files, and on GitHub.

```
◆ claude ~\Desktop ❯ move all the screenshots on my desktop into a Screenshots folder
  ↳ PowerShell Get-ChildItem -File "C:\Users\you\Desktop" -Filter "Screenshot*"
  ↳ PowerShell New-Item -ItemType Directory Screenshots; Move-Item Screenshot* Screenshots
Moved 14 screenshots into Desktop\Screenshots.

  ✓ claude · 9.2s
```

Claude is the default agent. You can also link **Codex**, **Gemini**, a local **Ollama** model, or any other command-line agent, and switch between them with one command.

## Install

You need [Node.js 18+](https://nodejs.org) and at least one agent. For Claude, install [Claude Code](https://claude.com/claude-code) and sign in once. DaVinci finds it on your PATH or inside the VS Code / Cursor extension and uses that login, so no API key is needed.

```sh
git clone https://github.com/dobsnotnull/DaVincis-Shell.git
cd DaVincis-Shell
npm link        # puts the `davinci` command on your PATH
davinci
```

For GitHub tasks, install the [GitHub CLI](https://cli.github.com) and run `gh auth login`. DaVinci tells the agent that `gh` is available.

## Using it

Type a plain request and press Enter:

```
open spotify
what's taking up the most space in my Downloads folder?
create a private repo called recipe-box with a README and push it
summarize the open issues on dobsnotnull/task-ops
```

Lines starting with `!` run straight in your shell (PowerShell on Windows), with no agent involved:

```
!git status
```

You can also run a single request without opening the shell:

```sh
davinci "rename every .jpeg on my desktop to .jpg"
davinci -a codex "write a fizzbuzz in rust"
```

## Commands

| Command | What it does |
| --- | --- |
| `/agents` | list agents and which ones are linked |
| `/agent <name>` | switch agents (alias `/use`) |
| `/ask <agent> <request>` | send one request to another agent without switching |
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
| `/history`, `/config`, `/clear`, `/exit` | the usual |

Press Tab to complete commands and agent names. **Ctrl+C** stops a running agent.

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

## Configuration

Settings are stored in `~/.davinci/config.json` (`/config` opens it). Agents are defined like this:

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
  }
}
```

- **`claude`** agents run Claude Code in streaming mode. DaVinci shows each tool call as it happens and keeps one Claude session per shell, so follow-up requests remember the earlier ones.
- **`cli`** agents can be any command. The prompt is sent on stdin, or in place of `{prompt}` if one of the args contains it. `{mode}` is replaced by that mode's flags. DaVinci passes the last few exchanges back to the agent each turn so it has context.

## How it works

```
you ─▶ DaVinci's Shell ─┬─▶ /commands, !shell   (handled locally)
                        └─▶ active agent ─▶ your machine + gh
                             claude · codex · gemini · ollama · …
```

Every request includes a short system note with your OS, home folder, Desktop, current folder, and whether `gh` is available. The note also tells the agent to ask before doing anything destructive.

## Development

```sh
npm test
npm start
```

There are no dependencies; the project uses only the Node standard library.

## License

[MIT](LICENSE)
