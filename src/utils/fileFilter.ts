import * as vscode from 'vscode';
import * as path from 'path';

/**
 * FileRelevance indicates how relevant a file is for code analysis
 */
export enum FileRelevance {
    /** Core business logic - highest priority */
    Core = 'core',
    /** Supporting code - analyze if time permits */
    Supporting = 'supporting',
    /** Config/setup files - skip detailed analysis */
    Config = 'config',
    /** Generated/vendor code - skip entirely */
    Generated = 'generated',
    /** Test files - analyze separately */
    Test = 'test'
}

export interface FileClassification {
    relevance: FileRelevance;
    reason: string;
    shouldAnalyze: boolean;
    priority: number; // 1-10, higher = more important
}

/**
 * SmartFileFilter automatically classifies files to determine
 * which ones should be analyzed for code quality issues.
 *
 * Design Philosophy:
 * - Focus on files where issues matter most
 * - Skip config files that are rarely modified
 * - Skip generated/vendor code
 * - Prioritize core business logic
 */
export class SmartFileFilter {
    // File patterns for different categories
    private static readonly CONFIG_PATTERNS = [
        // Config files
        /\.config\.(js|ts|mjs|cjs)$/i,
        /\.conf\.(js|ts)$/i,
        /config\.(js|ts|json|yaml|yml)$/i,
        /settings\.(js|ts|json)$/i,
        /\.env(\..+)?$/i,
        /\.rc$/i,
        /\.(json|yaml|yml|toml|ini)$/i,

        // Build/bundler configs
        /webpack\./i,
        /vite\./i,
        /rollup\./i,
        /esbuild\./i,
        /babel\./i,
        /tsconfig/i,
        /jsconfig/i,
        /\.babelrc/i,
        /\.eslintrc/i,
        /\.prettierrc/i,
        /\.stylelintrc/i,
        /tailwind\.config/i,
        /postcss\.config/i,
        /next\.config/i,
        /nuxt\.config/i,
        /vue\.config/i,
        /angular\.json/i,
        /karma\.conf/i,
        /jest\.config/i,
        /vitest\.config/i,

        // Package management
        /package\.json$/i,
        /package-lock\.json$/i,
        /yarn\.lock$/i,
        /pnpm-lock\.yaml$/i,
        /composer\.json$/i,
        /Gemfile(\.lock)?$/i,
        /requirements\.txt$/i,
        /Pipfile(\.lock)?$/i,
        /pyproject\.toml$/i,
        /Cargo\.(toml|lock)$/i,
        /go\.(mod|sum)$/i,
        /\.csproj$/i,
        /\.sln$/i,

        // CI/CD
        /\.github\//i,
        /\.gitlab-ci/i,
        /Jenkinsfile/i,
        /\.travis\.yml/i,
        /azure-pipelines/i,
        /Dockerfile/i,
        /docker-compose/i,
        /\.dockerignore/i,
        /Makefile$/i,

        // IDE/Editor
        /\.vscode\//i,
        /\.idea\//i,
        /\.editorconfig$/i,
    ];

    private static readonly GENERATED_PATTERNS = [
        /\.min\.(js|css)$/i,
        /\.bundle\.(js|css)$/i,
        /\.generated\./i,
        /\.g\.(cs|ts)$/i,  // Generated C#/TS
        /\.d\.ts$/i,       // TypeScript declarations
        /\/dist\//i,
        /\/build\//i,
        /\/out\//i,
        /\/node_modules\//i,
        /\/vendor\//i,
        /\/packages\//i,
        /\/\.next\//i,
        /\/\.nuxt\//i,
        /\/__pycache__\//i,
        /\/target\//i,     // Rust/Java build
        /\/bin\//i,
        /\/obj\//i,
        /\.lock$/i,
        /swagger\.(json|yaml)/i,
        /openapi\.(json|yaml)/i,
        /schema\.graphql/i,
        /\.prisma$/i,
    ];

