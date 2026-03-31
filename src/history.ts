import chalk from "chalk";
import type { Message } from "./types";

// All current models have 200k context. Leave room for system prompt + tools + response.
// trimHistory() accepts a model param so this can become a per-model lookup when needed.
const CONTEXT_BUDGET = 180_000;

const TOOL_RESULT_TRIM_THRESHOLD = 2000; // chars  - tool results bigger than this get trimmed first
const TRIMMED_PLACEHOLDER = "[content trimmed to save context]";

/**
 * Rough token estimate: ~4 chars per token for English text / code.
 * Not exact, but good enough for trimming decisions.
 */
function estimateTokens(text: string): number {
	return Math.ceil(text.length / 3.5);
}

function messageText(msg: Message): string {
	if (typeof msg.content === "string") return msg.content;
	return msg.content
		.map((block) => {
			if ("text" in block && typeof block.text === "string") return block.text;
			if ("content" in block && typeof block.content === "string")
				return block.content;
			return JSON.stringify(block);
		})
		.join("\n");
}

function estimateMessageTokens(messages: Message[]): number {
	let total = 0;
	for (const msg of messages) {
		total += estimateTokens(messageText(msg));
	}
	return total;
}

/**
 * Trim conversation history to fit within context limits.
 * Strategy:
 * 1. First pass: truncate large tool_result content in older messages
 * 2. Second pass: drop oldest user/assistant pairs if still too large
 *
 * Mutates the array in place. Returns true if any trimming occurred.
 */
export function trimHistory(messages: Message[], _model?: string): boolean {
	const budget = CONTEXT_BUDGET;
	let totalTokens = estimateMessageTokens(messages);
	if (totalTokens <= budget) return false;

	let trimmed = false;

	// Pass 1: Truncate large tool results, oldest first
	for (let i = 0; i < messages.length - 4; i++) {
		const msg = messages[i];
		if (typeof msg.content === "string") continue;

		const blocks = msg.content as unknown as Array<Record<string, unknown>>;
		for (const block of blocks) {
			if (block.type !== "tool_result") continue;
			const content = block.content;
			if (typeof content !== "string") continue;
			if (
				content.length > TOOL_RESULT_TRIM_THRESHOLD &&
				content !== TRIMMED_PLACEHOLDER
			) {
				const saved =
					estimateTokens(content) - estimateTokens(TRIMMED_PLACEHOLDER);
				block.content = TRIMMED_PLACEHOLDER;
				totalTokens -= saved;
				trimmed = true;
			}
		}

		if (totalTokens <= budget) {
			console.log(chalk.dim("  (trimmed old tool results to fit context)"));
			return true;
		}
	}

	// Pass 2: Drop oldest messages (keep at least the last 4 messages)
	// Ensure we never leave an orphaned assistant/tool_result first (API requires user first)
	while (messages.length > 4 && totalTokens > budget) {
		const removed = messages.shift();
		if (removed) totalTokens -= estimateTokens(messageText(removed));
		trimmed = true;
		// Keep removing until the first message is a user message
		while (messages.length > 4 && messages[0]?.role !== "user") {
			const extra = messages.shift();
			if (extra) totalTokens -= estimateTokens(messageText(extra));
		}
	}

	if (trimmed) {
		console.log(chalk.dim("  (dropped old messages to fit context)"));
	}
	return trimmed;
}
