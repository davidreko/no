import chalk from "chalk";

export interface CommandItem {
	name: string;
	desc: string;
}

export type KeyDispatch = (
	ch: string | undefined,
	key: { name?: string; ctrl?: boolean; meta?: boolean },
) => void;

/**
 * Interactive picker with type-to-filter.
 * Arrow keys navigate, Enter selects, Escape cancels, typing filters.
 *
 * Always renders a fixed number of lines (based on total item count)
 * so cursor math stays stable across filter changes.
 */
export interface MenuOptions {
	preserveOrder?: boolean;
}

export function commandMenu(
	items: CommandItem[],
	setHandler: (handler: KeyDispatch | null) => void,
	options?: MenuOptions,
): Promise<string | null> {
	const sorted = options?.preserveOrder
		? [...items]
		: [...items].sort((a, b) => a.name.localeCompare(b.name));
	// Fixed line count: 1 (filter) + items.length (slots) + 1 (hint)
	const totalLines = 1 + sorted.length + 1;

	return new Promise((resolve) => {
		let cursor = 0;
		let filter = "";
		let filtered = sorted;
		let firstRender = true;

		const applyFilter = () => {
			if (!filter) {
				filtered = sorted;
			} else {
				const q = filter.toLowerCase();
				filtered = sorted.filter(
					(item) =>
						item.name.toLowerCase().includes(q) ||
						item.desc.toLowerCase().includes(q),
				);
			}
			cursor = Math.min(cursor, Math.max(0, filtered.length - 1));
		};

		const render = () => {
			// Move cursor to the start of our block
			if (!firstRender) {
				// Move up totalLines - 1 (cursor is on the last line)
				for (let i = 0; i < totalLines - 1; i++) {
					process.stdout.write("\x1B[A");
				}
			}
			firstRender = false;

			// Filter line
			process.stdout.write("\r\x1B[2K");
			if (filter) {
				process.stdout.write(chalk.dim(`  /${filter}`));
			}
			process.stdout.write("\n");

			// Item slots  - always render sorted.length lines
			for (let i = 0; i < sorted.length; i++) {
				process.stdout.write("\r\x1B[2K");
				if (i < filtered.length) {
					const item = filtered[i];
					if (i === cursor) {
						process.stdout.write(
							`  ${chalk.cyan(">")} ${chalk.cyan.bold(item.name)}  ${item.desc}`,
						);
					} else {
						process.stdout.write(
							`    ${chalk.dim(item.name)}  ${chalk.dim(item.desc)}`,
						);
					}
				}
				process.stdout.write("\n");
			}

			// Hint line (no trailing newline  - cursor stays here)
			process.stdout.write("\r\x1B[2K");
			process.stdout.write(
				chalk.dim("  ↑↓ navigate · enter select · esc cancel"),
			);
		};

		render();

		const done = (result: string | null) => {
			setHandler(null);

			// Clear all lines: cursor is on the last (hint) line
			process.stdout.write("\r\x1B[2K");
			for (let i = 0; i < totalLines - 1; i++) {
				process.stdout.write("\x1B[A\r\x1B[2K");
			}
			process.stdout.write("\r");

			resolve(result);
		};

		setHandler((ch, key) => {
			if (!key) return;

			if (key.name === "up") {
				if (filtered.length > 0) {
					cursor = (cursor - 1 + filtered.length) % filtered.length;
					render();
				}
			} else if (key.name === "down") {
				if (filtered.length > 0) {
					cursor = (cursor + 1) % filtered.length;
					render();
				}
			} else if (key.name === "return") {
				if (filtered.length > 0) {
					done(filtered[cursor].name);
				} else if (filter) {
					done(`/${filter}`);
				}
			} else if (key.name === "escape") {
				done(null);
			} else if (key.ctrl && key.name === "c") {
				done(null);
			} else if (key.name === "backspace") {
				if (filter.length > 0) {
					filter = filter.slice(0, -1);
					applyFilter();
					render();
				}
			} else if (ch && !key.ctrl && !key.meta) {
				filter += ch;
				applyFilter();
				render();
			}
		});
	});
}
