/**
 * Shared prompt helper that reads a line from stdin without creating
 * a new readline interface (which would conflict with the REPL's readline).
 *
 * Handles Ctrl+C by returning null (same as EOF).
 */
export function ask(prompt: string): Promise<string | null> {
	return new Promise((resolve) => {
		process.stdout.write(prompt);

		let buf = "";
		let resolved = false;

		const done = (value: string | null) => {
			if (resolved) return;
			resolved = true;
			cleanup();
			resolve(value);
		};

		const onData = (chunk: Buffer) => {
			const str = chunk.toString();

			// Ctrl+C in cooked mode arrives as \x03
			if (str.includes("\x03")) {
				done(null);
				return;
			}

			buf += str;
			const newline = buf.indexOf("\n");
			if (newline !== -1) {
				done(buf.slice(0, newline).replace(/\r$/, ""));
			}
		};

		const onEnd = () => {
			done(null);
		};

		const cleanup = () => {
			process.stdin.removeListener("data", onData);
			process.stdin.removeListener("end", onEnd);
		};

		process.stdin.on("data", onData);
		process.stdin.on("end", onEnd);
	});
}
