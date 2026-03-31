import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface NoConfig {
	model: string;
	judgeModel: string;
	alwaysAllow: string[];
	thinking: "complex" | "always" | "off";
}

const DEFAULTS: NoConfig = {
	model: "claude-sonnet-4-6",
	judgeModel: "claude-sonnet-4-6",
	alwaysAllow: [],
	thinking: "complex",
};

function configDir(): string {
	return join(process.cwd(), ".no");
}

function configPath(): string {
	return join(configDir(), "config.json");
}

export function needsSetup(): boolean {
	const hasKey = !!process.env.ANTHROPIC_API_KEY;
	const hasConfig = existsSync(configPath());
	return !hasKey || !hasConfig;
}

export async function loadConfig(): Promise<NoConfig> {
	const path = configPath();
	if (!existsSync(path)) return { ...DEFAULTS };

	try {
		const raw = await readFile(path, "utf-8");
		const parsed = JSON.parse(raw);
		return { ...DEFAULTS, ...parsed };
	} catch {
		return { ...DEFAULTS };
	}
}

export async function saveConfig(config: NoConfig): Promise<void> {
	const dir = configDir();
	if (!existsSync(dir)) {
		await mkdir(dir, { recursive: true });
	}
	await writeFile(
		configPath(),
		`${JSON.stringify(config, null, 2)}\n`,
		"utf-8",
	);
}

export async function addAlwaysAllow(toolName: string): Promise<void> {
	const config = await loadConfig();
	if (!config.alwaysAllow.includes(toolName)) {
		config.alwaysAllow.push(toolName);
		await saveConfig(config);
	}
}
