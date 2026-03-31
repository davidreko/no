import chalk from "chalk";
import { addAlwaysAllow } from "./config";
import { ask } from "./prompt";
import { isDangerous } from "./tools/bash";

const sessionAllowed = new Set<string>();

export function initAlwaysAllow(tools: string[]): void {
	for (const t of tools) {
		sessionAllowed.add(t);
	}
}

export async function checkPermission(
	toolName: string,
	input: Record<string, unknown>,
): Promise<boolean> {
	// Dangerous bash commands always prompt, even if session-allowed
	if (toolName === "bash" && isDangerous(input.command as string)) {
		console.log(
			chalk.red.bold("\n  dangerous command: ") +
				chalk.white(input.command as string),
		);
		return promptUser(toolName);
	}

	if (sessionAllowed.has(toolName)) {
		return true;
	}

	return promptUser(toolName);
}

async function promptUser(toolName: string): Promise<boolean> {
	const answer = await ask(
		chalk.yellow(`  Allow ${toolName}? `) +
			chalk.dim("[y]es / [n]o / [a]lways: "),
	);

	if (answer === null) return false;

	const a = answer.trim().toLowerCase();
	if (a === "a" || a === "always") {
		sessionAllowed.add(toolName);
		addAlwaysAllow(toolName);
		return true;
	}
	if (a === "y" || a === "yes" || a === "") {
		return true;
	}
	return false;
}