    private static readonly TEST_PATTERNS = [
        /\.test\.(js|ts|jsx|tsx|py|rb|go|rs)$/i,
        /\.spec\.(js|ts|jsx|tsx|py|rb|go|rs)$/i,
        /_test\.(go|py|rb)$/i,
        /test_.*\.(py)$/i,
        /\/tests?\//i,
        /\/__tests__\//i,
        /\.stories\.(js|ts|jsx|tsx)$/i,  // Storybook
        /\.cy\.(js|ts)$/i,  // Cypress
        /\.e2e\.(js|ts)$/i,
        /\.playwright\.(js|ts)$/i,
    ];

    private static readonly GLUE_CODE_PATTERNS = [
        // Entry points that are mostly wiring
        /^index\.(js|ts|jsx|tsx)$/i,
        /^main\.(js|ts|jsx|tsx|py|go|rs)$/i,
        /^app\.(js|ts|jsx|tsx)$/i,
        /^server\.(js|ts)$/i,

        // Routing files
        /routes?\.(js|ts|jsx|tsx)$/i,
        /router\.(js|ts|jsx|tsx)$/i,

        // DI/IoC containers
        /container\.(js|ts)$/i,
        /providers?\.(js|ts)$/i,
        /modules?\.(js|ts)$/i,

        // Type definitions only
        /types?\.(ts|d\.ts)$/i,
        /interfaces?\.(ts)$/i,
        /constants?\.(js|ts)$/i,
        /enums?\.(ts)$/i,
    ];

    private static readonly CORE_PATTERNS = [
        // Service/business logic
        /service/i,
        /controller/i,
        /handler/i,
        /manager/i,
        /processor/i,
        /engine/i,
        /core/i,
        /domain/i,
        /model/i,
        /entity/i,
        /repository/i,
        /usecase/i,
        /interactor/i,
        /command/i,
        /query/i,
        /aggregate/i,
        /validator/i,
        /transformer/i,
        /adapter/i,
        /gateway/i,
        /client/i,
        /api/i,
    ];

    /**
     * Classify a file to determine if and how it should be analyzed
     */
    static classify(filePath: string): FileClassification {
        const normalizedPath = filePath.replace(/\\/g, '/');
        const fileName = path.basename(normalizedPath);
        const ext = path.extname(normalizedPath).toLowerCase();

        // Check generated first (always skip)
        if (this.matchesPatterns(normalizedPath, this.GENERATED_PATTERNS)) {
            return {
                relevance: FileRelevance.Generated,
                reason: 'Generated or vendor code',
                shouldAnalyze: false,
                priority: 0
            };
        }

        // Check if it's a test file
        if (this.matchesPatterns(normalizedPath, this.TEST_PATTERNS)) {
            return {
                relevance: FileRelevance.Test,
                reason: 'Test file',
                shouldAnalyze: true, // Analyze tests but separately
                priority: 4
            };
        }

        // Check config files
        if (this.matchesPatterns(normalizedPath, this.CONFIG_PATTERNS)) {
            return {
                relevance: FileRelevance.Config,
                reason: 'Configuration file',
                shouldAnalyze: false,
                priority: 1
            };
        }

        // Check glue code
        if (this.matchesPatterns(fileName, this.GLUE_CODE_PATTERNS)) {
            return {
                relevance: FileRelevance.Supporting,
                reason: 'Entry point or glue code',
                shouldAnalyze: true, // Light analysis only
                priority: 3
            };
        }

        // Check for core business logic
        if (this.matchesPatterns(normalizedPath, this.CORE_PATTERNS)) {
            return {
                relevance: FileRelevance.Core,
                reason: 'Core business logic',
                shouldAnalyze: true,
                priority: 10
            };
        }

        // Additional heuristics based on file content indicators
        const priority = this.calculatePriority(normalizedPath, ext);

        return {
            relevance: priority >= 6 ? FileRelevance.Core : FileRelevance.Supporting,
            reason: priority >= 6 ? 'Source code' : 'Supporting code',
            shouldAnalyze: true,
            priority
        };
    }

