import chalk from "chalk";

/**
 * Show a compact red/green diff preview for an edit_file operation.
 * Called before the permission prompt so the user knows what's changing.
 */
export function showEditDiff(input: Record<string, unknown>): void {
	const oldStr = input.old_string as string | undefined;
	const newStr = input.new_string as string | undefined;
	if (!oldStr && !newStr) return;

	const oldLines = (oldStr ?? "").split("\n");
	const newLines = (newStr ?? "").split("\n");

	// Cap preview at 20 lines each side
	const maxLines = 20;
	const showOld = oldLines.slice(0, maxLines);
	const showNew = newLines.slice(0, maxLines);

	console.log();
	for (const line of showOld) {
		console.log(chalk.red(`    - ${line}`));
	}
	if (oldLines.length > maxLines) {
		console.log(chalk.red.dim(`    ... +${oldLines.length - maxLines} lines`));
	}
	for (const line of showNew) {
		console.log(chalk.green(`    + ${line}`));
	}
	if (newLines.length > maxLines) {
		console.log(
			chalk.green.dim(`    ... +${newLines.length - maxLines} lines`),
		);
	}
}

/**
 * Show a brief preview of file content being written.
 * Called before the permission prompt for write_file.
 */
export function showWritePreview(input: Record<string, unknown>): void {
	const content = input.content as string | undefined;
	if (!content) return;

	const lines = content.split("\n");
	const maxLines = 10;
	const preview = lines.slice(0, maxLines);

	console.log();
	for (const line of preview) {
		console.log(chalk.green(`    + ${line}`));
	}
	if (lines.length > maxLines) {
		console.log(
			chalk.green.dim(`    ... +${lines.length - maxLines} more lines`),
		);
	}
}
