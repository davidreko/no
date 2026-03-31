import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PROJECT_ROOT } from "../sandbox";
import type { InternalTool } from "../types";

export const editFileTool: InternalTool = {
	definition: {
		name: "edit_file",
		description:
			"Edit a file by replacing an exact string match. The old_string must appear exactly once in the file (unless replace_all is true).",
		input_schema: {
			type: "object" as const,
			properties: {
				path: {
					type: "string",
					description:
						"Path to the file (relative to project root, or absolute)",
				},
				old_string: {
					type: "string",
					description: "The exact text to find and replace",
				},
				new_string: {
					type: "string",
					description: "The replacement text",
				},
				replace_all: {
					type: "boolean",
					description: "Replace all occurrences (default false)",
				},
			},
			required: ["path", "old_string", "new_string"],
		},
	},
	readOnly: false,
	requiresApproval: true,
	async execute(input) {
		const path = resolve(PROJECT_ROOT, input.path as string);
		const oldStr = input.old_string as string;
		const newStr = input.new_string as string;
		const replaceAll = (input.replace_all as boolean) ?? false;

		const content = await readFile(path, "utf-8");

		const count = content.split(oldStr).length - 1;
		if (count === 0) {
			throw new Error(
				`old_string not found in ${path}. Make sure it matches exactly (including whitespace).`,
			);
		}
		if (count > 1 && !replaceAll) {
			throw new Error(
				`old_string found ${count} times in ${path}. Use replace_all: true or provide more context to make it unique.`,
			);
		}

		const updated = replaceAll
			? content.replaceAll(oldStr, newStr)
			: content.replace(oldStr, newStr);

		await writeFile(path, updated, "utf-8");

		return `Edited ${path} (${count} replacement${count > 1 ? "s" : ""})`;
	},
};
