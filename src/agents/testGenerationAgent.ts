import type { AIProvider } from '../types';
import { PROMPTS } from './prompts';
import type { TextDocumentLike } from '../core/document';
import {
    TestSuite,
    GeneratedTest,
    AgentMessage
} from '../types';

/**
 * TestGenerationAgent creates comprehensive test suites.
 *
 * Responsibilities:
 * - Generate unit tests for functions/methods
 * - Create integration tests for modules
 * - Identify and test edge cases
 * - Match existing test framework conventions
 */
export class TestGenerationAgent {
    private readonly name = 'TestGenerationAgent';

    constructor(private aiService: AIProvider) {}

    /**
     * Generate tests for selected code
     */
    async generate(
        document: TextDocumentLike,
        selectedCode: string
    ): Promise<TestSuite> {
        const fileName = document.uri.fsPath.split(/[\\/]/).pop() || 'file';
        const languageId = document.languageId;
        const framework = this.detectTestFramework(document);
        const fullContext = document.getText();

        const messages: AgentMessage[] = [
            { role: 'system', content: PROMPTS.TEST_GENERATION_SYSTEM },
            {
                role: 'user',
                content: PROMPTS.TEST_GENERATION_USER
                    .replace('{{FILE_NAME}}', fileName)
                    .replace('{{LANGUAGE}}', languageId)
                    .replace('{{FRAMEWORK}}', framework)
                    .replace('{{SELECTED_CODE}}', selectedCode)
                    .replace('{{FILE_CONTEXT}}', this.truncateCode(fullContext, 8000))
            }
        ];

        const response = await this.aiService.chat(messages, {
            temperature: 0.4,
            maxTokens: 4000
        });

        return this.parseTestResponse(response, document.uri.fsPath, framework);
    }

    /**
     * Format test suite as code
     */
    formatTests(suite: TestSuite): string {
        let output = '';

        // Add setup code if present
        if (suite.setupCode) {
            output += suite.setupCode + '\n\n';
        }

        // Add each test
        for (const test of suite.tests) {
            output += `// ${test.type.toUpperCase()}: ${test.description}\n`;
            output += test.code + '\n\n';
        }

        // Add teardown code if present
        if (suite.teardownCode) {
            output += suite.teardownCode;
        }

        return output;
    }

    /**
     * Generate edge case tests specifically
     */
    async generateEdgeCases(
        document: TextDocumentLike,
        functionCode: string
    ): Promise<GeneratedTest[]> {
        const messages: AgentMessage[] = [
            { role: 'system', content: PROMPTS.EDGE_CASE_SYSTEM },
            {
                role: 'user',
                content: PROMPTS.EDGE_CASE_USER
                    .replace('{{LANGUAGE}}', document.languageId)
                    .replace('{{FUNCTION_CODE}}', functionCode)
            }
        ];

        const response = await this.aiService.chat(messages, {
            temperature: 0.5,
            maxTokens: 2000
        });

        return this.parseEdgeCaseResponse(response);
    }

    // -------------------------------------------------------------------------
    // Private Methods
    // -------------------------------------------------------------------------

