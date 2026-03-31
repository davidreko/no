#!/usr/bin/env node
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import * as readline from "node:readline";
import chalk from "chalk";

let VERSION = "0.0.0";
try {
	const require = createRequire(import.meta.url);
	VERSION = require("../package.json").version;
} catch {
	// Fallback if package.json can't be resolved (e.g. bundled builds)
}

import { runWithJudge } from "./agent";
import type { NoConfig } from "./config";
import { loadConfig, needsSetup } from "./config";
import { judgePass } from "./judge";
import { initAlwaysAllow } from "./permissions";
import { listSessions, loadSession, saveSession } from "./sessions";
import { loadEnv, runSetup } from "./setup";
import type { Message, TokenUsage } from "./types";
import { addUsage, emptyUsage, estimateCost, MODELS } from "./types";
import { commandMenu, judgePanel, StatusLine } from "./ui";
import { canUndo, checkpoint, undo } from "./undo";

const BANNER = `
  ${chalk.bold.white("███╗   ██╗ ██████╗ ")}
  ${chalk.bold.white("████╗  ██║██╔═══██╗")}
  ${chalk.bold.white("██╔██╗ ██║██║   ██║")}
  ${chalk.bold.white("██║╚██╗██║██║   ██║")}
  ${chalk.bold.white("██║ ╚████║╚██████╔╝")}
  ${chalk.bold.white("╚═╝  ╚═══╝ ╚═════╝ ")}
  ${chalk.dim(`the agent that pushes back · v${VERSION}`)}
`;

interface CliArgs {
	model: string | null;
	judgeModel: string | null;
	thinking: NoConfig["thinking"];
	oneShot: string | null;
	init: boolean;
	review: boolean;
	dryRun: boolean;
}

function parseArgs(): CliArgs {
	const args = process.argv.slice(2);
	const result: CliArgs = {
		model: null,
		judgeModel: null,
		thinking: "complex",
		oneShot: null,
		init: false,
		review: false,
		dryRun: false,
	};

	for (let i = 0; i < args.length; i++) {
		switch (args[i]) {
			case "--dry-run":
				result.dryRun = true;
				break;
			case "--model":
				result.model = args[++i];
				break;
			case "--judge-model":
				result.judgeModel = args[++i];
				break;
			case "--help":
				printHelp();
				process.exit(0);
				break;
			case "--version":
				console.log(`no v${VERSION}`);
				process.exit(0);
				break;
			default:
				if (args[i] === "init") {
					result.init = true;
				} else if (args[i] === "review") {
					result.review = true;
				} else if (!args[i].startsWith("--")) {
					result.oneShot = args[i];
				}
				break;
		}
	}

	return result;
}

function printHelp(): void {
	console.log(`
${chalk.bold("no")}  - the AI coding agent that pushes back

${chalk.bold("Usage:")} no [options] [task]
         no review
         no init

${chalk.bold("Options:")}
  --dry-run        Show plan + judge review, don't execute
  --model          Model to use (default: claude-sonnet-4-6)
  --judge-model    Model for judge (default: same as --model)
  --help           Show help
  --version        Show version

${chalk.bold("REPL:")}  type / to open the command menu
`);
}

// --- Custom raw-mode prompt ---

type PromptResult =
	| { kind: "input"; value: string }
	| { kind: "menu" }
	| { kind: "sigint" };

const inputHistory: string[] = [];
const PROMPT_PREFIX = chalk.bold.green("  > ");

// Single persistent keypress handler  - avoids listener churn issues.
// The dispatch function is swapped when entering different input modes.
readline.emitKeypressEvents(process.stdin);
type KeyHandler = (
	ch: string | undefined,
	key: { name?: string; ctrl?: boolean; meta?: boolean; sequence?: string },
) => void;
let activeKeyHandler: KeyHandler | null = null;
process.stdin.on("keypress", (ch, key) => {
	activeKeyHandler?.(ch, key);
});

function enterRawMode(): void {
	process.stdin.setRawMode?.(true);
	process.stdin.resume();
}

function exitRawMode(): void {
	activeKeyHandler = null;
	process.stdin.setRawMode?.(false);
}

