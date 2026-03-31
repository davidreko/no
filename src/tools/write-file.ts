import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { PROJECT_ROOT } from "../sandbox";
import type { InternalTool } from "../types";

export const writeFileTool: InternalTool = {
	definition: {
		name: "write_file",
		description:
			"Write content to a file. Creates the file and parent directories if they don't exist. Overwrites existing content.",
		input_schema: {
			type: "object" as const,
			properties: {
				path: {
					type: "string",
					description:
						"Path to the file (relative to project root, or absolute)",
				},
				content: {
					type: "string",
					description: "The content to write to the file",
				},
			},
			required: ["path", "content"],
		},
	},
	readOnly: false,
	requiresApproval: true,
	async execute(input) {
		const path = resolve(PROJECT_ROOT, input.path as string);
		const content = input.content as string;

		let existed = false;
		let oldContent = "";
		try {
			oldContent = await readFile(path, "utf-8");
			existed = true;
		} catch {
			// File doesn't exist yet
		}

		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, content, "utf-8");

		if (existed) {
			const oldLines = oldContent.split("\n").length;
			const newLines = content.split("\n").length;
			return `Updated ${path} (${oldLines} -> ${newLines} lines)`;
		}
		return `Created ${path} (${content.split("\n").length} lines)`;
	},
};
