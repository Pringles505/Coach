/**
 * Agent Prompt Templates
 *
 * Each prompt is designed to:
 * - Be specific and actionable
 * - Request structured JSON output
 * - Minimize token usage while maximizing insight
 * - Handle edge cases gracefully
 */

export const PROMPTS = {
    // =========================================================================
    // FILE SUMMARY PROMPTS (Pure Summary - No Issues)
    // =========================================================================

    FILE_SUMMARY_SYSTEM: `You are an expert code reader. Your task is to describe what code does - its purpose, structure, and functionality.

DO NOT identify issues, problems, or improvements. DO NOT critique the code. Only describe what it does.

Output format: JSON with the following structure:
{
  "summary": {
    "purpose": "Clear description of what this code does and its role",
    "components": ["List of main functions/classes/modules"],
    "dependencies": ["External dependencies used"],
    "publicApi": ["Exported/public interfaces"],
    "complexity": "simple|moderate|complex|very_complex"
  },
  "metrics": {
    "cognitiveComplexity": number
  }
}

Focus on:
- What the code accomplishes (its purpose)
- How it's structured (its architecture)
- What components it contains
- What it depends on
- What it exposes to other code`,

    FILE_SUMMARY_USER: `Describe this {{LANGUAGE}} file: {{FILE_NAME}}

\`\`\`{{LANGUAGE}}
{{CODE}}
\`\`\`

Return JSON with summary and metrics only. Do not identify issues or problems.`,

    // =========================================================================
    // PURE PROJECT SUMMARY PROMPTS (No Issues/Hotspots)
    // =========================================================================

    PURE_PROJECT_SUMMARY_SYSTEM: `You are an expert software architect. Summarize project structure and architecture from file summaries.

DO NOT identify issues, problems, hotspots, or recommendations for improvement. Only describe what the project does and how it's organized.

Output format: JSON with:
{
  "overview": "2-3 sentence project overview describing what it does",
  "architecture": "Description of architectural patterns and structure",
  "modules": [
    {
      "name": "Module name",
      "path": "Path pattern",
      "purpose": "What this module does"
    }
  ],
  "techStack": ["List of technologies, frameworks, and libraries used"],
  "entryPoints": ["Main entry points like index.ts, main.py, etc."]
}

Focus on:
- What the project accomplishes
- How it's architecturally organized
- What technologies it uses
- Where execution begins`,

    PURE_PROJECT_SUMMARY_USER: `Summarize this project based on file summaries:

{{ANALYSIS_DATA}}

Describe the main modules, architectural patterns, tech stack, and entry points. Do not identify issues or recommendations.`,

    // =========================================================================
    // CODE ANALYSIS AGENT PROMPTS
    // =========================================================================

    CODE_ANALYSIS_SYSTEM: `You are an expert code analyzer. Analyze code for quality issues, technical debt, and improvement opportunities.

Your analysis should be:
- Precise and actionable
- Focused on real issues, not style preferences
- Prioritized by severity and impact

Output format: JSON with the following structure:
{
  "summary": {
    "purpose": "Brief description of what this code does",
    "components": ["List of main functions/classes/modules"],
    "dependencies": ["External dependencies used"],
    "publicApi": ["Exported/public interfaces"],
    "complexity": "simple|moderate|complex|very_complex"
  },
  "issues": [
    {
      "startLine": number,
      "endLine": number,
      "severity": "info|warning|error|critical",
      "category": "code_smell|technical_debt|incomplete_logic|complexity|documentation|security|performance|testing|best_practice",
      "title": "Short issue title",
      "description": "Detailed explanation",
      "suggestion": "How to fix it",
      "effort": "trivial|small|medium|large|xlarge",
      "risk": "low|medium|high|critical",
      "confidence": 0.0-1.0
    }
  ],
  "metrics": {
    "cognitiveComplexity": number
  }
}

Line numbering: Use the explicit 1-based line numbers shown in the code block (the numbers before the "|" separator).

Focus on these issue categories:
- CODE_SMELL: Poor patterns, bad naming, magic numbers
- TECHNICAL_DEBT: Workarounds, TODOs, deprecated usage
- INCOMPLETE_LOGIC: Missing error handling, uncovered cases
- COMPLEXITY: Functions too long, deeply nested logic
- SECURITY: Input validation, injection risks, auth issues
- PERFORMANCE: N+1 queries, memory leaks, inefficient algorithms
- TESTING: Untestable code, missing test hooks
- BEST_PRACTICE: Language-specific anti-patterns`,

    CODE_ANALYSIS_USER: `Analyze this {{LANGUAGE}} file: {{FILE_NAME}}

Analysis depth: {{DEPTH}}

\`\`\`{{LANGUAGE}}
{{CODE}}
\`\`\`

Return JSON analysis.`,

    // =========================================================================
    // PROJECT SUMMARY PROMPTS
    // =========================================================================

    PROJECT_SUMMARY_SYSTEM: `You are an expert software architect. Summarize project structure and health from file analyses.

Output format: JSON with:
{
  "overview": "2-3 sentence project overview",
  "architecture": "Description of architectural patterns used",
  "modules": [
    {
      "name": "Module name",
      "path": "Path pattern",
      "purpose": "What this module does",
      "healthScore": 0-100,
      "issueCount": number
    }
  ],
  "recommendations": [
    "Priority improvement suggestion",
    "..."
  ]
}`,

    PROJECT_SUMMARY_USER: `Summarize this project based on file analyses:

{{ANALYSIS_DATA}}

Identify main modules, architectural patterns, and priority improvements.`,

    // =========================================================================
    // REFACTOR PLANNING PROMPTS
    // =========================================================================

    REFACTOR_PLANNING_SYSTEM: `You are an expert refactoring consultant. Create detailed, step-by-step refactoring plans.

Principles:
- Small, incremental changes
- Maintain functionality at each step
- Consider test coverage
- Minimize risk

Output format: JSON with:
{
  "title": "Plan title",
  "description": "Overview of what this refactoring achieves",
  "steps": [
    {
      "action": "What to do",
      "file": "File path",
      "lineRange": { "start": number, "end": number },
      "rationale": "Why this change",
      "estimatedMinutes": number,
      "risk": "low|medium|high|critical"
    }
  ]
}

Order steps from lowest to highest risk. Group related changes.`,

    REFACTOR_PLANNING_USER: `Create a refactoring plan for {{FILE_NAME}} ({{LANGUAGE}}).

Issues to address:
{{ISSUES}}

Current code:
\`\`\`{{LANGUAGE}}
{{CODE}}
\`\`\`

Return JSON refactoring plan.`,

    // =========================================================================
    // TEST GENERATION PROMPTS
    // =========================================================================

    TEST_GENERATION_SYSTEM: `You are an expert test engineer. Generate comprehensive tests.

For each piece of code, generate:
1. Unit tests for core functionality
2. Edge case tests for boundary conditions
3. Integration tests where appropriate

Match the project's testing framework and style.

Output format: JSON with:
{
  "setupCode": "Import statements and setup",
  "tests": [
    {
      "name": "test_descriptive_name",
      "type": "unit|integration|edge_case",
      "code": "Complete test code",
      "targetFunction": "Function being tested",
      "description": "What this test verifies"
    }
  ],
  "teardownCode": "Optional cleanup code"
}`,

    TEST_GENERATION_USER: `Generate tests for this {{LANGUAGE}} code using {{FRAMEWORK}}.

Selected code to test:
\`\`\`{{LANGUAGE}}
{{SELECTED_CODE}}
\`\`\`

File context:
\`\`\`{{LANGUAGE}}
{{FILE_CONTEXT}}
\`\`\`

Return JSON with test suite.`,

    EDGE_CASE_SYSTEM: `You are an expert at finding edge cases and boundary conditions.

For each function, identify:
- Null/undefined/empty inputs
- Boundary values (0, -1, MAX_INT, etc.)
- Invalid type inputs
- Concurrent access issues
- Error conditions

Output format: JSON array of edge case tests.`,

    EDGE_CASE_USER: `Identify edge cases for this {{LANGUAGE}} function:

\`\`\`{{LANGUAGE}}
{{FUNCTION_CODE}}
\`\`\`

Return JSON with edge case tests.`,

    // =========================================================================
    // TASK ENHANCEMENT PROMPTS
    // =========================================================================

    TASK_ENHANCEMENT_SYSTEM: `You enhance task descriptions to be clearer and more actionable.

Take a task and return:
{
  "description": "Enhanced, clear description with steps",
  "rationale": "Why this task matters and its impact"
}`,

    TASK_ENHANCEMENT_USER: `Enhance this task:

Title: {{TASK_TITLE}}
Current description: {{TASK_DESCRIPTION}}
Affected files: {{AFFECTED_FILES}}
AI rationale: {{AI_RATIONALE}}

Return enhanced JSON.`,

    // =========================================================================
    // INLINE ANNOTATION PROMPTS
    // =========================================================================

    QUICK_ANALYSIS_SYSTEM: `You are a code reviewer providing quick inline feedback.

Return a single JSON object:
{
  "annotations": [
    {
      "line": number,
      "type": "refactor|test|expand|warning",
      "message": "Very brief (under 50 chars) annotation"
    }
  ]
}

Only annotate lines with significant issues. Max 5 annotations.`,

    QUICK_ANALYSIS_USER: `Quick review this {{LANGUAGE}} code:

\`\`\`{{LANGUAGE}}
{{CODE}}
\`\`\``,

    // =========================================================================
    // DOCUMENTATION PROMPTS
    // =========================================================================

    DOCUMENTATION_SYSTEM: `You generate clear, concise documentation.

For functions/classes, include:
- Brief description
- Parameters with types and descriptions
- Return value description
- Usage example if non-obvious
- Throws/errors if applicable

Match the documentation style of the language (JSDoc, docstrings, etc.)`,

    DOCUMENTATION_USER: `Generate documentation for this {{LANGUAGE}} code:

\`\`\`{{LANGUAGE}}
{{CODE}}
\`\`\`

Use {{DOC_STYLE}} format.`,

    // =========================================================================
    // EXPANSION PROMPTS (Missing Features)
    // =========================================================================

    EXPANSION_ANALYSIS_SYSTEM: `You identify areas where code should be expanded.

Look for:
- Missing error handling
- Incomplete input validation
- Missing edge case handling
- Weak abstractions that should be strengthened
- Under-engineered areas that need more robust implementation

Output format: JSON with:
{
  "expansions": [
    {
      "location": "File:line or description",
      "type": "error_handling|validation|edge_case|abstraction|robustness",
      "description": "What's missing",
      "suggestion": "How to expand",
      "priority": "low|medium|high"
    }
  ]
}`,

    EXPANSION_ANALYSIS_USER: `Analyze this {{LANGUAGE}} code for expansion opportunities:

\`\`\`{{LANGUAGE}}
{{CODE}}
\`\`\`

Return JSON with expansion recommendations.`
};

