import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PROJECT_ROOT } from "../sandbox";
import type { InternalTool } from "../types";

export const readFileTool: InternalTool = {
	definition: {
		name: "read_file",
		description:
			"Read the contents of a file. Returns the file with line numbers. Use offset and limit to read specific portions of large files.",
		input_schema: {
			type: "object" as const,
			properties: {
				path: {
					type: "string",
					description:
						"Path to the file (relative to project root, or absolute)",
				},
				offset: {
					type: "number",
					description: "Line number to start reading from (1-based). Optional.",
				},
				limit: {
					type: "number",
					description:
						"Maximum number of lines to read. Optional, defaults to 2000.",
				},
			},
			required: ["path"],
		},
	},
	readOnly: true,
	requiresApproval: false,
	async execute(input) {
		const path = resolve(PROJECT_ROOT, input.path as string);
		const offset = ((input.offset as number) ?? 1) - 1;
		const limit = (input.limit as number) ?? 2000;

		const raw = await readFile(path, "utf-8");
		const lines = raw.split("\n");
		const sliced = lines.slice(offset, offset + limit);

		const numbered = sliced
			.map((line, i) => `${String(offset + i + 1).padStart(5)}  ${line}`)
			.join("\n");

		const header =
			lines.length > sliced.length
				? `[Showing lines ${offset + 1}-${offset + sliced.length} of ${lines.length}]\n`
				: "";
		return header + numbered;
	},
};
