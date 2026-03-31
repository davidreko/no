import type Anthropic from "@anthropic-ai/sdk";
import chalk from "chalk";
import { streamMessage, toolResult } from "./client";
import { checkPermission } from "./permissions";
import { ask } from "./prompt";
import { getJudgePrompt } from "./prompts/judge";
import { getSystemPrompt } from "./prompts/system";
import { toolEscapesProject } from "./sandbox";
import { getReadOnlyToolDefinitions, getTool } from "./tools/index";
import type {
	ComplexityLevel,
	InternalTool,
	JudgeReview,
	JudgeVerdict,
	Message,
	TokenUsage,
	ToolDefinition,
	ToolUseBlock,
	UserDecision,
} from "./types";
import { addUsage, emptyUsage } from "./types";
import { fmtToolArgs, fmtToolCall, PlanStream, Spinner } from "./ui";

// --- Read-only tool execution (shared by planner + judge) ---

interface ReadOnlyExecOptions {
	toolUses: ToolUseBlock[];
	/** Error message when a non-read-only tool is requested. */
	denyMessage: string;
	/** Whether to prompt the user for sandbox escapes (planner) or auto-deny (judge). */
	promptOnEscape: boolean;
}

async function executeReadOnlyTools(
	opts: ReadOnlyExecOptions,
): Promise<Anthropic.ToolResultBlockParam[]> {
	const toExecute: Array<{ toolUse: ToolUseBlock; tool: InternalTool }> = [];
	const skipped: Anthropic.ToolResultBlockParam[] = [];

	for (const toolUse of opts.toolUses) {
		const tool = getTool(toolUse.name);
		const input = toolUse.input as Record<string, unknown>;
		console.log(fmtToolCall(toolUse.name, fmtToolArgs(toolUse.name, input)));

		if (!tool?.readOnly) {
			skipped.push(toolResult(toolUse.id, opts.denyMessage, true));
			continue;
		}

		if (toolEscapesProject(input)) {
			if (opts.promptOnEscape) {
				const allowed = await checkPermission(
					`${toolUse.name} (outside project)`,
					input,
				);
				if (!allowed) {
					skipped.push(
						toolResult(
							toolUse.id,
							"Permission denied  - path is outside project root",
							true,
						),
					);
					continue;
				}
			} else {
				skipped.push(
					toolResult(
						toolUse.id,
						"Permission denied  - path is outside project root",
						true,
					),
				);
				continue;
			}
		}

		toExecute.push({ toolUse, tool });
	}

	const executed = await Promise.all(
		toExecute.map(async ({ toolUse, tool }) => {
			try {
				const output = await tool.execute(
					toolUse.input as Record<string, unknown>,
				);
				return toolResult(toolUse.id, output);
			} catch (err) {
				return toolResult(
					toolUse.id,
					`Error: ${err instanceof Error ? err.message : String(err)}`,
					true,
				);
			}
		}),
	);

	return [...skipped, ...executed];
}

// --- Judge Review Tool ---

export const SUBMIT_REVIEW_TOOL: ToolDefinition = {
	name: "submit_review",
	description:
		"Submit your review of the proposed plan. You MUST call this tool exactly once to deliver your verdict.",
	input_schema: {
		type: "object" as const,
		properties: {
			verdict: {
				type: "string",
				enum: ["looks-good", "pushback", "hard-no"],
				description:
					"looks-good: plan solves a real problem proportionately (~50%). pushback: overengineered, unnecessary, or scope creep (~40%). hard-no: fundamentally wrong or dangerous (~10%).",
			},
			explanation: {
				type: "string",
				description:
					"1-2 sentences explaining WHY this verdict. For looks-good: what makes it solid. For pushback/hard-no: the core issue.",
			},
			concerns: {
				type: "array",
				items: { type: "string" },
				description: "Specific, actionable concerns. Empty array if none.",
			},
			simpler_alternative: {
				type: "string",
				description:
					'A concrete simpler approach, or null if the plan is already simple. Be specific: "use a Map instead of Redis" not "consider simpler options".',
			},
			questions: {
				type: "array",
				items: { type: "string" },
				description:
					"Questions about assumptions the plan makes. Empty array if none.",
			},
		},
		required: ["verdict", "explanation", "concerns", "questions"],
	},
};

// --- Complexity Classifier ---

