import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bashTool } from "../tools/bash";
import { editFileTool } from "../tools/edit-file";
import { globTool } from "../tools/glob";
import { listDirTool } from "../tools/list-dir";
import { readFileTool } from "../tools/read-file";
import { writeFileTool } from "../tools/write-file";

let testDir: string;

beforeEach(async () => {
	testDir = join(tmpdir(), `no-test-${randomUUID()}`);
	await mkdir(testDir, { recursive: true });
});

afterEach(async () => {
	// Windows can hold file handles briefly after tests  - retry cleanup
	try {
		await rm(testDir, { recursive: true, force: true });
	} catch {
		// Best-effort cleanup; temp dir will be reclaimed by OS
	}
});

describe("read_file", () => {
	it("reads a file with line numbers", async () => {
		const filePath = join(testDir, "test.txt");
		await writeFile(filePath, "line one\nline two\nline three\n");

		const result = await readFileTool.execute({ path: filePath });
		expect(result).toContain("1  line one");
		expect(result).toContain("2  line two");
		expect(result).toContain("3  line three");
	});

	it("reads with offset and limit", async () => {
		const filePath = join(testDir, "test.txt");
		await writeFile(filePath, "a\nb\nc\nd\ne\n");

		const result = await readFileTool.execute({
			path: filePath,
			offset: 2,
			limit: 2,
		});
		expect(result).toContain("2  b");
		expect(result).toContain("3  c");
		expect(result).not.toContain("1  a");
		expect(result).not.toContain("4  d");
	});

	it("throws on nonexistent file", async () => {
		await expect(
			readFileTool.execute({ path: join(testDir, "nope.txt") }),
		).rejects.toThrow();
	});
});

describe("write_file", () => {
	it("creates a new file", async () => {
		const filePath = join(testDir, "new.txt");
		const result = await writeFileTool.execute({
			path: filePath,
			content: "hello world",
		});

		expect(result).toContain("Created");
		const content = await readFile(filePath, "utf-8");
		expect(content).toBe("hello world");
	});

	it("creates parent directories", async () => {
		const filePath = join(testDir, "deep", "nested", "file.txt");
		await writeFileTool.execute({
			path: filePath,
			content: "nested content",
		});

		const content = await readFile(filePath, "utf-8");
		expect(content).toBe("nested content");
	});

	it("overwrites existing file", async () => {
		const filePath = join(testDir, "existing.txt");
		await writeFile(filePath, "old content");

		const result = await writeFileTool.execute({
			path: filePath,
			content: "new content",
		});

		expect(result).toContain("Updated");
		const content = await readFile(filePath, "utf-8");
		expect(content).toBe("new content");
	});
});

describe("edit_file", () => {
	it("replaces a unique string", async () => {
		const filePath = join(testDir, "edit.txt");
		await writeFile(filePath, "hello world");

		const result = await editFileTool.execute({
			path: filePath,
			old_string: "world",
			new_string: "universe",
		});

		expect(result).toContain("1 replacement");
		const content = await readFile(filePath, "utf-8");
		expect(content).toBe("hello universe");
	});

	it("throws when old_string not found", async () => {
		const filePath = join(testDir, "edit.txt");
		await writeFile(filePath, "hello world");

		await expect(
			editFileTool.execute({
				path: filePath,
				old_string: "missing",
				new_string: "replaced",
			}),
		).rejects.toThrow("not found");
	});

	it("throws when old_string has multiple matches without replace_all", async () => {
		const filePath = join(testDir, "edit.txt");
		await writeFile(filePath, "foo bar foo baz foo");

		await expect(
			editFileTool.execute({
				path: filePath,
				old_string: "foo",
				new_string: "qux",
			}),
		).rejects.toThrow("3 times");
	});

	it("replaces all occurrences with replace_all", async () => {
		const filePath = join(testDir, "edit.txt");
		await writeFile(filePath, "foo bar foo baz foo");

		const result = await editFileTool.execute({
			path: filePath,
			old_string: "foo",
			new_string: "qux",
			replace_all: true,
		});

		expect(result).toContain("3 replacements");
		const content = await readFile(filePath, "utf-8");
		expect(content).toBe("qux bar qux baz qux");
	});
});

describe("list_dir", () => {
	it("lists files and directories", async () => {
		await writeFile(join(testDir, "file.txt"), "content");
		await mkdir(join(testDir, "subdir"));

		const result = await listDirTool.execute({ path: testDir });
		expect(result).toContain("file.txt");
		expect(result).toContain("subdir/");
	});

	it("shows file sizes", async () => {
		await writeFile(join(testDir, "file.txt"), "hello");
		const result = await listDirTool.execute({ path: testDir });
		expect(result).toContain("file.txt");
		expect(result).toMatch(/\d+B/);
	});
});

describe("glob", () => {
	it("finds files matching a pattern", async () => {
		await writeFile(join(testDir, "foo.ts"), "");
		await writeFile(join(testDir, "bar.ts"), "");
		await writeFile(join(testDir, "baz.js"), "");

		const result = await globTool.execute({
			pattern: "*.ts",
			path: testDir,
		});
		expect(result).toContain("foo.ts");
		expect(result).toContain("bar.ts");
		expect(result).not.toContain("baz.js");
	});

	it("returns message when no files match", async () => {
		const result = await globTool.execute({
			pattern: "*.xyz",
			path: testDir,
		});
		expect(result).toContain("No files matching");
	});
});

describe("bash", () => {
	it("executes a command and returns output", async () => {
		const result = await bashTool.execute({ command: "echo hello" });
		expect(result.trim()).toBe("hello");
	});

	it("captures stderr", async () => {
		const result = await bashTool.execute({
			command: "echo error >&2",
		});
		expect(result).toContain("[stderr]");
		expect(result).toContain("error");
	});

	it("reports exit codes", async () => {
		const result = await bashTool.execute({ command: "exit 42" });
		expect(result).toContain("[exit code");
	});

	it("is marked as requiring approval", () => {
		expect(bashTool.requiresApproval).toBe(true);
		expect(bashTool.readOnly).toBe(false);
	});
});

describe("tool registry", () => {
	it("read-only tools don't require approval", () => {
		expect(readFileTool.readOnly).toBe(true);
		expect(readFileTool.requiresApproval).toBe(false);
		expect(listDirTool.readOnly).toBe(true);
		expect(listDirTool.requiresApproval).toBe(false);
		expect(globTool.readOnly).toBe(true);
		expect(globTool.requiresApproval).toBe(false);
	});

	it("write tools require approval", () => {
		expect(writeFileTool.readOnly).toBe(false);
		expect(writeFileTool.requiresApproval).toBe(true);
		expect(editFileTool.readOnly).toBe(false);
		expect(editFileTool.requiresApproval).toBe(true);
	});
});
