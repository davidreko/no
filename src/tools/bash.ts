import { exec } from "node:child_process";
import { PROJECT_ROOT } from "../sandbox";
import { getShell } from "../shell";
import type { InternalTool } from "../types";

const DANGEROUS_PATTERNS = [
	/\brm\s+-[a-z]*r[a-z]*f[a-z]*\s+[/~*]/,
	/\brm\s+-[a-z]*f[a-z]*r[a-z]*\s+[/~*]/,
	/\bgit\s+push\s+--force/,
	/\bgit\s+push\s+-f\b/,
	/\bgit\s+reset\s+--hard/,
	/\bgit\s+clean\s+-[a-z]*f/,
	/\bdd\s+if=/,
	/\bmkfs\./,
	/\b>\s*\/dev\/sd/,
	/\bchmod\s+-R\s+777/,
	/\bcurl\b.*\|\s*(ba)?sh/,
	/\bwget\b.*\|\s*(ba)?sh/,
	/\bsudo\s+rm\b/,
	/\bkillall\b/,
	/\bpkill\b/,
	/\b:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;/,
];

export function isDangerous(command: string): boolean {
	return DANGEROUS_PATTERNS.some((p) => p.test(command));
}

export const bashTool: InternalTool = {
	definition: {
		name: "bash",
		description:
			"Execute a shell command scoped to the project root. Use for running tests, installing packages, git operations, and other system commands.",
		input_schema: {
			type: "object" as const,
			properties: {
				command: {
					type: "string",
					description: "The shell command to execute",
				},
				timeout: {
					type: "number",
					description: "Timeout in milliseconds (default 120000, max 600000)",
				},
			},
			required: ["command"],
		},
	},
	readOnly: false,
	requiresApproval: true,
	async execute(input, signal?) {
		const command = input.command as string;
		const timeout = Math.min((input.timeout as number) ?? 120_000, 600_000);

		return new Promise<string>((resolve) => {
			const child = exec(
				command,
				{
					timeout,
					maxBuffer: 1024 * 1024 * 10,
					shell: getShell(),
					cwd: PROJECT_ROOT,
				},
				(error, stdout, stderr) => {
					const parts: string[] = [];
					if (stdout) parts.push(stdout);
					if (stderr) parts.push(`[stderr]\n${stderr}`);
					if (error?.killed) {
						parts.push(`[timed out after ${timeout}ms]`);
					} else if (error) {
						parts.push(`[exit code ${error.code ?? 1}]`);
					}
					resolve(parts.join("\n") || "(no output)");
				},
			);

			if (signal) {
				const onAbort = () => {
					child.kill();
				};
				if (signal.aborted) {
					child.kill();
				} else {
					signal.addEventListener("abort", onAbort, { once: true });
					child.on("exit", () => {
						signal.removeEventListener("abort", onAbort);
					});
				}
			}
		});
	},
};