    /**
     * Filter a list of files, returning only those worth analyzing
     */
    static filterForAnalysis(files: vscode.Uri[]): vscode.Uri[] {
        return files
            .map(file => ({
                file,
                classification: this.classify(file.fsPath)
            }))
            .filter(({ classification }) => classification.shouldAnalyze)
            .sort((a, b) => b.classification.priority - a.classification.priority)
            .map(({ file }) => file);
    }

    /**
     * Get analysis depth recommendation for a file
     */
    static getRecommendedDepth(filePath: string): 'light' | 'moderate' | 'deep' {
        const classification = this.classify(filePath);

        switch (classification.relevance) {
            case FileRelevance.Core:
                return 'deep';
            case FileRelevance.Supporting:
            case FileRelevance.Test:
                return 'moderate';
            case FileRelevance.Config:
            case FileRelevance.Generated:
                return 'light';
            default:
                return 'moderate';
        }
    }

    /**
     * Check if file content indicates generated code
     */
    static async isGeneratedContent(document: vscode.TextDocument): Promise<boolean> {
        const firstLines = document.getText(new vscode.Range(0, 0, 10, 0));

        const generatedIndicators = [
            /auto[-\s]?generated/i,
            /do not edit/i,
            /generated by/i,
            /this file is generated/i,
            /autogenerated/i,
            /@generated/i,
            /machine generated/i,
            /code generated/i,
        ];

        return generatedIndicators.some(pattern => pattern.test(firstLines));
    }

    /**
     * Get a summary of how files in a workspace would be classified
     */
    static async getWorkspaceSummary(rootUri: vscode.Uri): Promise<{
        total: number;
        byRelevance: Record<FileRelevance, number>;
        toAnalyze: number;
        examples: { path: string; relevance: FileRelevance; reason: string }[];
    }> {
        const files = await vscode.workspace.findFiles(
            new vscode.RelativePattern(rootUri, '**/*.{ts,tsx,js,jsx,py,java,cs,go,rs,rb,php}'),
            '**/node_modules/**'
        );

        const byRelevance: Record<FileRelevance, number> = {
            [FileRelevance.Core]: 0,
            [FileRelevance.Supporting]: 0,
            [FileRelevance.Config]: 0,
            [FileRelevance.Generated]: 0,
            [FileRelevance.Test]: 0,
        };

        const examples: { path: string; relevance: FileRelevance; reason: string }[] = [];
        let toAnalyze = 0;

        for (const file of files) {
            const classification = this.classify(file.fsPath);
            byRelevance[classification.relevance]++;

            if (classification.shouldAnalyze) {
                toAnalyze++;
            }

            // Collect examples for each category
            if (examples.filter(e => e.relevance === classification.relevance).length < 3) {
                examples.push({
                    path: vscode.workspace.asRelativePath(file),
                    relevance: classification.relevance,
                    reason: classification.reason
                });
            }
        }

        return {
            total: files.length,
            byRelevance,
            toAnalyze,
            examples
        };
    }

    // -------------------------------------------------------------------------
    // Private Methods
    // -------------------------------------------------------------------------

    private static matchesPatterns(str: string, patterns: RegExp[]): boolean {
        return patterns.some(pattern => pattern.test(str));
    }

    private static calculatePriority(filePath: string, ext: string): number {
        let priority = 5; // Base priority

        // Boost for source code extensions
        const highPriorityExts = ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.cs', '.go', '.rs'];
        if (highPriorityExts.includes(ext)) {
            priority += 2;
        }

        // Boost for files in src directories
        if (/\/src\//i.test(filePath) || /\/lib\//i.test(filePath)) {
            priority += 2;
        }

        // Boost for files with meaningful names
        if (/service|controller|handler|manager|util|helper/i.test(filePath)) {
            priority += 1;
        }

        // Reduce for deeply nested files (might be less important)
        const depth = (filePath.match(/\//g) || []).length;
        if (depth > 8) {
            priority -= 1;
        }

        return Math.max(1, Math.min(10, priority));
    }
}