const SIMPLE_PATTERNS = [
	/\bfix\s+(a\s+|the\s+)?typo/i,
	/\brename\b/i,
	/\badd\s+(a\s+)?comment/i,
	/\bchange\s+\S+\s+to\s+/i,
	/\bremove\s+(the\s+)?(unused|dead)/i,
	/\bupdate\s+(the\s+)?(import|version)/i,
	/\bdelete\s+(the\s+)?(line|file|comment)/i,
];

const COMPLEX_PATTERNS = [
	/\brefactor\b/i,
	/\bredesign\b/i,
	/\bimplement\b/i,
	/\bbuild\s+(a|the|an)\s+/i,
	/\barchitect/i,
	/\bmigrat/i,
	/\brewrite\b/i,
	/\bcreate\s+(a|an)\s+.*system/i,
	/\badd\s+(a|an)\s+.*layer/i,
	/\b(security|vulnerability|auth|authentication|authorization)\b/i,
	/\brate\s*limit/i,
	/\bpermission/i,
	/\bencrypt/i,
	/\bconcurrency\b/i,
	/\bscalability\b/i,
	/\bperformance\b/i,
	/\bintegrat/i,
];

const ACTION_WORDS =
	/\b(fix|add|remove|delete|update|change|rename|create|write|edit|move|refactor|implement|build|test|run|install|deploy|migrate|rewrite|debug|optimize)\b/i;

const QUESTION_PATTERNS = [
	/^(what|how|why|when|where|who|which|is|are|can|could|does|do|will|would|should)\b/i,
	/\?$/,
	/^explain\b/i,
	/^describe\b/i,
	/^list\b/i,
	/^show\s+me\b/i,
	/^tell\s+me\b/i,
	/^calculate\b/i,
	/^compare\b/i,
	/^summarize\b/i,
];

export function classifyComplexity(task: string): ComplexityLevel {
	const wordCount = task.split(/\s+/).length;

	// Questions and explanations don't need a plan or judge
	if (!ACTION_WORDS.test(task) && QUESTION_PATTERNS.some((p) => p.test(task))) {
		return "simple";
	}

	if (wordCount >= 50 || COMPLEX_PATTERNS.some((p) => p.test(task))) {
		return "complex";
	}

	if (wordCount <= 5 && !ACTION_WORDS.test(task)) {
		return "simple";
	}

	if (wordCount <= 10 && SIMPLE_PATTERNS.some((p) => p.test(task))) {
		return "simple";
	}

	return "moderate";
}

// --- Planner Pass ---

export interface PlanResult {
	plan: string;
	usage: TokenUsage;
	/** The planner's conversation history  - file reads are already in here. */
	messages: Message[];
}

export async function plannerPass(
	task: string,
	model: string,
	signal?: AbortSignal,
	thinking?: boolean,
	previousMessages?: Message[],
	judgeFeedback?: string,
): Promise<PlanResult> {
	let totalUsage = emptyUsage();
	const system = getSystemPrompt(process.cwd());
	const readOnlyTools = getReadOnlyToolDefinitions();

	const planPrompt = `You are planning a coding task. Use the read-only tools to understand the codebase, then produce a structured plan.

# Rules
- DO NOT execute any changes. Only read files and produce a plan.
- DO NOT judge whether the task is a good idea. That's not your job. Just plan HOW to do it.
- Always produce actionable steps, even if you think the task is unnecessary.
- Read the relevant files before planning. Don't guess at code structure.

# Plan Format

Your plan MUST follow this structure:

## Files to Change
List every file you'll touch and what you'll do in each:
- \`path/to/file.ts\`  - what changes and why
- \`path/to/other.ts\`  - what changes and why

## Approach
Numbered steps. Each step should name the specific file, function, or code location.
Be concrete: "Add a \`rateLimit\` middleware in \`server.ts:handleRequest\`" not "add rate limiting".

## Scope
- Estimated files changed: N
- New files created: N
- Dependencies added: none | list them
- Risk level: low | medium | high (and why)

# Task
${task}`;

	let messages: Message[];

	if (previousMessages && judgeFeedback) {
		// Revision: reuse the planner's prior file-reading context,
		// append concise judge feedback so it doesn't re-read everything.
		messages = [
			...previousMessages,
			{
				role: "user",
				content: `Your previous plan was reviewed and needs revision. Address these concerns and produce a new plan using the same format.

# Judge Feedback
${judgeFeedback}

Revise your plan. You already have the codebase context from your previous file reads  - don't re-read files unless the feedback requires looking at something new.`,
			},
		];
	} else {
		messages = [{ role: "user", content: planPrompt }];
	}

	const spinnerLabel = thinking ? "planning (with thinking)" : "planning";
	const spinner = new Spinner(spinnerLabel).start();
	const planStream = new PlanStream();

	// Let the planner do read-only tool calls to gather context
	for (let round = 0; round < 10; round++) {
		if (signal?.aborted) break;
		const planChunks: string[] = [];

		const result = await streamMessage({
			model,
			system,
			messages,
			tools: readOnlyTools,
			signal,
			thinking,
			callbacks: {
				onText: (text) => {
					// Stop spinner and open panel on first text
					spinner.stop();
					planStream.open();
					planStream.write(text);
					planChunks.push(text);
				},
			},
		});

		totalUsage = addUsage(totalUsage, result.usage);

		const toolUses = result.content.filter(
			(b): b is ToolUseBlock => b.type === "tool_use",
		);

		if (toolUses.length === 0) {
			spinner.stop();
			planStream.close();
			const plan = planChunks.join("");
			messages.push({ role: "assistant", content: result.content });
			return { plan, usage: totalUsage, messages };
		}

		messages.push({ role: "assistant", content: result.content });

		spinner.stop();
		const results = await executeReadOnlyTools({
			toolUses,
			denyMessage: "Tool not available in planning mode",
			promptOnEscape: true,
		});

		spinner.start();
		messages.push({ role: "user", content: results });
	}

	spinner.stop();
	const reason = signal?.aborted
		? "(planning interrupted)"
		: "(planner reached max rounds)";
	return { plan: reason, usage: totalUsage, messages };
}

