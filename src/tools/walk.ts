import { readdir } from "node:fs/promises";
import { join } from "node:path";

const IGNORE_DIRS = new Set([
	"node_modules",
	".git",
	"dist",
	".next",
	".nuxt",
	"coverage",
	".turbo",
]);

const IGNORE_EXTENSIONS = new Set([
	".lock",
	".png",
	".jpg",
	".jpeg",
	".gif",
	".ico",
	".woff",
	".woff2",
	".ttf",
	".eot",
	".mp3",
	".mp4",
	".zip",
	".tar",
	".gz",
]);

/**
 * Recursively walk a directory, yielding file paths that pass the filter.
 * Skips ignored directories and binary file extensions.
 */
export async function walkFiles(
	dir: string,
	filter?: (name: string) => boolean,
): Promise<string[]> {
	const results: string[] = [];
	await walk(dir, filter ?? null, results);
	return results;
}

async function walk(
	dir: string,
	filter: ((name: string) => boolean) | null,
	results: string[],
): Promise<void> {
	try {
		const entries = await readdir(dir, { withFileTypes: true });

		for (const entry of entries) {
			if (entry.isDirectory()) {
				if (IGNORE_DIRS.has(entry.name)) continue;
				await walk(join(dir, entry.name), filter, results);
			} else if (entry.isFile()) {
				const ext = entry.name.slice(entry.name.lastIndexOf(".")).toLowerCase();
				if (IGNORE_EXTENSIONS.has(ext)) continue;
				if (filter && !filter(entry.name)) continue;
				results.push(join(dir, entry.name));
			}
		}
	} catch {
		// Skip dirs we can't read
	}
}

/**
 * Turn a simple glob like "*.ts" or "*.{js,jsx}" into a test function.
 * Supports *, ?, and {a,b} expansion. For path globs like "src/*.ts",
 * only the filename portion is tested.
 */
export function buildGlobMatcher(glob: string): (name: string) => boolean {
	const expanded = glob.replace(/\{([^}]+)\}/g, (_, group: string) => {
		return `(${group
			.split(",")
			.map((s: string) => s.trim())
			.join("|")})`;
	});

	const regexStr = expanded
		.replace(/\./g, "\\.")
		.replace(/\*\*/g, "\0")
		.replace(/\*/g, "[^/]*")
		.replace(/\0/g, ".*")
		.replace(/\?/g, ".");

	const re = new RegExp(`^${regexStr}$`);
	return (name: string) => re.test(name);
}
