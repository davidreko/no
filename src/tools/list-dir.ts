import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PROJECT_ROOT } from "../sandbox";
import type { InternalTool } from "../types";

export const listDirTool: InternalTool = {
	definition: {
		name: "list_dir",
		description:
			"List the contents of a directory, showing files and subdirectories with sizes.",
		input_schema: {
			type: "object" as const,
			properties: {
				path: {
					type: "string",
					description:
						"Directory path (relative to project root, or absolute). Defaults to project root.",
				},
			},
			required: [],
		},
	},
	readOnly: true,
	requiresApproval: false,
	async execute(input) {
		const dir = resolve(PROJECT_ROOT, (input.path as string) ?? ".");
		const entries = await readdir(dir);

		const results: string[] = [];
		for (const entry of entries) {
			if (entry === "node_modules" || entry === ".git") continue;
			try {
				const s = await stat(join(dir, entry));
				if (s.isDirectory()) {
					results.push(`${entry}/`);
				} else {
					const size = formatSize(s.size);
					results.push(`${entry}  (${size})`);
				}
			} catch {
				results.push(`${entry}  (inaccessible)`);
			}
		}

		return results.join("\n") || "(empty directory)";
	},
};

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
