import { readFile, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { PROJECT_ROOT } from "../sandbox";
import type { InternalTool } from "../types";
import { buildGlobMatcher, walkFiles } from "./walk";

const MAX_MATCHES = 100;
const MAX_FILE_SIZE = 1024 * 1024; // 1MB

export const grepTool: InternalTool = {
	definition: {
		name: "grep",
		description:
			"Search file contents using a regex pattern. Returns matching lines with file paths and line numbers.",
		input_schema: {
			type: "object" as const,
			properties: {
				pattern: {
					type: "string",
					description: "Regex pattern to search for",
				},
				path: {
					type: "string",
					description:
						"File or directory to search in (relative to project root, or absolute). Defaults to project root.",
				},
				glob: {
					type: "string",
					description:
						'Filter files by glob pattern (e.g. "*.ts", "*.{js,jsx}")',
				},
				case_insensitive: {
					type: "boolean",
					description: "Case insensitive search (default false)",
				},
			},
			required: ["pattern"],
		},
	},
	readOnly: true,
	requiresApproval: false,
	async execute(input) {
		const pattern = input.pattern as string;
		const searchPath = input.path
			? resolve(PROJECT_ROOT, input.path as string)
			: PROJECT_ROOT;
		const globFilter = input.glob as string | undefined;
		const caseInsensitive = (input.case_insensitive as boolean) ?? false;

		let regex: RegExp;
		try {
			regex = new RegExp(pattern, caseInsensitive ? "i" : "");
		} catch {
			return `Invalid regex pattern: "${pattern}"`;
		}

		const filter = globFilter ? buildGlobMatcher(globFilter) : undefined;
		const files = await walkFiles(searchPath, filter);
		const matches: string[] = [];

		for (const filePath of files) {
			if (matches.length >= MAX_MATCHES) break;

			try {
				const info = await stat(filePath);
				if (info.size > MAX_FILE_SIZE) continue;

				const content = await readFile(filePath, "utf-8");
				const lines = content.split("\n");
				const rel = relative(searchPath, filePath);

				for (let i = 0; i < lines.length; i++) {
					if (matches.length >= MAX_MATCHES) break;
					if (regex.test(lines[i])) {
						matches.push(`${rel}:${i + 1}:${lines[i]}`);
					}
				}
			} catch {
				// Skip files we can't read
			}
		}

		if (matches.length === 0) {
			return `No matches for "${pattern}" in ${searchPath}`;
		}

		const truncated =
			matches.length >= MAX_MATCHES
				? `\n(limited to ${MAX_MATCHES} matches)`
				: "";
		return matches.join("\n") + truncated;
	},
};