// --- Judge Pass ---

const MAX_JUDGE_ROUNDS = 8;

export async function judgePass(
	task: string,
	plan: string,
	model: string,
	signal?: AbortSignal,
): Promise<{ review: JudgeReview; usage: TokenUsage }> {
	const spinner = new Spinner("judging").start();
	const judgePrompt = getJudgePrompt();
	const readOnlyTools = getReadOnlyToolDefinitions();

	const userMessage = `# Original Task
${task}

# Proposed Plan
${plan}

Review this plan. You have read-only tools to verify claims in the plan (check if files/functions exist, read relevant code). Use them if needed, then call submit_review with your verdict.`;

	const judgeTools = [...readOnlyTools, SUBMIT_REVIEW_TOOL];
	const messages: Message[] = [{ role: "user", content: userMessage }];
	let totalUsage = emptyUsage();

	for (let round = 0; round < MAX_JUDGE_ROUNDS; round++) {
		if (signal?.aborted) break;
		const result = await streamMessage({
			model,
			system: judgePrompt,
			messages,
			tools: judgeTools,
			signal,
		});

		totalUsage = addUsage(totalUsage, result.usage);

		const toolUses = result.content.filter(
			(b): b is ToolUseBlock => b.type === "tool_use",
		);

		// Check if judge submitted its review
		const reviewCall = toolUses.find((t) => t.name === "submit_review");
		if (reviewCall) {
			spinner.stop();
			const review = parseSubmitReview(
				reviewCall.input as Record<string, unknown>,
			);
			return { review, usage: totalUsage };
		}

		// No submit_review  - must be read-only tool calls. Execute them.
		if (toolUses.length === 0) {
			// Judge ended without submitting review  - extract from text as fallback
			spinner.stop();
			const raw = result.content
				.filter((b) => b.type === "text")
				.map((b) => (b.type === "text" ? b.text : ""))
				.join("\n");
			const review = parseJudgeResponse(raw);
			return { review, usage: totalUsage };
		}

		messages.push({ role: "assistant", content: result.content });

		spinner.stop();
		const toolContent = await executeReadOnlyTools({
			toolUses,
			denyMessage: "Tool not available in judge mode",
			promptOnEscape: false,
		});

		spinner.start();
		messages.push({ role: "user", content: toolContent });
	}

	// If aborted, return a neutral fallback without making another API call
	if (signal?.aborted) {
		spinner.stop();
		return {
			review: {
				verdict: "looks-good",
				explanation: "Judge interrupted - no verdict rendered.",
				concerns: [],
				simplerAlternative: null,
				questions: [],
				raw: "(interrupted)",
			},
			usage: totalUsage,
		};
	}

	// Max rounds exhausted  - force a verdict by offering only submit_review
	messages.push({
		role: "user",
		content:
			"You have used all available research rounds. Submit your review now based on what you've seen so far.",
	});

	const finalResult = await streamMessage({
		model,
		system: judgePrompt,
		messages,
		tools: [SUBMIT_REVIEW_TOOL],
		signal,
	});

	totalUsage = addUsage(totalUsage, finalResult.usage);
	spinner.stop();

	const finalReviewCall = finalResult.content.find(
		(b): b is ToolUseBlock =>
			b.type === "tool_use" && b.name === "submit_review",
	);

	if (finalReviewCall) {
		const review = parseSubmitReview(
			finalReviewCall.input as Record<string, unknown>,
		);
		return { review, usage: totalUsage };
	}

	// Absolute last resort  - extract from text
	const raw = finalResult.content
		.filter((b) => b.type === "text")
		.map((b) => (b.type === "text" ? b.text : ""))
		.join("\n");
	return { review: parseJudgeResponse(raw), usage: totalUsage };
}

