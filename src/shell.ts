import { existsSync } from "node:fs";

let cachedShell: string | undefined;

/**
 * Returns a bash-compatible shell path.
 * On Windows, finds Git Bash. On Unix, uses /bin/bash.
 */
export function getShell(): string {
	if (cachedShell) return cachedShell;

	if (process.platform === "win32") {
		const candidates = [
			process.env.PROGRAMFILES &&
				`${process.env.PROGRAMFILES}\\Git\\bin\\bash.exe`,
			"C:\\Program Files\\Git\\bin\\bash.exe",
			process.env.LOCALAPPDATA &&
				`${process.env.LOCALAPPDATA}\\Programs\\Git\\bin\\bash.exe`,
		].filter(Boolean) as string[];

		for (const candidate of candidates) {
			if (existsSync(candidate)) {
				cachedShell = candidate;
				return cachedShell;
			}
		}

		// Fall back to cmd if no bash found
		cachedShell = "cmd.exe";
		return cachedShell;
	}

	cachedShell = "/bin/bash";
	return cachedShell;
}
