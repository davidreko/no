import { describe, expect, it } from "vitest";
import { isOutsideProject, toolEscapesProject } from "../sandbox";

describe("isOutsideProject", () => {
	it("allows relative paths within project", () => {
		expect(isOutsideProject("src/main.ts")).toBe(false);
		expect(isOutsideProject("./foo/bar.ts")).toBe(false);
		expect(isOutsideProject("package.json")).toBe(false);
	});

	it("flags paths that escape via ..", () => {
		expect(isOutsideProject("../other-project/file.ts")).toBe(true);
		expect(isOutsideProject("../../file.ts")).toBe(true);
		expect(isOutsideProject("src/../../file.ts")).toBe(true);
	});

	it("allows deeply nested paths", () => {
		expect(isOutsideProject("src/tools/deep/nested/file.ts")).toBe(false);
	});
});

describe("toolEscapesProject", () => {
	it("detects escaped path field", () => {
		expect(toolEscapesProject({ path: "../secret" })).toBe(true);
	});

	it("allows in-project path field", () => {
		expect(toolEscapesProject({ path: "src/main.ts" })).toBe(false);
	});

	it("returns false when no path field", () => {
		expect(toolEscapesProject({ command: "echo hi" })).toBe(false);
	});

	it("returns false for empty input", () => {
		expect(toolEscapesProject({})).toBe(false);
	});
});
