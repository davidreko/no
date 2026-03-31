import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as readline from "node:readline";
import chalk from "chalk";
import dotenv from "dotenv";
import type { NoConfig } from "./config";
import { saveConfig } from "./config";
import { MODELS } from "./types";

interface SetupResult {
	apiKey: string;
	config: NoConfig;
}

function ask(rl: readline.Interface, question: string): Promise<string> {
	return new Promise((resolve) => {
		rl.question(question, (answer) => resolve(answer.trim()));
	});
}

export async function runSetup(): Promise<SetupResult> {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	console.log(chalk.bold("\n  Welcome to no.\n"));
	console.log(chalk.dim("  Let's get you set up.\n"));

	// --- API Key ---
	let apiKey = process.env.ANTHROPIC_API_KEY ?? "";

	if (apiKey) {
		console.log(
			chalk.green("  ok") +
				chalk.dim(` API key found in environment (${mask(apiKey)})\n`),
		);
	} else {
		console.log(chalk.yellow("  No ANTHROPIC_API_KEY found in environment.\n"));
		apiKey = await ask(rl, chalk.bold("  API key: "));

		if (!apiKey) {
			console.log(
				chalk.red(
					"\n  API key is required. Set ANTHROPIC_API_KEY or pass it here.\n",
				),
			);
			rl.close();
			process.exit(1);
		}

		// Offer to save to .env
		const saveEnv = await ask(
			rl,
			chalk.dim("  Save to .env in this project? [Y/n]: "),
		);

		if (saveEnv.toLowerCase() !== "n") {
			const envPath = join(process.cwd(), ".env");
			let envContent = "";
			if (existsSync(envPath)) {
				envContent = await readFile(envPath, "utf-8");
				if (envContent.includes("ANTHROPIC_API_KEY")) {
					console.log(
						chalk.dim("  .env already has ANTHROPIC_API_KEY, skipping.\n"),
					);
				} else {
					envContent += `\nANTHROPIC_API_KEY=${apiKey}\n`;
					await writeFile(envPath, envContent, "utf-8");
					console.log(chalk.green("  ok") + chalk.dim(" Saved to .env\n"));
				}
			} else {
				await writeFile(envPath, `ANTHROPIC_API_KEY=${apiKey}\n`, "utf-8");
				console.log(chalk.green("  ok") + chalk.dim(" Created .env\n"));
			}

			// Set it for this session
			process.env.ANTHROPIC_API_KEY = apiKey;
		}
	}

	// --- Model Selection ---
	console.log(chalk.bold("  Choose a model:\n"));
	for (let i = 0; i < MODELS.length; i++) {
		const m = MODELS[i];
		const marker = i === 0 ? chalk.green(" (default)") : "";
		console.log(
			`  ${chalk.bold(`${i + 1}.`)} ${m.label} ${chalk.dim(` - ${m.note}`)}${marker}`,
		);
	}
	console.log();

	const modelChoice = await ask(rl, chalk.bold("  Model [1]: "));
	const modelIdx = modelChoice ? Number.parseInt(modelChoice, 10) - 1 : 0;
	const model = MODELS[modelIdx]?.id ?? MODELS[0].id;
	console.log(
		chalk.green("  ok") +
			chalk.dim(` Using ${MODELS[modelIdx]?.label ?? MODELS[0].label}\n`),
	);

	// --- Judge Model ---
	const judgeChoice = await ask(
		rl,
		chalk.bold("  Judge model ") + chalk.dim(`[same as above]: `),
	);
	let judgeModel = model;
	if (judgeChoice) {
		const judgeIdx = Number.parseInt(judgeChoice, 10) - 1;
		if (MODELS[judgeIdx]) {
			judgeModel = MODELS[judgeIdx].id;
			console.log(
				chalk.green("  ok") +
					chalk.dim(` Judge using ${MODELS[judgeIdx].label}\n`),
			);
		}
	} else {
		console.log(chalk.green("  ok") + chalk.dim(" Judge using same model\n"));
	}

	// --- Thinking ---
	console.log(chalk.bold("  Extended thinking:\n"));
	console.log(
		`  ${chalk.bold("1.")} complex only ${chalk.dim(" - think for complex tasks (default)")}${chalk.green(" (default)")}`,
	);
	console.log(
		`  ${chalk.bold("2.")} always ${chalk.dim(" - think for all tasks")}`,
	);
	console.log(
		`  ${chalk.bold("3.")} off ${chalk.dim(" - never use thinking")}`,
	);
	console.log();

	const thinkingChoice = await ask(rl, chalk.bold("  Thinking [1]: "));
	const thinkingMap = { "1": "complex", "2": "always", "3": "off" } as const;
	const thinking =
		thinkingMap[thinkingChoice as keyof typeof thinkingMap] ?? "complex";
	console.log(chalk.green("  ok") + chalk.dim(` Thinking: ${thinking}\n`));

	// --- Create .no/ config ---
	const config: NoConfig = {
		model,
		judgeModel,
		alwaysAllow: [],
		thinking,
	};

	await saveConfig(config);
	console.log(
		chalk.green("  ok") + chalk.dim(` Config saved to .no/config.json\n`),
	);

	// --- Create starter memory.md if it doesn't exist ---
	const memoryPath = join(process.cwd(), ".no", "memory.md");
	if (!existsSync(memoryPath)) {
		await writeFile(
			memoryPath,
			"# Project Context\n\nDescribe your project here. The agent and judge will read this at startup.\n",
			"utf-8",
		);
		console.log(
			chalk.green("  ok") +
				chalk.dim(" Created .no/memory.md  - edit it to add project context\n"),
		);
	}

	console.log(chalk.bold("  Ready. Type a task to get started.\n"));

	rl.close();

	return { apiKey, config };
}

/**
 * Load .env file from project root into process.env (if it exists).
 */
export function loadEnv(): void {
	const envPath = join(process.cwd(), ".env");
	if (!existsSync(envPath)) return;
	dotenv.config({ path: envPath, quiet: true });
}

function mask(key: string): string {
	if (key.length <= 8) return "****";
	return `${key.slice(0, 4)}...${key.slice(-4)}`;
}
