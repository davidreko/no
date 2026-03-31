import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Load project memory from .no/memory.md if it exists.
 * Returns the trimmed content, or null if not found.
 */
export function loadProjectMemory(cwd: string): string | null {
	const memoryPath = join(cwd, ".no", "memory.md");
	if (!existsSync(memoryPath)) return null;

	try {
		const content = readFileSync(memoryPath, "utf-8").trim();
		return content || null;
	} catch {
		return null;
	}
}
