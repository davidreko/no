import { existsSync, realpathSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

/** The directory where `no` was launched. Frozen at startup. */
export const PROJECT_ROOT = process.cwd();

/**
 * Checks if a resolved path is outside the project root.
 * Follows symlinks to catch escapes via symlinked paths.
 * For paths that don't exist yet, resolves the nearest existing
 * ancestor directory to catch symlink-based escapes.
 */
export function isOutsideProject(inputPath: string): boolean {
	const resolved = resolve(PROJECT_ROOT, inputPath);

	if (existsSync(resolved)) {
		const real = realpathSync(resolved);
		return relative(PROJECT_ROOT, real).startsWith("..");
	}

	// File doesn't exist yet - resolve the nearest existing ancestor
	let dir = dirname(resolved);
	while (!existsSync(dir) && dir !== dirname(dir)) {
		dir = dirname(dir);
	}
	if (existsSync(dir)) {
		const realDir = realpathSync(dir);
		return relative(PROJECT_ROOT, realDir).startsWith("..");
	}

	return relative(PROJECT_ROOT, resolved).startsWith("..");
}

/**
 * Scans tool input for path-like fields and returns true
 * if any of them escape the project root.
 */
export function toolEscapesProject(input: Record<string, unknown>): boolean {
	const pathField = input.path ?? input.file ?? input.directory;
	if (typeof pathField === "string" && pathField) {
		return isOutsideProject(pathField);
	}
	return false;
}
