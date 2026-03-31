import type Anthropic from "@anthropic-ai/sdk";
import chalk from "chalk";
import { streamMessage, toolResult } from "./client";
import type { NoConfig } from "./config";
import { trimHistory } from "./history";
import {
	classifyComplexity,
	judgePass,
	plannerPass,
	promptDecision,
} from "./judge";
import { checkPermission } from "./permissions";
import { ask } from "./prompt";
import { getSystemPrompt } from "./prompts/system";
import { toolEscapesProject } from "./sandbox";
import { getAllToolDefinitions, getTool } from "./tools/index";
import type {
	InternalTool,
	JudgeReview,
	Message,
	TokenUsage,
	ToolUseBlock,
} from "./types";
import { addUsage, emptyUsage } from "./types";
import {
	createTextStream,
	fmtToolArgs,
	fmtToolCall,
	fmtToolDenied,
	fmtToolErr,
	fmtToolOk,
	judgePanel,
	type Spinner,
	showEditDiff,
	showWritePreview,
	summarizeOutput,
} from "./ui";

const MAX_TOOL_ROUNDS = 30;
const MAX_REVISIONS = 2;

/** Extract file paths mentioned in the plan for scope tracking. */
function extractPlannedFiles(messages: Message[]): Set<string> {
	const paths = new Set<string>();
	// Match backtick-wrapped paths and common path patterns in plan text
	const pathPattern = /`([^`]*\.[a-zA-Z]{1,10})`/g;
	const loosePathPattern = /(?:^|\s)((?:[\w.-]+\/)+[\w.-]+\.\w{1,10})\b/g;

	for (const msg of messages) {
		const text =
			typeof msg.content === "string"
				? msg.content
				: msg.content
						.map((b) => {
							if ("text" in b && typeof b.text === "string") return b.text;
							return "";
						})
						.join("\n");

		for (const match of text.matchAll(pathPattern)) {
			paths.add(match[1]);
		}
		for (const match of text.matchAll(loosePathPattern)) {
			paths.add(match[1]);
		}
	}
	return paths;
}

/** Check if a file path matches any path in the planned scope. */
function isInPlannedScope(
	filePath: string,
	plannedFiles: Set<string>,
): boolean {
	// Normalize: strip leading ./ and compare basenames as fallback
	const normalize = (p: string) => p.replace(/^\.\//, "").replace(/\\/g, "/");
	const normalized = normalize(filePath);

	for (const planned of plannedFiles) {
		const normalizedPlanned = normalize(planned);
		if (
			normalized === normalizedPlanned ||
			normalized.endsWith(normalizedPlanned) ||
			normalizedPlanned.endsWith(normalized)
		) {
			return true;
		}
	}
	return false;
}

/** Build a concise summary of judge feedback for the planner revision prompt. */
function summarizeJudgeFeedback(review: JudgeReview): string {
	const parts: string[] = [];
	parts.push(`Verdict: ${review.verdict}`);
	if (review.explanation) {
		parts.push(review.explanation);
	}
	if (review.concerns.length > 0) {
		parts.push("Concerns:");
		for (const c of review.concerns) {
			parts.push(`- ${c}`);
		}
	}
	if (review.simplerAlternative) {
		parts.push(`Simpler alternative: ${review.simplerAlternative}`);
	}
	if (review.questions.length > 0) {
		parts.push("Questions:");
		for (const q of review.questions) {
			parts.push(`- ${q}`);
		}
	}
	return parts.join("\n");
}

export interface AgentRunResult {
	usage: TokenUsage;
}

export interface RunOptions {
	task: string;
	history: Message[];
	model: string;
	judgeModel: string;
	thinking: NoConfig["thinking"];
	dryRun?: boolean;
	signal?: AbortSignal;
}

export async function runWithJudge(opts: RunOptions): Promise<AgentRunResult> {
	const { history, model, judgeModel, signal } = opts;
	const task = opts.task;
	const complexity = classifyComplexity(task);

	// Dry run: always run the judge, never execute
	if (opts.dryRun) {
		let totalUsage = emptyUsage();
		const useThinking =
			opts.thinking === "always" ||
			(opts.thinking === "complex" && complexity === "complex");

		const planResult = await plannerPass(task, model, signal, useThinking);
		totalUsage = addUsage(totalUsage, planResult.usage);

		const { review, usage: judgeUsage } = await judgePass(
			task,
			planResult.plan,
			judgeModel,
			signal,
		);
		totalUsage = addUsage(totalUsage, judgeUsage);
		judgePanel(review);

		console.log(chalk.dim("\n  dry run  - not executing\n"));
		return { usage: totalUsage };
	}

	// Simple tasks skip the judge
	if (complexity === "simple") {
		console.log(chalk.dim("  simple task  - skipping judge"));
		return runAgent(task, history, model, undefined, signal);
	}

	let totalUsage = emptyUsage();
	let revisions = 0;
	let lastReview: JudgeReview | undefined;
	const useThinking =
		opts.thinking === "always" ||
		(opts.thinking === "complex" && complexity === "complex");

	// Plan -> Judge -> Decision loop
	let previousPlannerMessages: Message[] | undefined;
	let userFeedback: string | undefined;
	while (revisions <= MAX_REVISIONS) {
		if (signal?.aborted) break;

		// Build revision feedback from judge + optional user input
		let revisionFeedback: string | undefined;
		if (previousPlannerMessages && lastReview) {
			const parts = [summarizeJudgeFeedback(lastReview)];
			if (userFeedback) {
				parts.push(`\nUser feedback: ${userFeedback}`);
			}
			revisionFeedback = parts.join("\n");
		}

		const planResult = await plannerPass(
			task,
			model,
			signal,
			useThinking,
			previousPlannerMessages,
			revisionFeedback,
		);
		totalUsage = addUsage(totalUsage, planResult.usage);

		if (signal?.aborted) break;

		const { review, usage: judgeUsage } = await judgePass(
			task,
			planResult.plan,
			judgeModel,
			signal,
		);
		totalUsage = addUsage(totalUsage, judgeUsage);
		lastReview = review;

		judgePanel(review);

		const decision = await promptDecision(review.verdict);

		switch (decision) {
			case "go":
			case "skip": {
				console.log();
				const result = await runAgent(
					task,
					history,
					model,
					planResult.messages,
					signal,
				);
				totalUsage = addUsage(totalUsage, result.usage);
				return { usage: totalUsage };
			}
			case "cancel":
				console.log(chalk.dim("\n  cancelled\n"));
				return { usage: totalUsage };
			case "revise":
				revisions++;
				if (revisions > MAX_REVISIONS) {
					console.log(
						chalk.yellow("\n  max revisions reached  - go, skip, or cancel?\n"),
					);
					const finalDecision = await promptDecision();
					if (finalDecision === "go" || finalDecision === "skip") {
						const result = await runAgent(
							task,
							history,
							model,
							planResult.messages,
							signal,
						);
						totalUsage = addUsage(totalUsage, result.usage);
						return { usage: totalUsage };
					}
					console.log(chalk.dim("\n  cancelled\n"));
					return { usage: totalUsage };
				}
				// Ask for optional user feedback to guide the revision
				{
					const note = await ask(
						chalk.dim("  feedback (optional, enter to skip): "),
					);
					userFeedback = note?.trim() || undefined;
				}
				// Preserve planner's file-reading context for revision
				previousPlannerMessages = planResult.messages;
				console.log(chalk.dim("\n  re-planning with feedback...\n"));
				break;
		}
	}

	return { usage: totalUsage };
}

export async function runAgent(
	task: string,
	history: Message[],
	model: string,
	plannerContext?: Message[],
	signal?: AbortSignal,
	spinner?: Spinner,
): Promise<AgentRunResult> {
	let totalUsage = emptyUsage();
	const system = getSystemPrompt(process.cwd());
	const tools = getAllToolDefinitions();

	// Track planned vs actual file scope
	const plannedFiles = plannerContext
		? extractPlannedFiles(plannerContext)
		: null;
	const touchedOutOfScope = new Set<string>();

	let messages: Message[];

	if (plannerContext && plannerContext.length > 0) {
		messages = [
			...history,
			...plannerContext,
			{
				role: "user",
				content: `Your plan was approved. Now execute it. You already have the codebase context from planning  - don't re-read files you've already seen. Use write_file, edit_file, and bash as needed.\n\nOriginal task: ${task}`,
			},
		];
	} else {
		messages = [...history, { role: "user", content: task }];
	}

	const writeText = createTextStream();

	for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
		if (signal?.aborted) break;

		trimHistory(messages, model);

		// Stop spinner before streaming starts (if one is active)
		let spinnerStopped = false;

		const result = await streamMessage({
			model,
			system,
			messages,
			tools,
			signal,
			callbacks: {
				onText: (text) => {
					if (spinner && !spinnerStopped) {
						spinner.stop();
						spinnerStopped = true;
					}
					writeText(text);
				},
			},
		});

		if (spinner && !spinnerStopped) {
			spinner.stop();
			spinnerStopped = true;
		}
		// Only use spinner for the first round
		spinner = undefined;

		totalUsage = addUsage(totalUsage, result.usage);

		// Collect tool use blocks
		const toolUses = result.content.filter(
			(b): b is ToolUseBlock => b.type === "tool_use",
		);

		// If no tool calls, we're done
		if (toolUses.length === 0) {
			const hasText = result.content.some(
				(b) => b.type === "text" && b.text.trim(),
			);
			if (hasText) console.log();
			break;
		}

		// Add assistant message to history
		messages.push({ role: "assistant", content: result.content });

		// Categorize tool calls: read-only run in parallel, writes run sequentially
		const readOnly: Array<{ toolUse: ToolUseBlock; tool: InternalTool }> = [];
		const writes: Array<{ toolUse: ToolUseBlock; tool: InternalTool }> = [];
		const rejected: Anthropic.ToolResultBlockParam[] = [];

		for (const toolUse of toolUses) {
			const tool = getTool(toolUse.name);
			const input = toolUse.input as Record<string, unknown>;
			console.log(fmtToolCall(toolUse.name, fmtToolArgs(toolUse.name, input)));

			if (!tool) {
				rejected.push(
					toolResult(toolUse.id, `Unknown tool: ${toolUse.name}`, true),
				);
				continue;
			}

			if (tool.readOnly && !toolEscapesProject(input)) {
				readOnly.push({ toolUse, tool });
			} else {
				writes.push({ toolUse, tool });
			}
		}

		// Execute read-only tools in parallel
		const readResults = await Promise.all(
			readOnly.map(async ({ toolUse, tool }) => {
				try {
					const output = await tool.execute(
						toolUse.input as Record<string, unknown>,
						signal,
					);
					console.log(fmtToolOk(summarizeOutput(toolUse.name, output)));
					return toolResult(toolUse.id, output);
				} catch (err) {
					const errMsg = err instanceof Error ? err.message : String(err);
					console.log(fmtToolErr(errMsg));
					return toolResult(toolUse.id, `Error: ${errMsg}`, true);
				}
			}),
		);

		// Execute write tools sequentially (need permission prompts, scope checks)
		const writeResults: Anthropic.ToolResultBlockParam[] = [];
		for (const { toolUse, tool } of writes) {
			if (signal?.aborted) break;
			const input = toolUse.input as Record<string, unknown>;

			// Scope check
			if (plannedFiles && !tool.readOnly && toolUse.name !== "bash") {
				const filePath = (input.path ?? input.file) as string | undefined;
				if (
					filePath &&
					!isInPlannedScope(filePath, plannedFiles) &&
					!touchedOutOfScope.has(filePath)
				) {
					touchedOutOfScope.add(filePath);
					console.log(
						chalk.yellow(`  warning: outside plan scope: ${filePath}`),
					);
				}
			}

			if (toolUse.name === "edit_file") {
				showEditDiff(input);
			} else if (toolUse.name === "write_file") {
				showWritePreview(input);
			}

			const needsApproval = tool.requiresApproval || toolEscapesProject(input);
			if (needsApproval) {
				const label = toolEscapesProject(input)
					? `${toolUse.name} (outside project)`
					: toolUse.name;
				const allowed = await checkPermission(label, input);
				if (!allowed) {
					writeResults.push(
						toolResult(toolUse.id, "Permission denied by user", true),
					);
					console.log(fmtToolDenied());
					continue;
				}
			}

			try {
				const output = await tool.execute(input, signal);
				writeResults.push(toolResult(toolUse.id, output));
				console.log(fmtToolOk(summarizeOutput(toolUse.name, output)));
			} catch (err) {
				const errMsg = err instanceof Error ? err.message : String(err);
				writeResults.push(toolResult(toolUse.id, `Error: ${errMsg}`, true));
				console.log(fmtToolErr(errMsg));
			}
		}

		const results = [...rejected, ...readResults, ...writeResults];

		messages.push({ role: "user", content: results });
	}

	// Update history in place
	history.length = 0;
	history.push(...messages);

	return { usage: totalUsage };
}