/**
 * Example AI outputs for reference/testing
 */
export const EXAMPLE_OUTPUTS = {
    CODE_ANALYSIS: {
        summary: {
            purpose: "User authentication service handling login, logout, and session management",
            components: ["AuthService", "SessionManager", "TokenValidator"],
            dependencies: ["bcrypt", "jsonwebtoken", "redis"],
            publicApi: ["login()", "logout()", "validateToken()"],
            complexity: "moderate"
        },
        issues: [
            {
                startLine: 45,
                endLine: 52,
                severity: "error",
                category: "security",
                title: "Password stored in plain text in logs",
                description: "The login function logs the entire request object which includes the password field.",
                suggestion: "Sanitize the request object before logging, removing sensitive fields.",
                effort: "small",
                risk: "high",
                confidence: 0.95
            },
            {
                startLine: 78,
                endLine: 85,
                severity: "warning",
                category: "code_smell",
                title: "Magic number in token expiration",
                description: "Token expiration uses hardcoded value 86400 without explanation.",
                suggestion: "Extract to named constant TOKEN_EXPIRATION_SECONDS.",
                effort: "trivial",
                risk: "low",
                confidence: 0.9
            }
        ],
        metrics: {
            cognitiveComplexity: 12
        }
    },

    REFACTOR_PLAN: {
        title: "Improve AuthService Code Quality",
        description: "Address security concern and improve maintainability through better constants and error handling.",
        steps: [
            {
                action: "Extract magic numbers to named constants",
                file: "src/auth/authService.ts",
                lineRange: { start: 78, end: 85 },
                rationale: "Improves readability and makes values configurable",
                estimatedMinutes: 10,
                risk: "low"
            },
            {
                action: "Add request sanitization before logging",
                file: "src/auth/authService.ts",
                lineRange: { start: 45, end: 52 },
                rationale: "Prevents sensitive data from appearing in logs",
                estimatedMinutes: 20,
                risk: "medium"
            }
        ]
    },

    TEST_SUITE: {
        setupCode: `import { AuthService } from './authService';
import { jest } from '@jest/globals';

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn()
};`,
        tests: [
            {
                name: "login_with_valid_credentials_returns_token",
                type: "unit",
                code: `test('login with valid credentials returns token', async () => {
  const authService = new AuthService(mockRedis);
  const result = await authService.login('user@test.com', 'validPassword');
  expect(result.token).toBeDefined();
  expect(result.expiresIn).toBe(86400);
});`,
                targetFunction: "login",
                description: "Verifies successful login returns a valid token"
            },
            {
                name: "login_with_invalid_password_throws_error",
                type: "edge_case",
                code: `test('login with invalid password throws AuthError', async () => {
  const authService = new AuthService(mockRedis);
  await expect(authService.login('user@test.com', 'wrongPassword'))
    .rejects.toThrow('Invalid credentials');
});`,
                targetFunction: "login",
                description: "Verifies invalid password is rejected"
            }
        ]
    }
};
