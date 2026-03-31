import chalk from "chalk";
import type { TokenUsage } from "../types";
import { estimateCost } from "../types";

/**
 * Persistent status line rendered at the bottom of the terminal.
 * Uses ANSI escape codes to save/restore cursor position.
 */
export class StatusLine {
	private model: string;
	private judgeModel: string;
	private usage: TokenUsage = {
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheCreationTokens: 0,
	};
	private enabled: boolean;

	constructor(model: string, judgeModel: string, enabled = true) {
		this.model = model;
		this.judgeModel = judgeModel;
		this.enabled = enabled && process.stdout.isTTY === true;
	}

	setModel(model: string, judgeModel: string): void {
		this.model = model;
		this.judgeModel = judgeModel;
		this.render();
	}

	update(usage: TokenUsage): void {
		this.usage = usage;
		this.render();
	}

	render(): void {
		if (!this.enabled) return;

		const tokens = (
			this.usage.inputTokens + this.usage.outputTokens
		).toLocaleString();
		const cost = estimateCost(this.usage, this.model);
		const costStr = cost > 0 ? `~$${cost.toFixed(4)}` : "$0";

		const judge =
			this.judgeModel !== this.model ? ` · judge: ${this.judgeModel}` : "";
		const line = chalk.dim(
			`  ${this.model}${judge} · ${tokens} tokens · ${costStr}`,
		);

		// Save cursor, move to bottom, clear line, write, restore cursor
		process.stdout.write(
			`\x1B[s\x1B[${process.stdout.rows};1H\x1B[K${line}\x1B[u`,
		);
	}

	clear(): void {
		if (!this.enabled) return;
		process.stdout.write(`\x1B[${process.stdout.rows};1H\x1B[K`);
	}
}
