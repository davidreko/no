import { describe, expect, it } from "vitest";
import {
	ALL_TOOLS,
	getAllToolDefinitions,
	getReadOnlyToolDefinitions,
	getTool,
} from "../tools/index";

describe("tool registry", () => {
	it("has 9 tools registered", () => {
		expect(ALL_TOOLS).toHaveLength(9);
	});

	it("getTool returns a tool by name", () => {
		const tool = getTool("read_file");
		expect(tool).toBeDefined();
		expect(tool?.definition.name).toBe("read_file");
	});

	it("getTool returns undefined for unknown tool", () => {
		expect(getTool("nonexistent")).toBeUndefined();
	});

	it("getAllToolDefinitions returns all 9 definitions", () => {
		const defs = getAllToolDefinitions();
		expect(defs).toHaveLength(9);
		const names = defs.map((d) => d.name);
		expect(names).toContain("read_file");
		expect(names).toContain("write_file");
		expect(names).toContain("edit_file");
		expect(names).toContain("bash");
		expect(names).toContain("glob");
		expect(names).toContain("grep");
		expect(names).toContain("list_dir");
		expect(names).toContain("git_diff");
		expect(names).toContain("git_log");
	});

	it("getReadOnlyToolDefinitions returns only read-only tools", () => {
		const defs = getReadOnlyToolDefinitions();
		const names = defs.map((d) => d.name);
		expect(names).toContain("read_file");
		expect(names).toContain("list_dir");
		expect(names).toContain("glob");
		expect(names).toContain("grep");
		expect(names).toContain("git_diff");
		expect(names).toContain("git_log");
		expect(names).not.toContain("write_file");
		expect(names).not.toContain("edit_file");
		expect(names).not.toContain("bash");
	});

	it("every tool definition has required fields", () => {
		for (const tool of ALL_TOOLS) {
			expect(tool.definition.name).toBeTruthy();
			expect(tool.definition.description).toBeTruthy();
			expect(tool.definition.input_schema).toBeDefined();
			expect(tool.definition.input_schema.type).toBe("object");
			expect(typeof tool.execute).toBe("function");
			expect(typeof tool.readOnly).toBe("boolean");
			expect(typeof tool.requiresApproval).toBe("boolean");
		}
	});
});
