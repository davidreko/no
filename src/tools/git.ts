import { exec } from "node:child_process";
import { PROJECT_ROOT } from "../sandbox";
import { getShell } from "../shell";
import type { InternalTool } from "../types";

function execGit(args: string[], fallback: string): Promise<string> {
	const command = `git ${args.join(" ")}`;
	return new Promise<string>((resolve) => {
		exec(
			command,
			{
				timeout: 30_000,
				maxBuffer: 1024 * 1024 * 5,
				shell: getShell(),
				cwd: PROJECT_ROOT,
			},
			(error, stdout, stderr) => {
				if (error && !stdout) {
					resolve(stderr || `${command} failed: ${error.message}`);
					return;
				}
				resolve(stdout || fallback);
			},
		);
	});
}

export const gitDiffTool: InternalTool = {
	definition: {
		name: "git_diff",
		description:
			"Show git diff output. Defaults to unstaged changes. Use staged=true for staged changes, or provide a ref to diff against (e.g. 'main', 'HEAD~3').",
		input_schema: {
			type: "object" as const,
			properties: {
				ref: {
					type: "string",
					description:
						"Git ref to diff against (e.g. 'main', 'HEAD~3', 'abc123'). Omit for working tree diff.",
				},
				staged: {
					type: "boolean",
					description: "Show staged (--cached) changes instead of unstaged",
				},
				path: {
					type: "string",
					description: "Limit diff to a specific file or directory path",
				},
			},
			required: [],
		},
	},
	readOnly: true,
	requiresApproval: false,
	async execute(input) {
		const args = ["diff"];
		if (input.staged) args.push("--cached");
		if (input.ref) args.push(String(input.ref));
		if (input.path) args.push("--", String(input.path));
		return execGit(args, "(no changes)");
	},
};

export const gitLogTool: InternalTool = {
	definition: {
		name: "git_log",
		description:
			"Show git commit log. Returns recent commits with hash, author, date, and message. Optionally filter by file path.",
		input_schema: {
			type: "object" as const,
			properties: {
				count: {
					type: "number",
					description: "Number of commits to show (default 10, max 50)",
				},
				path: {
					type: "string",
					description: "Limit log to commits affecting this file or directory",
				},
				oneline: {
					type: "boolean",
					description: "Use compact one-line format (default false)",
				},
			},
			required: [],
		},
	},
	readOnly: true,
	requiresApproval: false,
	async execute(input) {
		const count = Math.min((input.count as number) ?? 10, 50);
		const oneline = input.oneline as boolean | undefined;
		const format = oneline ? "--oneline" : "--format=%h %an %ad %s";

		const args = ["log", `-${count}`, format];
		if (!oneline) args.push("--date=short");
		if (input.path) args.push("--", String(input.path));
		return execGit(args, "(no commits)");
	},
};
