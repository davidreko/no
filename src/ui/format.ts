import chalk from "chalk";

/**
 * Format a tool call as a compact one-liner.
 */
export function fmtToolCall(name: string, args: string): string {
	return `  ${chalk.cyan(">")} ${chalk.cyan.bold(name)} ${chalk.dim(args)}`;
}

/**
 * Format a tool success line with an optional summary.
 */
export function fmtToolOk(summary?: string): string {
	const detail = summary ? chalk.dim(` ${summary}`) : "";
	return `    ${chalk.green("ok")}${detail}`;
}

/**
 * Format a tool error line.
 */
export function fmtToolErr(msg: string): string {
	return `    ${chalk.red("err")} ${chalk.red(msg)}`;
}

/**
 * Format a tool denied line.
 */
export function fmtToolDenied(): string {
	return `    ${chalk.dim("denied")}`;
}

/**
 * Produce a short summary of tool output for display.
 * Returns undefined if no summary is appropriate (show nothing extra).
 */
export function summarizeOutput(
	name: string,
	output: string,
): string | undefined {
	switch (name) {
		case "read_file": {
			const n = output.split("\n").length;
			return `${n} line${n === 1 ? "" : "s"}`;
		}
		case "grep": {
			if (output.startsWith("No matches")) return "no matches";
			const n = output.split("\n").length;
			return `${n} match${n === 1 ? "" : "es"}`;
		}
		case "glob": {
			const files = output.split("\n").filter(Boolean);
			return `${files.length} file${files.length === 1 ? "" : "s"}`;
		}
		case "list_dir": {
			const entries = output.split("\n").filter(Boolean);
			return `${entries.length} entries`;
		}
		case "bash": {
			const lines = output.split("\n").length;
			if (lines > 3) return `${lines} lines of output`;
			return undefined;
		}
		case "git_diff": {
			if (output === "(no changes)") return "no changes";
			const n = output.split("\n").length;
			return `${n} lines`;
		}
		case "git_log": {
			if (output === "(no commits)") return "no commits";
			const n = output.split("\n").filter(Boolean).length;
			return `${n} commit${n === 1 ? "" : "s"}`;
		}
		case "write_file":
		case "edit_file": {
			// Show the tool's own message (e.g. "Created src/foo.ts (12 lines)")
			const firstLine = output.split("\n")[0];
			return firstLine;
		}
		default:
			return undefined;
	}
}

/**
 * Create a text streaming function that auto-indents lines.
 * Call the returned function with each text chunk from the stream.
 */
export function createTextStream(): (text: string) => void {
	let atLineStart = true;
	const indent = "  ";

	return (text: string) => {
		let out = "";
		for (const ch of text) {
			if (atLineStart && ch !== "\n") {
				out += indent;
				atLineStart = false;
			}
			out += ch;
			if (ch === "\n") {
				atLineStart = true;
			}
		}
		process.stdout.write(out);
	};
}

/**
 * Format tool arguments for display.
 */
export function fmtToolArgs(
	name: string,
	input: Record<string, unknown>,
): string {
	switch (name) {
		case "read_file":
		case "write_file":
		case "edit_file":
			return String(input.path ?? "");
		case "bash":
			return truncate(String(input.command ?? ""), 60);
		case "glob":
			return String(input.pattern ?? "");
		case "grep":
			return `"${input.pattern}"`;
		case "list_dir":
			return String(input.path ?? ".");
		case "git_diff":
			return input.ref ? String(input.ref) : input.staged ? "--cached" : "";
		case "git_log":
			return input.path ? String(input.path) : "";
		default:
			return "";
	}
}

function truncate(str: string, max: number): string {
	if (str.length <= max) return str;
	return `${str.slice(0, max - 1)}…`;
}
