import Anthropic, {
	AuthenticationError,
	InternalServerError,
	RateLimitError,
} from "@anthropic-ai/sdk";
import type {
	Message,
	TokenUsage,
	ToolDefinition,
	ToolResultBlockParam,
} from "./types";

let client: Anthropic | null = null;
const MAX_RETRIES = 1;
const RETRY_DELAY_MS = 2000;

export function getClient(): Anthropic {
	if (!client) {
		client = new Anthropic();
	}
	return client;
}

export interface StreamCallbacks {
	onText?: (text: string) => void;
	onThinking?: (text: string) => void;
	onToolUse?: (
		id: string,
		name: string,
		input: Record<string, unknown>,
	) => void;
	onUsage?: (usage: TokenUsage) => void;
}

export interface StreamResult {
	content: Anthropic.ContentBlock[];
	stopReason: string | null;
	usage: TokenUsage;
}

export async function streamMessage(opts: {
	model: string;
	system: string;
	messages: Message[];
	tools: ToolDefinition[];
	maxTokens?: number;
	thinking?: boolean;
	callbacks?: StreamCallbacks;
	signal?: AbortSignal;
}): Promise<StreamResult> {
	const anthropic = getClient();

	const content: Anthropic.ContentBlock[] = [];
	let stopReason: string | null = null;
	const usage: TokenUsage = {
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheCreationTokens: 0,
	};

	const params: Record<string, unknown> = {
		model: opts.model,
		max_tokens: opts.maxTokens ?? (opts.thinking ? 16384 : 8192),
		system: [
			{
				type: "text" as const,
				text: opts.system,
				cache_control: { type: "ephemeral" as const },
			},
		],
		messages: opts.messages,
		tools: opts.tools.map((t) => ({
			name: t.name,
			description: t.description,
			input_schema: t.input_schema,
		})),
	};

	if (opts.thinking) {
		params.thinking = { type: "adaptive" };
	}

	let attempts = 0;
	let finalMessage: Anthropic.Message;

	while (true) {
		try {
			const stream = anthropic.messages.stream(
				params as unknown as Anthropic.MessageCreateParamsStreaming,
				{ signal: opts.signal },
			);

			stream.on("text", (text) => {
				opts.callbacks?.onText?.(text);
			});

			if (opts.thinking) {
				stream.on("thinking", (thinkingDelta) => {
					opts.callbacks?.onThinking?.(thinkingDelta);
				});
			}

			finalMessage = await stream.finalMessage();
			break;
		} catch (err) {
			if (err instanceof AuthenticationError) {
				throw new Error(
					"Invalid API key  - check your ANTHROPIC_API_KEY environment variable",
				);
			}
			if (
				(err instanceof RateLimitError || err instanceof InternalServerError) &&
				attempts < MAX_RETRIES &&
				!opts.signal?.aborted
			) {
				attempts++;
				await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
				continue;
			}
			throw err;
		}
	}

	for (const block of finalMessage.content) {
		content.push(block);
		if (block.type === "tool_use") {
			opts.callbacks?.onToolUse?.(
				block.id,
				block.name,
				block.input as Record<string, unknown>,
			);
		}
	}

	stopReason = finalMessage.stop_reason;
	usage.inputTokens = finalMessage.usage.input_tokens;
	usage.outputTokens = finalMessage.usage.output_tokens;
	usage.cacheReadTokens = finalMessage.usage.cache_read_input_tokens ?? 0;
	usage.cacheCreationTokens =
		finalMessage.usage.cache_creation_input_tokens ?? 0;
	opts.callbacks?.onUsage?.(usage);

	return { content, stopReason, usage };
}

/** Build a tool_result block for the messages array. */
export function toolResult(
	toolUseId: string,
	content: string,
	isError?: boolean,
): ToolResultBlockParam {
	const result: ToolResultBlockParam = {
		type: "tool_result",
		tool_use_id: toolUseId,
		content,
	};
	if (isError) result.is_error = true;
	return result;
}