export function parseSubmitReview(input: Record<string, unknown>): JudgeReview {
	const verdict = (input.verdict as string)?.toLowerCase() as JudgeVerdict;
	const explanation = (input.explanation as string) || null;
	const concerns = Array.isArray(input.concerns)
		? (input.concerns as string[]).filter(Boolean)
		: [];
	const simplerAlt = (input.simpler_alternative as string) || null;
	const questions = Array.isArray(input.questions)
		? (input.questions as string[]).filter(Boolean)
		: [];

	return {
		verdict: verdict || "pushback",
		explanation,
		concerns,
		simplerAlternative: simplerAlt,
		questions,
		raw: JSON.stringify(input, null, 2),
	};
}

/** Fallback parser for when the judge responds with free text instead of tool use. */
export function parseJudgeResponse(raw: string): JudgeReview {
	const verdictMatch = raw.match(/VERDICT:\s*(looks-good|pushback|hard-no)/i);
	const verdict: JudgeVerdict =
		(verdictMatch?.[1]?.toLowerCase() as JudgeVerdict) ?? "pushback";

	const explanation = extractSectionText(raw, "EXPLANATION");
	const concerns = extractSection(raw, "CONCERNS");
	const simplerAlt = extractSectionText(raw, "SIMPLER ALTERNATIVE");
	const questions = extractSection(raw, "QUESTIONS");

	return {
		verdict,
		explanation: explanation?.toLowerCase() === "none" ? null : explanation,
		concerns: concerns.filter((c) => c.toLowerCase() !== "none"),
		simplerAlternative:
			simplerAlt?.toLowerCase() === "none" ? null : simplerAlt,
		questions: questions.filter((q) => q.toLowerCase() !== "none"),
		raw,
	};
}

function extractSection(text: string, heading: string): string[] {
	const regex = new RegExp(`${heading}:\\s*\\n([\\s\\S]*?)(?=\\n[A-Z]|$)`, "i");
	const match = text.match(regex);
	if (!match) return [];
	return match[1]
		.split("\n")
		.map((l) => l.replace(/^[-•*]\s*/, "").trim())
		.filter(Boolean);
}

function extractSectionText(text: string, heading: string): string | null {
	const regex = new RegExp(`${heading}:\\s*\\n([\\s\\S]*?)(?=\\n[A-Z]|$)`, "i");
	const match = text.match(regex);
	if (!match) return null;
	return match[1].trim() || null;
}

// --- User Decision ---

export async function promptDecision(
	verdict?: JudgeVerdict,
): Promise<UserDecision> {
	const blocked = verdict === "hard-no";
	const prompt = blocked
		? `\n  ${chalk.dim("[r]evise")}  ${chalk.dim("[c]ancel")}  `
		: `\n  ${chalk.bold("[g]o")}  ${chalk.dim("[r]evise")}  ${chalk.dim("[s]kip judge")}  ${chalk.dim("[c]ancel")}  `;

	const answer = await ask(prompt);

	if (answer === null) return "cancel";

	const a = answer.trim().toLowerCase();
	switch (a) {
		case "g":
		case "go":
		case "":
			return blocked ? "cancel" : "go";
		case "r":
		case "revise":
			return "revise";
		case "s":
		case "skip":
			return blocked ? "cancel" : "skip";
		default:
			return "cancel";
	}
}
