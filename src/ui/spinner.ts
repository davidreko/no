import chalk from "chalk";

const FRAMES = [
	"\u280B",
	"\u2819",
	"\u2839",
	"\u2838",
	"\u283C",
	"\u2834",
	"\u2826",
	"\u2827",
	"\u2807",
	"\u280F",
];

export class Spinner {
	private frame = 0;
	private interval: ReturnType<typeof setInterval> | null = null;
	private label: string;
	private detail = "";

	constructor(label: string) {
		this.label = label;
	}

	start(): this {
		process.stdout.write("\x1B[?25l"); // hide cursor
		this.render();
		this.interval = setInterval(() => {
			this.frame++;
			this.render();
		}, 80);
		return this;
	}

	private render(): void {
		const f = FRAMES[this.frame % FRAMES.length];
		const detail = this.detail ? chalk.dim(` ${this.detail}`) : "";
		process.stdout.write(
			`\r  ${chalk.cyan(f)} ${chalk.dim(this.label)}${detail}\x1B[K`,
		);
	}

	update(detail: string): void {
		this.detail = detail;
	}

	stop(finalText?: string): void {
		if (!this.interval) return;
		clearInterval(this.interval);
		this.interval = null;
		process.stdout.write("\r\x1B[K");
		process.stdout.write("\x1B[?25h"); // show cursor
		if (finalText) {
			console.log(finalText);
		}
	}
}
