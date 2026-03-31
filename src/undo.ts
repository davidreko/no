import { execSync } from "node:child_process";
import chalk from "chalk";
import { ask } from "./prompt";
import { getShell } from "./shell";

const STASH_PREFIX = "no-agent-checkpoint";
let hasCheckpoint = false;

function git(cmd: string): string {
	const shell = getShell();
	return execSync(`git ${cmd}`, {
		encoding: "utf-8",
		shell,
		stdio: ["pipe", "pipe", "pipe"],
	}).trim();
}

function isGitRepo(): boolean {
	try {
		git("rev-parse --is-inside-work-tree");
		return true;
	} catch {
		return false;
	}
}

function hasChanges(): boolean {
	try {
		const status = git("status --porcelain");
		return status.length > 0;
	} catch {
		return false;
	}
}

export function checkpoint(): void {
	if (!isGitRepo()) return;
	if (!hasChanges()) {
		hasCheckpoint = false;
		return;
	}

	try {
		git(`stash push -u -m "${STASH_PREFIX}"`);
		git("stash apply");
		hasCheckpoint = true;
	} catch {
		hasCheckpoint = false;
	}
}

export async function undo(): Promise<{ success: boolean; message: string }> {
	if (!isGitRepo()) {
		return { success: false, message: "not a git repository" };
	}

	if (!hasCheckpoint) {
		return { success: false, message: "no checkpoint to restore" };
	}

	// Warn: this destroys uncommitted changes and untracked files
	console.log(
		chalk.yellow(
			"  warning: this will discard all uncommitted changes and untracked files",
		),
	);
	const answer = await ask(chalk.yellow("  continue? [y/N]: "));
	if (!answer || answer.trim().toLowerCase() !== "y") {
		return { success: false, message: "cancelled" };
	}

	try {
		// Find the most recent no-agent-checkpoint stash
		const stashList = git("stash list");
		const lines = stashList.split("\n");
		const idx = lines.findIndex((l) => l.includes(STASH_PREFIX));

		if (idx === -1) {
			hasCheckpoint = false;
			return { success: false, message: "checkpoint stash not found" };
		}

		// Reset working tree to the stash state
		git("checkout -- .");
		git("clean -fd");
		git(`stash pop stash@{${idx}}`);
		hasCheckpoint = false;
		return { success: true, message: "restored to pre-task state" };
	} catch (err) {
		return {
			success: false,
			message: err instanceof Error ? err.message : String(err),
		};
	}
}

export function canUndo(): boolean {
	return hasCheckpoint;
}
