# CodeReviewer AI

An AI-powered VS Code extension that acts as your senior tech lead - analyzing code, identifying issues, generating tasks, and scheduling work automatically.

## CLI (agent-review)

This repo also ships a production CLI for local use and CI. The VS Code extension and the CLI share the same core review engine (`src/core`) and output schema.

### Install / Run

```bash
npm install
npm run build

# Run from this repo (after build):
node dist/cli.js --help
```

## Installation

1. Install from VS Code Marketplace (coming soon)
2. Or install from VSIX:
   ```bash
   npm install
   npm run package
   code --install-extension code-reviewer-ai-1.0.0.vsix
   ```

## Configuration

Open Settings and search for "CodeReviewer" to configure:

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
cd CodeReviewer

# Install dependencies
npm install

# Build extension + CLI
npm run build

# Run extension in development
Press F5 in VS Code
```