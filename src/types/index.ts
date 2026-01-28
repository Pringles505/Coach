// ============================================================================
// Core Data Types for Coach
// ============================================================================

// ---------------------------------------------------------------------------
// Analysis Types
// ---------------------------------------------------------------------------

export enum IssueSeverity {
    Info = 'info',
    Warning = 'warning',
    Error = 'error',
    Critical = 'critical'
}

export enum IssueCategory {
    CodeSmell = 'code_smell',
    TechnicalDebt = 'technical_debt',
    IncompleteLogic = 'incomplete_logic',
    Complexity = 'complexity',
    Documentation = 'documentation',
    Security = 'security',
    Performance = 'performance',
    Testing = 'testing',
    BestPractice = 'best_practice'
}

export interface CodeIssue {
    id: string;
    filePath: string;
    startLine: number;
    endLine: number;
    startColumn?: number;
    endColumn?: number;
    severity: IssueSeverity;
    category: IssueCategory;
    title: string;
    description: string;
    suggestion?: string;
    estimatedEffort: EffortEstimate;
    riskLevel: RiskLevel;
    confidence: number; // 0-1
}

export interface FileAnalysis {
    filePath: string;
    languageId: string;
    analyzedAt: Date;
    issues: CodeIssue[];
    summary: FileSummary;
    metrics: CodeMetrics;
    testCoverage?: TestCoverageInfo;
}

export interface FileSummary {
    purpose: string;
    mainComponents: string[];
    dependencies: string[];
    publicApi: string[];
    complexity: ComplexityLevel;
}

export interface CodeMetrics {
    linesOfCode: number;
    cyclomaticComplexity: number;
    cognitiveComplexity: number;
    maintainabilityIndex: number;
    technicalDebtMinutes: number;
    testCoveragePercent?: number;
}

export interface TestCoverageInfo {
    covered: number;
    total: number;
    uncoveredRanges: Array<{ start: number; end: number }>;
}

export interface WorkspaceAnalysis {
    rootPath: string;
    analyzedAt: Date;
    filesAnalyzed: number;
    totalIssues: number;
    fileAnalyses: Map<string, FileAnalysis>;
    projectSummary: ProjectSummary;
    healthScore: number; // 0-100
}

export interface ProjectSummary {
    overview: string;
    architecture: string;
    mainModules: ModuleInfo[];
    hotspots: HotspotInfo[];
    recommendations: string[];
}

export interface ModuleInfo {
    name: string;
    path: string;
    purpose: string;
    healthScore: number;
    issueCount: number;
}

export interface HotspotInfo {
    path: string;
    reason: string;
    issueCount: number;
    severity: IssueSeverity;
}

export interface PureFileSummary {
    filePath: string;
    languageId: string;
    summary: FileSummary;
    metrics: CodeMetrics;
}

export interface PureProjectSummary {
    overview: string;
    architecture: string;
    mainModules: Array<{ name: string; path: string; purpose: string }>;
    techStack: string[];
    entryPoints: string[];
}

// ---------------------------------------------------------------------------
// Task Types
// ---------------------------------------------------------------------------

export enum TaskType {
    Refactor = 'refactor',
    Test = 'test',
    Expand = 'expand',
    Documentation = 'documentation',
    Security = 'security',
    Performance = 'performance',
    BugFix = 'bugfix'
}

export enum TaskStatus {
    Pending = 'pending',
    Scheduled = 'scheduled',
    InProgress = 'in_progress',
    Completed = 'completed',
    Deferred = 'deferred',
    Cancelled = 'cancelled'
}

export enum TaskPriority {
    Low = 1,
    Medium = 2,
    High = 3,
    Critical = 4
}

export enum TaskSource {
    Analysis = 'analysis',      // Created from code analysis
    UserCreated = 'user',       // Manually created by user
    AiPlanned = 'ai_planned'    // Created via natural language AI planning
}

export interface Task {
    id: string;
    title: string;
    description: string;
    type: TaskType;
    status: TaskStatus;
    priority: TaskPriority;
    source: TaskSource;
    affectedFiles: string[];
    sourceIssueIds: string[];
    estimatedMinutes: number;
    scheduledDate?: Date;
    scheduledTimeSlot?: TimeSlot;
    dependencies: string[]; // Task IDs
    confidence: number; // 0-1
    createdAt: Date;
    updatedAt: Date;
    completedAt?: Date;
    aiRationale: string;
    userNotes?: string;
}

export interface TaskSuggestion {
    id: string;
    task: Task;
    createdAt: Date;
}

