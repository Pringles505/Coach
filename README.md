![Coach Logo Dark](CoachLogoDark.png#gh-dark-mode-only)
![Coach Logo Light](CoachLogoLight.png#gh-light-mode-only)

An AI-powered VS Code extension that acts as your senior tech lead - analyzing code, identifying issues, generating tasks, and scheduling work automatically.

## CLI (`coach`)

This repo also ships a production CLI for local use and CI. The VS Code extension and the CLI share the same core review engine (`src/core`) and output schema.

### Install from npm

```bash
# Global install (recommended for regular use)
npm install -g @mascaro101/coach
coach --help

# Or run without installing
npx @mascaro101/coach --help

# Or add to your project as a dev dependency
npm install --save-dev @mascaro101/coach
npx coach review ./src
```

### Install from source

```bash
git clone https://github.com/mascaro101/coach.git
cd coach
npm install
npm run build
node dist/cli.js --help
```

### Quick Start

```bash
# Initialize config in your project
coach config init

# Start interactive shell
coach

# Or run a one-off review
coach review ./src --format pretty
```

> **Security note:** The `.coachrc.json` file may contain your API key. It is automatically added to `.gitignore`, but verify it is not committed to version control.

### Commands

| Command | What it does |
|---------|--------------|
| `coach` | Starts the interactive shell (when run in a TTY with no args). |
| `coach shell` | Starts the interactive shell (run multiple commands in one session). |
| `coach config` | Configuration helpers (see `coach config init`). |
| `coach config init` | Creates a default `.coachrc.json` in the current directory (`--force` overwrites; `--from-vscode` seeds from VS Code `codeReviewer.*` settings). |
| `coach config help [command]` | Shows help for `config` subcommands. |
| `coach summarize [path]` | Summarizes a file or workspace (default output: Markdown; supports `--format md|json` and `--output <file>`). |
| `coach review [path]` | Runs a code review (supports `--changed` / `--since <ref>`, `--format pretty|json|sarif|md`, `--fail-on none|info|warning|error`, and `--output <file>`). |
| `coach help [command]` | Shows help for a command. |

### Shell built-ins

Inside `coach` / `coach shell`, these built-ins are available in addition to normal CLI commands:

| Command | What it does |
|---------|--------------|
| `help` | Prints shell help. |
| `cd <path>` | Changes the current working directory for the shell session. |
| `pwd` | Prints the current working directory. |
| `exit` | Exits the shell (also: `quit`, `.exit`, `:q`). |

## Installation

1. Install from VS Code Marketplace (coming soon)
2. Or install from VSIX:
   ```bash
   npm install
   npm run package
   # Install the generated .vsix (name depends on package metadata)
   code --install-extension *.vsix
   ```

## Configuration

Open Settings and search for "Coach" to configure:

| Setting | Description |
|---------|-------------|
| AI Provider | Choose: Anthropic, OpenAI, Azure, Ollama, or Custom |
| API Key | Your API key for the selected provider |
| Model | Specific model to use |
| Analysis Depth | Light, Moderate, or Deep analysis |
| Auto Analyze | Enable/disable auto-analysis on save |
| Work Hours | Configure your work schedule |

## Usage

### Commands

| Command | Description |
|---------|-------------|
| Analyze Current File | Run AI analysis on the active file |
| Analyze Workspace | Analyze the entire project |
| Summarize This File | Generate a file summary |
| Generate Refactor Plan | Create a refactoring plan |
| Generate Tests | Generate tests for selected code |
| Schedule Fixes | Convert issues to scheduled tasks |
| Open Calendar | View the task calendar |
| Open Dashboard | View the code health dashboard |

## Development

```bash
# Clone the repository
git clone <repo-url>
cd coach

# Install dependencies
npm install

# Build extension + CLI
npm run build

# Run extension in development
Press F5 in VS Code
```
