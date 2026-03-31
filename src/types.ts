import type Anthropic from "@anthropic-ai/sdk";

// --- Complexity & Judge ---

export type ComplexityLevel = "simple" | "moderate" | "complex";
export type JudgeVerdict = "looks-good" | "pushback" | "hard-no";
export type UserDecision = "go" | "revise" | "skip" | "cancel";

export interface JudgeReview {
	verdict: JudgeVerdict;
	explanation: string | null;
	concerns: string[];
	simplerAlternative: string | null;
	questions: string[];
	raw: string;
}

// --- Tokens ---

export interface TokenUsage {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheCreationTokens: number;
}

export function emptyUsage(): TokenUsage {
	return {
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheCreationTokens: 0,
	};
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
	return {
		inputTokens: a.inputTokens + b.inputTokens,
		outputTokens: a.outputTokens + b.outputTokens,
		cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
		cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
	};
}

export interface ModelInfo {
	id: string;
	label: string;
	note: string;
	pricing: { input: number; output: number };
}

export const MODELS: ModelInfo[] = [
	{
		id: "claude-sonnet-4-6",
		label: "Sonnet 4.6",
		note: "fast, balanced (default)",
		pricing: { input: 3, output: 15 },
	},
	{
		id: "claude-opus-4-6",
		label: "Opus 4.6",
		note: "strongest, expensive",
		pricing: { input: 15, output: 75 },
	},
	{
		id: "claude-haiku-4-5-20251001",
		label: "Haiku 4.5",
		note: "fastest, cheapest",
		pricing: { input: 0.8, output: 4 },
	},
];

export function estimateCost(usage: TokenUsage, model: string): number {
	const info = MODELS.find((m) => m.id === model);
	const p = info?.pricing ?? { input: 3, output: 15 };
	return (
		(usage.inputTokens * p.input +
			usage.outputTokens * p.output +
			usage.cacheReadTokens * p.input * 0.1 +
			usage.cacheCreationTokens * p.input * 1.25) /
		1_000_000
	);
}

// --- Tools ---

export interface ToolDefinition {
	name: string;
	description: string;
	input_schema: Anthropic.Tool["input_schema"];
}

export interface InternalTool {
	definition: ToolDefinition;
	execute: (
		input: Record<string, unknown>,
		signal?: AbortSignal,
	) => Promise<string>;
	readOnly: boolean;
	requiresApproval: boolean;
}

// --- Messages ---

export type Message = Anthropic.MessageParam;
export type ContentBlock = Anthropic.ContentBlock;
export type ToolUseBlock = Anthropic.ToolUseBlock;
export type ToolResultBlockParam = Anthropic.ToolResultBlockParam;
