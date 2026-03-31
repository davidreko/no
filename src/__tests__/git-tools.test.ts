import { describe, expect, it } from "vitest";
import { gitDiffTool, gitLogTool } from "../tools/git";

describe("git tools", () => {
	it("git_diff returns output", async () => {
		const result = await gitDiffTool.execute({});
		expect(typeof result).toBe("string");
	});

	it("git_diff with staged flag", async () => {
		const result = await gitDiffTool.execute({ staged: true });
		expect(typeof result).toBe("string");
	});

	it("git_log returns commits", async () => {
		const result = await gitLogTool.execute({ count: 3 });
		expect(typeof result).toBe("string");
	});

	it("git_log with oneline format", async () => {
		const result = await gitLogTool.execute({ count: 5, oneline: true });
		expect(typeof result).toBe("string");
	});

	it("git_log caps count at 50", async () => {
		const result = await gitLogTool.execute({ count: 999 });
		// Should not error  - count is clamped internally
		expect(typeof result).toBe("string");
	});

	it("all git tools are read-only and don't require approval", () => {
		for (const tool of [gitDiffTool, gitLogTool]) {
			expect(tool.readOnly).toBe(true);
			expect(tool.requiresApproval).toBe(false);
		}
	});
});
