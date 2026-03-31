import { stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { PROJECT_ROOT } from "../sandbox";
import type { InternalTool } from "../types";
import { buildGlobMatcher, walkFiles } from "./walk";

export const globTool: InternalTool = {
	definition: {
		name: "glob",
		description:
			"Find files matching a glob pattern. Returns file paths sorted by modification time.",
		input_schema: {
			type: "object" as const,
			properties: {
				pattern: {
					type: "string",
					description:
						'Glob pattern to match files (e.g. "**/*.ts", "src/**/*.json")',
				},
				path: {
					type: "string",
					description:
						"Directory to search in (relative to project root, or absolute). Defaults to project root.",
				},
			},
			required: ["pattern"],
		},
	},
	readOnly: true,
	requiresApproval: false,
	async execute(input) {
		const pattern = input.pattern as string;
		const cwd = input.path
			? resolve(PROJECT_ROOT, input.path as string)
			: PROJECT_ROOT;

		const matcher = buildGlobMatcher(pattern);

		// For path-based globs like "src/**/*.ts", match against the relative path
		const hasPath = pattern.includes("/");
		const filter = hasPath
			? undefined // walk everything, filter by relative path below
			: matcher; // filename-only glob, filter during walk

		const allFiles = await walkFiles(cwd, filter);

		// For path globs, filter by relative path after walking
		const files = hasPath
			? allFiles.filter((f) => matcher(relative(cwd, f)))
			: allFiles;

		// Sort by modification time (newest first)
		const withStats = await Promise.all(
			files.map(async (f) => {
				try {
					const s = await stat(f);
					return { path: relative(cwd, f), mtimeMs: s.mtimeMs };
				} catch {
					return { path: relative(cwd, f), mtimeMs: 0 };
				}
			}),
		);

		withStats.sort((a, b) => b.mtimeMs - a.mtimeMs);

		if (withStats.length === 0) {
			return `No files matching "${pattern}" in ${cwd}`;
		}

		return withStats.map((f) => f.path).join("\n");
	},
};