    private detectTestFramework(document: TextDocumentLike): string {
        const languageId = document.languageId;
        const content = document.getText();

        // Detect based on language and content patterns
        const frameworkPatterns: Record<string, Array<{ pattern: RegExp; framework: string }>> = {
            'typescript': [
                { pattern: /from ['"]vitest['"]/, framework: 'vitest' },
                { pattern: /from ['"]@jest\//, framework: 'jest' },
                { pattern: /import.*jest/, framework: 'jest' },
                { pattern: /describe\s*\(/, framework: 'jest' }
            ],
            'javascript': [
                { pattern: /from ['"]vitest['"]/, framework: 'vitest' },
                { pattern: /require\(['"]jest['"]/, framework: 'jest' },
                { pattern: /require\(['"]mocha['"]/, framework: 'mocha' }
            ],
            'python': [
                { pattern: /import pytest/, framework: 'pytest' },
                { pattern: /from unittest/, framework: 'unittest' }
            ],
            'java': [
                { pattern: /import org\.junit/, framework: 'junit' },
                { pattern: /@Test/, framework: 'junit' }
            ],
            'csharp': [
                { pattern: /using NUnit/, framework: 'nunit' },
                { pattern: /using Xunit/, framework: 'xunit' },
                { pattern: /\[Test\]/, framework: 'nunit' },
                { pattern: /\[Fact\]/, framework: 'xunit' }
            ],
            'go': [
                { pattern: /import "testing"/, framework: 'testing' },
                { pattern: /func Test/, framework: 'testing' }
            ],
            'rust': [
                { pattern: /#\[test\]/, framework: 'rust-test' },
                { pattern: /#\[cfg\(test\)\]/, framework: 'rust-test' }
            ]
        };

        const patterns = frameworkPatterns[languageId] || [];

        for (const { pattern, framework } of patterns) {
            if (pattern.test(content)) {
                return framework;
            }
        }

        // Default frameworks by language
        const defaults: Record<string, string> = {
            'typescript': 'jest',
            'javascript': 'jest',
            'typescriptreact': 'jest',
            'javascriptreact': 'jest',
            'python': 'pytest',
            'java': 'junit',
            'csharp': 'xunit',
            'go': 'testing',
            'rust': 'rust-test',
            'ruby': 'rspec',
            'php': 'phpunit'
        };

        return defaults[languageId] || 'generic';
    }

    private parseTestResponse(
        response: string,
        filePath: string,
        framework: string
    ): TestSuite {
        try {
            // Try to extract JSON if present
            const jsonMatch = response.match(/```json\n?([\s\S]*?)\n?```/);

            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[1]);
                return {
                    filePath,
                    framework,
                    tests: (parsed.tests || []).map((t: any) => ({
                        name: t.name || 'test',
                        type: t.type || 'unit',
                        code: t.code || '',
                        targetFunction: t.targetFunction || '',
                        description: t.description || ''
                    })),
                    setupCode: parsed.setupCode,
                    teardownCode: parsed.teardownCode
                };
            }

            // Extract code blocks as tests
            const codeBlocks = response.matchAll(/```(?:\w+)?\n([\s\S]*?)\n```/g);
            const tests: GeneratedTest[] = [];

            for (const match of codeBlocks) {
                const code = match[1];
                tests.push({
                    name: this.extractTestName(code),
                    type: 'unit',
                    code,
                    targetFunction: '',
                    description: 'Generated test'
                });
            }

            return {
                filePath,
                framework,
                tests: tests.length > 0 ? tests : [{
                    name: 'generatedTest',
                    type: 'unit',
                    code: response,
                    targetFunction: '',
                    description: 'Generated test suite'
                }]
            };
        } catch (error) {
            console.error('Failed to parse test response:', error);
            return {
                filePath,
                framework,
                tests: [{
                    name: 'generatedTest',
                    type: 'unit',
                    code: this.extractCodeFromResponse(response),
                    targetFunction: '',
                    description: 'Generated test'
                }]
            };
        }
    }

    private parseEdgeCaseResponse(response: string): GeneratedTest[] {
        try {
            const jsonMatch = response.match(/```json\n?([\s\S]*?)\n?```/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[1]);
                return (parsed.tests || parsed || []).map((t: any) => ({
                    name: t.name || 'edgeCaseTest',
                    type: 'edge_case' as const,
                    code: t.code || '',
                    targetFunction: t.targetFunction || '',
                    description: t.description || 'Edge case test'
                }));
            }

            return [];
        } catch {
            return [];
        }
    }

    private extractTestName(code: string): string {
        // Try to extract test name from common patterns
        const patterns = [
            /(?:it|test|describe)\s*\(\s*['"`]([^'"`]+)['"`]/,
            /def\s+(test_\w+)/,
            /func\s+(Test\w+)/,
            /void\s+(test\w+)/,
            /public\s+void\s+(\w+Test)/
        ];

        for (const pattern of patterns) {
            const match = code.match(pattern);
            if (match) {
                return match[1];
            }
        }

        return 'generatedTest';
    }

    private extractCodeFromResponse(response: string): string {
        // Remove markdown formatting if present
        const codeMatch = response.match(/```(?:\w+)?\n([\s\S]*?)\n```/);
        return codeMatch ? codeMatch[1] : response;
    }

    private truncateCode(code: string, maxChars: number): string {
        if (code.length <= maxChars) return code;
        return code.substring(0, maxChars) + '\n// ... (truncated)';
    }
}
