import chalk from "chalk";
import type { JudgeReview } from "../types";

export function planPanel(plan: string): void {
	console.log();
	console.log(chalk.cyan.bold("  plan"));
	console.log();
	for (const line of plan.split("\n")) {
		console.log(`  ${line}`);
	}
	console.log();
}

/**
 * Streams plan text token-by-token.
 * Call `open()` when the first text arrives, `write()` for each chunk,
 * and `close()` when the stream ends.
 */
export class PlanStream {
	private opened = false;
	private atLineStart = true;

	open(): void {
		if (this.opened) return;
		this.opened = true;
		console.log();
		console.log(chalk.cyan.bold("  plan"));
		console.log();
	}

	write(text: string): void {
		let out = "";
		for (const ch of text) {
			if (this.atLineStart && ch !== "\n") {
				out += "  ";
				this.atLineStart = false;
			}
			out += ch;
			if (ch === "\n") {
				this.atLineStart = true;
			}
		}
		process.stdout.write(out);
	}

	close(): void {
		if (!this.atLineStart) {
			process.stdout.write("\n");
		}
		console.log();
	}
}

export function judgePanel(review: JudgeReview): void {
	const color =
		review.verdict === "looks-good"
			? chalk.green
			: review.verdict === "hard-no"
				? chalk.red
				: chalk.yellow;

	console.log();
	console.log(`  ${color.bold("judge")} ${color(review.verdict)}`);
	console.log();

	if (review.verdict === "looks-good") {
		const msg = review.explanation ?? "Approach looks good. No concerns.";
		console.log(chalk.green(`  ${msg}`));
	} else {
		if (review.explanation) {
			console.log(`  ${review.explanation}`);
			console.log();
		}
		for (const concern of review.concerns) {
			console.log(chalk.yellow(`  - ${concern}`));
		}

		if (review.simplerAlternative) {
			console.log();
			console.log(chalk.bold("  Simpler approach:"));
			for (const line of review.simplerAlternative.split("\n")) {
				console.log(`    ${line}`);
			}
		}

		if (review.questions.length > 0) {
			console.log();
			for (const q of review.questions) {
				console.log(chalk.dim(`  ? ${q}`));
			}
		}
	}

	console.log();
}
