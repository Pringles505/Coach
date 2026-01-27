# CodeReviewer AI - Technical Architecture

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           VS Code Extension Host                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐          │
│  │   Dashboard     │    │   Calendar      │    │   Task Tree     │          │
│  │   WebView       │    │   WebView       │    │   Provider      │          │
│  └────────┬────────┘    └────────┬────────┘    └────────┬────────┘          │
│           │                      │                      │                    │
│           └──────────────────────┼──────────────────────┘                    │
│                                  │                                           │
│                    ┌─────────────▼─────────────┐                            │
│                    │     Extension Core        │                            │
│                    │  (Commands, Activation)   │                            │
│                    └─────────────┬─────────────┘                            │
│                                  │                                           │
│           ┌──────────────────────┼──────────────────────┐                    │
│           │                      │                      │                    │
│  ┌────────▼────────┐    ┌────────▼────────┐    ┌────────▼────────┐          │
│  │  Task Manager   │    │ Agent           │    │ Analysis Cache  │          │
│  │                 │◄───│ Orchestrator    │───►│                 │          │
│  └─────────────────┘    └────────┬────────┘    └─────────────────┘          │
│                                  │                                           │
│           ┌──────────────────────┼──────────────────────┐                    │
│           │           │          │          │           │                    │
│  ┌────────▼────┐ ┌────▼────┐ ┌───▼────┐ ┌───▼────┐ ┌───▼────┐              │
│  │   Code      │ │ Refactor│ │  Test  │ │  Task  │ │Schedule│              │
│  │  Analysis   │ │ Planning│ │ Gen    │ │Planning│ │  Agent │              │
│  │   Agent     │ │  Agent  │ │ Agent  │ │ Agent  │ │        │              │
│  └──────┬──────┘ └────┬────┘ └───┬────┘ └───┬────┘ └───┬────┘              │
│         │             │          │          │          │                     │
│         └─────────────┴──────────┴──────────┴──────────┘                     │
│                                  │                                           │
│                    ┌─────────────▼─────────────┐                            │
│                    │   AI Service Factory      │                            │
│                    │   (Model Abstraction)     │                            │
│                    └─────────────┬─────────────┘                            │
│                                  │                                           │
└──────────────────────────────────┼──────────────────────────────────────────┘
                                   │
            ┌──────────────────────┼──────────────────────┐
            │                      │                      │
   ┌────────▼────────┐    ┌────────▼────────┐    ┌───────▼────────┐
   │    Anthropic    │    │     OpenAI      │    │    Ollama      │
   │    Claude API   │    │     API         │    │    (Local)     │
   └─────────────────┘    └─────────────────┘    └────────────────┘
```

## Module Structure

```
src/
├── extension.ts              # Extension entry point & activation
├── types/
│   └── index.ts              # All TypeScript interfaces and types
├── agents/
│   ├── orchestrator.ts       # Coordinates multi-agent workflow
│   ├── codeAnalysisAgent.ts  # Analyzes code for issues
│   ├── refactorPlanningAgent.ts  # Creates refactoring plans
│   ├── testGenerationAgent.ts    # Generates tests
│   ├── taskPlanningAgent.ts      # Converts issues to tasks
│   ├── schedulingAgent.ts        # Schedules tasks
│   └── prompts.ts                # All agent prompt templates
├── ai/
│   └── aiServiceFactory.ts   # AI provider abstraction layer
├── config/
│   └── configManager.ts      # Configuration management
├── cache/
│   └── analysisCache.ts      # Analysis result caching
├── tasks/
│   └── taskManager.ts        # Task CRUD & lifecycle
├── views/
│   ├── dashboardProvider.ts  # Dashboard webview
│   ├── calendarProvider.ts   # Calendar webview
│   ├── taskTreeProvider.ts   # Task tree view
│   └── codeHealthProvider.ts # Code health tree view
├── annotations/
│   └── inlineAnnotations.ts  # Inline code decorations
└── resources/
    └── icon.svg              # Extension icon
```

## Data Flow

### 1. Code Analysis Flow

```
User Action (Analyze File)
         │
         ▼
┌─────────────────────┐
│  AgentOrchestrator  │
│  - Check cache      │
│  - Queue analysis   │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  CodeAnalysisAgent  │
│  - Compute metrics  │
│  - Call AI service  │
│  - Parse response   │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│   AnalysisCache     │
│   - Store result    │
│   - Notify views    │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  UI Updates         │
│  - Dashboard        │
│  - Code Health      │
│  - Inline Annot.    │
└─────────────────────┘
```

### 2. Task Creation Flow

```
Analysis Results
         │
         ▼