// Restore terminal state on exit (cursor visibility, raw mode)
function cleanupTerminal(): void {
	process.stdout.write("\x1B[?25h"); // show cursor
	exitRawMode();
}
process.on("exit", cleanupTerminal);
process.on("SIGTERM", () => {
	cleanupTerminal();
	process.exit(0);
});

function readInput(): Promise<PromptResult> {
	return new Promise((resolve) => {
		let buf = "";
		let historyIndex = inputHistory.length; // past the end = current input
		let savedBuf = ""; // saves current input when browsing history
		process.stdout.write(PROMPT_PREFIX);
		enterRawMode();

		const done = (result: PromptResult) => {
			// For menu, keep raw mode on  - the menu will take over the handler.
			// For everything else, exit raw mode.
			if (result.kind === "menu") {
				activeKeyHandler = null;
			} else {
				exitRawMode();
			}
			if (result.kind === "input" && result.value.trim()) {
				inputHistory.push(result.value.trim());
			}
			resolve(result);
		};

		const replaceLine = (text: string) => {
			// Clear current input and replace with text
			process.stdout.write(`\r\x1B[2K${PROMPT_PREFIX}${text}`);
			buf = text;
		};

		activeKeyHandler = (ch, key) => {
			if (key?.name === "return") {
				process.stdout.write("\n");
				done({ kind: "input", value: buf });
			} else if (key?.ctrl && key.name === "c") {
				process.stdout.write("\n");
				done({ kind: "sigint" });
			} else if (key?.name === "backspace") {
				if (buf.length > 0) {
					buf = buf.slice(0, -1);
					process.stdout.write("\b \b");
				}
			} else if (key?.name === "up") {
				if (inputHistory.length === 0) return;
				if (historyIndex === inputHistory.length) {
					savedBuf = buf; // save what they were typing
				}
				if (historyIndex > 0) {
					historyIndex--;
					replaceLine(inputHistory[historyIndex]);
				}
			} else if (key?.name === "down") {
				if (historyIndex < inputHistory.length) {
					historyIndex++;
					if (historyIndex === inputHistory.length) {
						replaceLine(savedBuf);
					} else {
						replaceLine(inputHistory[historyIndex]);
					}
				}
			} else if (ch && !key?.ctrl && !key?.meta) {
				buf += ch;
				process.stdout.write(ch);

				if (buf === "/") {
					process.stdout.write("\r\x1B[2K");
					done({ kind: "menu" });
				}
			}
		};
	});
}

// ---

function readStdin(): Promise<string> {
	return new Promise((resolve) => {
		let data = "";
		process.stdin.setEncoding("utf-8");
		process.stdin.on("data", (chunk) => {
			data += chunk;
		});
		process.stdin.on("end", () => resolve(data));
		process.stdin.resume();
	});
}

async function reviewStagedChanges(
	judgeModel: string,
): Promise<TokenUsage | null> {
	let diff: string;
	try {
		diff = execSync("git diff --staged", { encoding: "utf-8" }).trim();
	} catch {
		console.log(chalk.red("  not a git repository\n"));
		return null;
	}

	if (!diff) {
		console.log(chalk.dim("  no staged changes to review\n"));
		console.log(chalk.dim("  stage some changes first: git add <files>\n"));
		return null;
	}

	console.log(chalk.dim(`  reviewing staged changes (${judgeModel})...\n`));

	const task = "Review these staged git changes before commit";
	const plan = `## Staged Changes\n\n\`\`\`diff\n${diff}\n\`\`\``;

	const { review, usage } = await judgePass(task, plan, judgeModel);
	judgePanel(review);
	return usage;
}

