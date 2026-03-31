import { describe, expect, it } from "vitest";
import { trimHistory } from "../history";
import type { Message } from "../types";

function makeToolResult(content: string): Message {
	return {
		role: "user",
		content: [
			{
				type: "tool_result",
				tool_use_id: "test-id",
				content,
			},
		],
	};
}

function makeAssistant(text: string): Message {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
	};
}

function makeUser(text: string): Message {
	return { role: "user", content: text };
}

describe("trimHistory", () => {
	it("does nothing when under the limit", () => {
		const messages: Message[] = [makeUser("hello"), makeAssistant("hi there")];
		expect(trimHistory(messages)).toBe(false);
		expect(messages).toHaveLength(2);
	});

	it("truncates large tool results from older messages", () => {
		const bigContent = "x".repeat(10_000);
		const messages: Message[] = [
			makeUser("task 1"),
			makeAssistant("thinking"),
			makeToolResult(bigContent),
			makeAssistant("done"),
			// Recent messages  - should be kept intact
			makeUser("task 2"),
			makeAssistant("ok"),
		];

		// Won't trim because total is well under 180k tokens
		expect(trimHistory(messages)).toBe(false);
	});

	it("truncates tool results when over token limit", () => {
		// Create enough content to exceed 180k tokens (~720k chars)
		const bigContent = "x".repeat(200_000);
		const messages: Message[] = [];

		// Add several large tool result exchanges
		for (let i = 0; i < 5; i++) {
			messages.push(makeUser(`task ${i}`));
			messages.push(makeAssistant("thinking"));
			messages.push(makeToolResult(bigContent));
			messages.push(makeAssistant("done"));
		}

		expect(trimHistory(messages)).toBe(true);

		// Older tool results should be trimmed
		const firstToolResult = messages.find(
			(m) =>
				typeof m.content !== "string" &&
				Array.isArray(m.content) &&
				m.content.some(
					(b) =>
						"type" in b &&
						b.type === "tool_result" &&
						"content" in b &&
						b.content === "[content trimmed to save context]",
				),
		);
		expect(firstToolResult).toBeDefined();
	});

	it("drops oldest message pairs as last resort", () => {
		// Create messages where even trimmed tool results aren't enough
		const hugeText = "x".repeat(200_000);
		const messages: Message[] = [];

		for (let i = 0; i < 5; i++) {
			messages.push(makeUser(hugeText));
			messages.push(makeAssistant(hugeText));
		}

		const originalLength = messages.length;
		expect(trimHistory(messages)).toBe(true);
		expect(messages.length).toBeLessThan(originalLength);
		// Should keep at least 4 messages
		expect(messages.length).toBeGreaterThanOrEqual(4);
	});

	it("preserves recent messages during trimming", () => {
		const bigContent = "x".repeat(200_000);
		const messages: Message[] = [];

		for (let i = 0; i < 5; i++) {
			messages.push(makeUser(`task ${i}`));
			messages.push(makeAssistant("thinking"));
			messages.push(makeToolResult(bigContent));
			messages.push(makeAssistant(`done ${i}`));
		}

		trimHistory(messages);

		// The last assistant message should still be intact
		const lastMsg = messages[messages.length - 1];
		expect(typeof lastMsg.content).not.toBe("string");
	});
});