┌─────────────────────┐
│  TaskPlanningAgent  │
│  - Group issues     │
│  - Estimate effort  │
│  - Set priorities   │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  SchedulingAgent    │
│  - Find time slots  │
│  - Respect deps     │
│  - Create sessions  │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│    TaskManager      │
│    - Store tasks    │
│    - Emit events    │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  UI Updates         │
│  - Task Tree        │
│  - Calendar         │
│  - Dashboard        │
└─────────────────────┘
```

## Agent Responsibilities

### CodeAnalysisAgent
- **Input:** Source code, file metadata
- **Output:** FileAnalysis with issues, summary, metrics
- **Prompt Strategy:** Structured JSON output, severity-based categorization
- **Memory:** Results cached in AnalysisCache (24h TTL)

### RefactorPlanningAgent
- **Input:** Code + Issues from analysis
- **Output:** RefactorPlan with ordered steps
- **Prompt Strategy:** Step-by-step actions with rationale
- **Memory:** Stateless (on-demand generation)

### TestGenerationAgent
- **Input:** Selected code + file context
- **Output:** TestSuite with unit/integration/edge tests
- **Prompt Strategy:** Framework-aware, convention-matching
- **Memory:** Stateless (on-demand generation)

### TaskPlanningAgent
- **Input:** FileAnalysis
- **Output:** Task[] with metadata
- **Prompt Strategy:** Issue-to-task mapping, dependency detection
- **Memory:** Stateless (derives from analysis)

### SchedulingAgent
- **Input:** Task[], UserPreferences
- **Output:** Scheduled Task[] with time slots
- **Prompt Strategy:** Pure algorithmic (no AI needed)
- **Memory:** Stateless (re-schedules as needed)

## Key VS Code Extension Entry Points

### Activation
- `onStartupFinished` - Lazy activation after VS Code starts

### Commands
| Command | Description |
|---------|-------------|
| `codeReviewer.analyzeFile` | Analyze current file |
| `codeReviewer.analyzeWorkspace` | Analyze entire workspace |
| `codeReviewer.summarizeFile` | Generate file summary |
| `codeReviewer.generateRefactorPlan` | Create refactor plan |
| `codeReviewer.generateTests` | Generate tests for selection |
| `codeReviewer.scheduleModuleFixes` | Schedule fixes as tasks |
| `codeReviewer.openCalendar` | Open calendar view |
| `codeReviewer.openDashboard` | Open dashboard view |
| `codeReviewer.configureAI` | Configure AI provider |

### Views
| View ID | Type | Purpose |
|---------|------|---------|
| `codeReviewer.dashboard` | Webview | Health overview |
| `codeReviewer.calendar` | Webview | Task scheduling |
| `codeReviewer.tasks` | TreeView | Task list |
| `codeReviewer.codeHealth` | TreeView | Issue browser |

## Data Models

### Task
```typescript
interface Task {
    id: string;
    title: string;
    description: string;
    type: TaskType;           // refactor, test, expand, etc.
    status: TaskStatus;       // pending, scheduled, completed
    priority: TaskPriority;   // 1-4
    affectedFiles: string[];
    sourceIssueIds: string[];
    estimatedMinutes: number;
    scheduledDate?: Date;
    scheduledTimeSlot?: TimeSlot;
    dependencies: string[];
    confidence: number;       // 0-1
    createdAt: Date;
    updatedAt: Date;
    completedAt?: Date;
    aiRationale: string;
}
```

### FileAnalysis
```typescript
interface FileAnalysis {
    filePath: string;
    languageId: string;
    analyzedAt: Date;
    issues: CodeIssue[];
    summary: FileSummary;
    metrics: CodeMetrics;
}
```

### CodeIssue
```typescript
interface CodeIssue {
    id: string;
    filePath: string;
    startLine: number;
    endLine: number;
    severity: IssueSeverity;
    category: IssueCategory;
    title: string;
    description: string;
    suggestion?: string;
    estimatedEffort: EffortEstimate;
    riskLevel: RiskLevel;
    confidence: number;
}
```

## Scalability & Performance

### Caching Strategy
- **Analysis Cache:** 24-hour TTL, 100 file limit, LRU eviction
- **Memory Usage:** ~50KB per file analysis
- **Persistence:** VS Code globalState (survives restarts)

### Incremental Analysis
- File-level granularity
- Debounced auto-analysis on save (1s delay)
- Queue-based processing prevents duplicate work

### Batch Processing
- Workspace analysis: 5 files in parallel
- Progress reporting with cancellation support
- Graceful degradation on API errors

### Large Codebase Handling
- Exclude patterns for node_modules, dist, etc.
- Configurable analysis depth (light/moderate/deep)
- Truncation of large files (15k char limit to AI)

## Security Considerations

### API Key Storage
- Keys stored in VS Code settings
- Not committed to version control
- Support for workspace-level overrides

### Code Transmission
- Only code content sent to AI
- No file paths or system information
- Truncation prevents excessive data transfer

### Sandbox
- Extension runs in VS Code sandbox
- No file system writes (except cache)
- No network access except to configured AI endpoints

## Future Expansion Ideas

### Phase 2: CI/CD Integration
- GitHub Actions integration
- Pre-commit hooks for analysis
- PR comment generation

### Phase 3: Team Mode
- Shared task assignments
- Team dashboard
- Slack/Teams notifications

### Phase 4: Learning
- Custom rules from user feedback
- Project-specific patterns
- Historical trend analysis

### Phase 5: Advanced Features
- Automated refactoring application
- AI-powered code completion
- Real-time pair programming mode

## Configuration Reference

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `aiProvider` | enum | anthropic | AI provider selection |
| `apiKey` | string | - | API key for provider |
| `apiEndpoint` | string | - | Custom API endpoint |
| `model` | string | claude-sonnet-4-20250514 | Model to use |
| `analysisDepth` | enum | moderate | Analysis thoroughness |
| `autoAnalyze` | boolean | true | Auto-analyze on save |
| `inlineAnnotations` | boolean | true | Show inline markers |
| `workHoursStart` | number | 9 | Work day start (24h) |
| `workHoursEnd` | number | 17 | Work day end (24h) |
| `focusSessionDuration` | number | 90 | Focus block (minutes) |
| `excludePatterns` | string[] | [...] | Glob patterns to skip |

## Development Setup

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch mode
npm run watch

# Package extension
npm run package

# Run tests
npm test
```

## Testing Strategy

### Unit Tests
- Agent output parsing
- Task scheduling logic
- Cache operations

### Integration Tests
- Full analysis flow
- UI updates on events
- Configuration changes

### E2E Tests
- Command execution
- View rendering
- AI provider switching