export interface TimeSlot {
    start: Date;
    end: Date;
}

export interface TaskGroup {
    id: string;
    name: string;
    tasks: Task[];
    groupType: 'project' | 'file' | 'type';
}

// ---------------------------------------------------------------------------
// Calendar Types
// ---------------------------------------------------------------------------

export interface CalendarEvent {
    id: string;
    taskId: string;
    title: string;
    start: Date;
    end: Date;
    type: TaskType;
    priority: TaskPriority;
    isCompleted: boolean;
}

export interface FocusSession {
    id: string;
    start: Date;
    end: Date;
    taskIds: string[];
    label: string;
}

export interface CalendarDay {
    date: Date;
    events: CalendarEvent[];
    focusSessions: FocusSession[];
    totalMinutes: number;
    completedMinutes: number;
}

export interface CalendarWeek {
    startDate: Date;
    days: CalendarDay[];
    totalTasks: number;
    completedTasks: number;
}

// ---------------------------------------------------------------------------
// Agent Types
// ---------------------------------------------------------------------------

export interface AgentContext {
    workspaceRoot: string;
    currentFile?: string;
    currentCode?: string;
    analysisCache: Map<string, FileAnalysis>;
    existingTasks: Task[];
    userPreferences: UserPreferences;
}

export interface AgentResult<T> {
    success: boolean;
    data?: T;
    error?: string;
    tokensUsed?: number;
    duration?: number;
}

export interface AgentMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface AgentConfig {
    name: string;
    systemPrompt: string;
    temperature: number;
    maxTokens: number;
}

// ---------------------------------------------------------------------------
// Configuration Types
// ---------------------------------------------------------------------------

export interface UserPreferences {
    workHoursStart: number;
    workHoursEnd: number;
    focusSessionDuration: number;
    preferredTaskTypes: TaskType[];
    excludePatterns: string[];
    analysisDepth: AnalysisDepth;
}

export type AnalysisDepth = 'light' | 'moderate' | 'deep';
export type EffortEstimate = 'trivial' | 'small' | 'medium' | 'large' | 'xlarge';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type ComplexityLevel = 'simple' | 'moderate' | 'complex' | 'very_complex';

// ---------------------------------------------------------------------------
// AI Provider Types
// ---------------------------------------------------------------------------

export interface AIProvider {
    name: string;
    chat(messages: AgentMessage[], config?: Partial<AIRequestConfig>): Promise<string>;
    streamChat?(messages: AgentMessage[], config?: Partial<AIRequestConfig>): AsyncGenerator<string>;
}

export interface AIRequestConfig {
    model: string;
    temperature: number;
    maxTokens: number;
    stopSequences?: string[];
}

export interface AIProviderConfig {
    provider: 'anthropic' | 'openai' | 'azure' | 'ollama' | 'custom';
    apiKey: string;
    apiEndpoint?: string;
    model: string;
}

// ---------------------------------------------------------------------------
// UI Types
// ---------------------------------------------------------------------------

export interface DashboardData {
    healthScore: number;
    issuesByCategory: Record<IssueCategory, number>;
    issuesBySeverity: Record<IssueSeverity, number>;
    recentAnalyses: FileAnalysis[];
    upcomingTasks: Task[];
    hotspots: HotspotInfo[];
    taskSuggestions: TaskSuggestion[];
}

export interface CodeHealthTreeItem {
    id: string;
    label: string;
    description?: string;
    tooltip?: string;
    iconPath?: string;
    collapsibleState: 'none' | 'collapsed' | 'expanded';
    children?: CodeHealthTreeItem[];
    command?: {
        command: string;
        arguments?: unknown[];
    };
}

// ---------------------------------------------------------------------------
// Refactoring Types
// ---------------------------------------------------------------------------

export interface RefactorPlan {
    id: string;
    title: string;
    description: string;
    steps: RefactorStep[];
    estimatedTotalMinutes: number;
    riskLevel: RiskLevel;
    affectedFiles: string[];
}

export interface RefactorStep {
    order: number;
    action: string;
    file: string;
    lineRange?: { start: number; end: number };
    rationale: string;
    estimatedMinutes: number;
    risk: RiskLevel;
}

// ---------------------------------------------------------------------------
// Test Generation Types
// ---------------------------------------------------------------------------

export interface GeneratedTest {
    name: string;
    type: 'unit' | 'integration' | 'edge_case';
    code: string;
    targetFunction: string;
    description: string;
}

export interface TestSuite {
    filePath: string;
    framework: string;
    tests: GeneratedTest[];
    setupCode?: string;
    teardownCode?: string;
}