async function main(): Promise<void> {
	const args = parseArgs();

	// Load .env before checking for API key
	loadEnv();

	// `no init`  - run setup wizard and exit
	if (args.init) {
		await runSetup();
		return;
	}

	// `no review`  - run judge on staged git changes
	if (args.review) {
		const config = await loadConfig();
		const jm = args.judgeModel ?? config.judgeModel ?? "claude-sonnet-4-6";
		const usage = await reviewStagedChanges(jm);
		if (usage) printCost(usage, jm);
		return;
	}

	// Pipe support: read piped stdin before anything else
	let pipedInput = "";
	if (!process.stdin.isTTY) {
		pipedInput = (await readStdin()).trim();
		// If no task argument, use piped input as the task
		if (!args.oneShot && pipedInput) {
			args.oneShot = pipedInput;
			pipedInput = "";
		}
	}

	// Check for API key in non-interactive contexts
	if (!process.env.ANTHROPIC_API_KEY && !process.stdin.isTTY) {
		console.error(
			chalk.red("error: ANTHROPIC_API_KEY required when piping input"),
		);
		process.exit(1);
	}
	if (!process.env.ANTHROPIC_API_KEY && args.oneShot && !needsSetup()) {
		console.error(
			chalk.red(
				"error: ANTHROPIC_API_KEY not set. Run `no init` or export ANTHROPIC_API_KEY.",
			),
		);
		process.exit(1);
	}
	if (needsSetup() && process.stdin.isTTY) {
		const setup = await runSetup();
		args.model = args.model ?? setup.config.model;
		args.judgeModel = args.judgeModel ?? setup.config.judgeModel;
		args.thinking = setup.config.thinking;
	} else {
		// Load existing .no/config.json  - CLI flags override saved config
		const config = await loadConfig();
		args.model = args.model ?? config.model;
		args.judgeModel = args.judgeModel ?? config.judgeModel;
		args.thinking = config.thinking;
		initAlwaysAllow(config.alwaysAllow);
	}

	// Ensure defaults after config merge
	let model = args.model ?? "claude-sonnet-4-6";
	let judgeModel = args.judgeModel ?? "claude-sonnet-4-6";

	const history: Message[] = [];
	const tasks: string[] = [];
	let totalUsage: TokenUsage = emptyUsage();
	let currentSessionId: string | undefined;
	const status = new StatusLine(model, judgeModel);

	// One-shot mode
	if (args.oneShot) {
		// Prepend piped input as context
		const task = pipedInput
			? `${args.oneShot}\n\n<context>\n${pipedInput.trim()}\n</context>`
			: args.oneShot;
		const ac = new AbortController();
		let forceQuit = false;
		const onSigint = () => {
			if (forceQuit) process.exit(1);
			forceQuit = true;
			ac.abort();
			console.log(chalk.dim("\n  interrupted"));
			setTimeout(() => {
				forceQuit = false;
			}, 1000);
		};
		process.on("SIGINT", onSigint);
		try {
			checkpoint();
			const result = await runWithJudge({
				task,
				history,
				model,
				judgeModel,
				thinking: args.thinking,
				dryRun: args.dryRun,
				signal: ac.signal,
			});
			totalUsage = addUsage(totalUsage, result.usage);
			tasks.push(args.oneShot);
		} catch (err) {
			if (!ac.signal.aborted) {
				console.log(
					chalk.red(
						`\n  error: ${err instanceof Error ? err.message : String(err)}\n`,
					),
				);
			}
		} finally {
			process.removeListener("SIGINT", onSigint);
		}
		printCost(totalUsage, model);
		if (tasks.length > 0) {
			await saveSession(model, history, totalUsage, tasks);
		}
		return;
	}

	// REPL mode
	console.log(BANNER);
	console.log(chalk.dim(`  model: ${model}  ·  judge: active`));
	console.log(chalk.dim("  type / for commands\n"));

	let dryRunNext = false;
	let currentAbort: AbortController | null = null;
	let forceQuitTimer: ReturnType<typeof setTimeout> | null = null;

	// --- Slash commands (add new commands here) ---
	const commands: Array<{
		name: string;
		desc: string;
		run: () => void | Promise<void>;
	}> = [
		{
			name: "/clear",
			desc: "Clear conversation history",
			run: () => {
				history.length = 0;
				currentSessionId = undefined;
				console.log(chalk.dim("  history cleared\n"));
			},
		},
		{
			name: "/cost",
			desc: "Show token usage and cost",
			run: () => printCost(totalUsage, model),
		},
		{
			name: "/exit",
			desc: "Quit",
			run: () => {}, // handled separately in the REPL loop
		},
		{
			name: "/model",
			desc: "Change model",
			run: async () => {
				console.log(
					chalk.dim(`\n  current: ${model} · judge: ${judgeModel}\n`),
				);

				const modelItems = MODELS.map((m) => ({
					name: m.id,
					desc: `${m.label}  - ${m.note}${m.id === model ? " (current)" : ""}`,
				}));

				// Pick main model
				console.log(chalk.dim("  select model:"));
				const picked = await commandMenu(modelItems, (h) => {
					activeKeyHandler = h;
				});
				if (!picked) return;
				model = picked;

				// Pick judge model
				console.log(chalk.dim("  select judge model:"));
				const judgeItems = MODELS.map((m) => ({
					name: m.id,
					desc:
						`${m.label}  - ${m.note}` +
						(m.id === judgeModel ? " (current)" : ""),
				}));
				const pickedJudge = await commandMenu(judgeItems, (h) => {
					activeKeyHandler = h;
				});
				if (!pickedJudge) {
					// Cancelled judge pick  - use same as main
					judgeModel = model;
				} else {
					judgeModel = pickedJudge;
				}

				status.setModel(model, judgeModel);
				console.log(chalk.dim(`  model: ${model} · judge: ${judgeModel}\n`));
			},
		},
		{
			name: "/plan",
			desc: "Plan-only next task (no execution)",
			run: () => {
				dryRunNext = true;
				console.log(chalk.dim("  next task will plan + judge only\n"));
			},
		},
		{
			name: "/review",
			desc: "Judge your staged git changes",
			run: async () => {
				const usage = await reviewStagedChanges(judgeModel);
				if (usage) {
					totalUsage = addUsage(totalUsage, usage);
				}
				console.log();
			},
		},
		{
			name: "/resume",
			desc: "Resume a saved session",
			run: async () => {
				const sessions = await listSessions();
				if (sessions.length === 0) {
					console.log(chalk.dim("  no saved sessions\n"));
					return;
				}
				// Already sorted most-recent-first by listSessions()
				const sessionItems = sessions.map((s) => {
					const date = new Date(s.timestamp);
					const when = date.toLocaleDateString(undefined, {
						month: "short",
						day: "numeric",
						hour: "2-digit",
						minute: "2-digit",
					});
					const lastTask =
						s.tasks.length > 0
							? s.tasks[s.tasks.length - 1].slice(0, 40) +
								(s.tasks[s.tasks.length - 1].length > 40 ? "..." : "")
							: "empty";
					return {
						name: s.id,
						desc: `${when} - ${lastTask} (${s.messageCount} msgs)`,
					};
				});

				const selected = await commandMenu(
					sessionItems,
					(h) => {
						activeKeyHandler = h;
					},
					{ preserveOrder: true },
				);
				if (!selected) return;

				const session = await loadSession(selected);
				if (!session) {
					console.log(chalk.dim("  failed to load session\n"));
					return;
				}
				history.length = 0;
				// Inject session summary so the model has context
				// even if older messages get trimmed
				if (session.summary) {
					history.push({
						role: "user",
						content: `[Resumed session. Previous work:\n${session.summary}]`,
					});
					history.push({
						role: "assistant",
						content:
							"Understood, I have context from the previous session. How can I help?",
					});
				}
				history.push(...session.history);
				totalUsage = addUsage(totalUsage, session.usage);
				tasks.push(...session.tasks);
				currentSessionId = selected;

				const lastTask =
					session.tasks.length > 0
						? session.tasks[session.tasks.length - 1]
						: "unknown";
				console.log(
					chalk.dim(
						`  resumed session ${selected} (${session.history.length} messages)`,
					),
				);
				console.log(chalk.dim(`  last task: ${lastTask}\n`));
			},
		},
		{
			name: "/undo",
			desc: "Revert last task's changes",
			run: async () => {
				if (!canUndo()) {
					console.log(chalk.dim("  nothing to undo\n"));
					return;
				}
				const result = await undo();
				if (result.success) {
					console.log(chalk.green(`  ${result.message}\n`));
				} else {
					console.log(chalk.red(`  ${result.message}\n`));
				}
			},
		},
	];

	// Sorted for display; /help is built-in and always last-resort
	commands.sort((a, b) => a.name.localeCompare(b.name));

	const menuItems = commands.map((c) => ({ name: c.name, desc: c.desc }));

	const handleSlashCommand = async (cmd: string): Promise<void> => {
		if (cmd === "/help") {
			console.log();
			for (const c of commands) {
				console.log(`  ${chalk.cyan(c.name.padEnd(12))} ${chalk.dim(c.desc)}`);
			}
			console.log();
			return;
		}
		const match = commands.find((c) => c.name === cmd);
		if (match) {
			await match.run();
		} else {
			console.log(chalk.dim(`  unknown command: ${cmd}  (type / for menu)\n`));
		}
	};

	// REPL loop
	while (true) {
		const result = await readInput();

		if (result.kind === "sigint") {
			if (forceQuitTimer) {
				process.exit(1);
			}
			console.log(chalk.dim("  (press again to quit, or type /exit)"));
			forceQuitTimer = setTimeout(() => {
				forceQuitTimer = null;
			}, 1000);
			continue;
		}

		if (result.kind === "menu") {
			const selected = await commandMenu(menuItems, (h) => {
				activeKeyHandler = h;
			});
			if (selected) {
				if (selected === "/exit") {
					status.clear();
					printCost(totalUsage, model);
					break;
				}
				await handleSlashCommand(selected);
			}
			continue;
		}

		const trimmed = result.value.trim();

		if (!trimmed) continue;

		if (trimmed === "exit" || trimmed === "/quit" || trimmed === "/exit") {
			status.clear();
			printCost(totalUsage, model);
			break;
		}

		// Direct slash commands (typed out fully)
		if (trimmed.startsWith("/")) {
			await handleSlashCommand(trimmed);
			continue;
		}

		// Run task
		console.log();
		checkpoint();
		tasks.push(trimmed);

		const ac = new AbortController();
		currentAbort = ac;

		// Ctrl+C during task execution
		const onSigint = () => {
			if (currentAbort) {
				currentAbort.abort();
				currentAbort = null;
				console.log(chalk.dim("\n  interrupted\n"));
			}
		};
		process.on("SIGINT", onSigint);

		const dryRunThisTask = dryRunNext || args.dryRun;
		dryRunNext = false;
		try {
			const taskResult = await runWithJudge({
				task: trimmed,
				history,
				model,
				judgeModel,
				thinking: args.thinking,
				dryRun: dryRunThisTask,
				signal: ac.signal,
			});
			totalUsage = addUsage(totalUsage, taskResult.usage);
		} catch (err) {
			if (!ac.signal.aborted) {
				console.log(
					chalk.red(
						`\n  error: ${err instanceof Error ? err.message : String(err)}\n`,
					),
				);
			}
		} finally {
			process.removeListener("SIGINT", onSigint);
			currentAbort = null;
		}
		status.update(totalUsage);

		console.log();
	}

	// Save session on exit (update existing or create new)
	if (tasks.length > 0) {
		currentSessionId = await saveSession(
			model,
			history,
			totalUsage,
			tasks,
			currentSessionId,
		);
		console.log(
			chalk.dim(
				`\n  session ${currentSessionId} saved. use /resume to continue where you left off.\n`,
			),
		);
	}

}

function printCost(usage: TokenUsage, model: string): void {
	const cost = estimateCost(usage, model);
	const total = (usage.inputTokens + usage.outputTokens).toLocaleString();
	const inp = usage.inputTokens.toLocaleString();
	const out = usage.outputTokens.toLocaleString();
	const cached = usage.cacheReadTokens
		? chalk.green(` (${usage.cacheReadTokens.toLocaleString()} cached)`)
		: "";
	console.log();
	console.log(
		chalk.dim(`  tokens  ${total}  (in ${inp} / out ${out})${cached}`),
	);
	console.log(chalk.dim(`  cost    ~$${cost.toFixed(4)}`));
}

main()
	.then(() => {
		process.stdin.unref();
	})
	.catch((err) => {
		console.error(chalk.red(err.message));
		process.exit(1);
	});
