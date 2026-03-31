import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PROJECT_ROOT } from "./sandbox";
import type { Message, TokenUsage } from "./types";
import { emptyUsage } from "./types";

const MAX_SESSIONS = 5;

export interface Session {
	id: string;
	timestamp: string;
	model: string;
	history: Message[];
	usage: TokenUsage;
	tasks: string[];
	summary?: string;
}

function sessionsDir(): string {
	return join(PROJECT_ROOT, ".no", "sessions");
}

function sessionPath(id: string): string {
	return join(sessionsDir(), `${id}.json`);
}

function generateId(): string {
	const now = new Date();
	const y = now.getFullYear();
	const m = String(now.getMonth() + 1).padStart(2, "0");
	const d = String(now.getDate()).padStart(2, "0");
	const h = String(now.getHours()).padStart(2, "0");
	const min = String(now.getMinutes()).padStart(2, "0");
	const s = String(now.getSeconds()).padStart(2, "0");
	return `${y}${m}${d}-${h}${min}${s}`;
}

/**
 * Build a compact summary of what happened in this session.
 * Used as context when resuming so the model knows what was done
 * even if older messages get trimmed.
 */
function buildSummary(tasks: string[], history: Message[]): string {
	const parts: string[] = [];

	for (const task of tasks) {
		parts.push(`- Task: ${task}`);
	}

	// Extract files that were written/edited from tool calls
	const files = new Set<string>();
	for (const msg of history) {
		if (typeof msg.content === "string") continue;
		const blocks = msg.content as unknown as Array<Record<string, unknown>>;
		for (const block of blocks) {
			if (block.type !== "tool_use") continue;
			if (block.name === "write_file" || block.name === "edit_file") {
				const input = block.input as Record<string, unknown> | undefined;
				if (input?.path) files.add(String(input.path));
			}
		}
	}

	if (files.size > 0) {
		parts.push(`- Files modified: ${[...files].join(", ")}`);
	}

	return parts.join("\n");
}

/**
 * Save or update a session. If sessionId is provided, updates that session
 * in place. Otherwise creates a new one.
 */
export async function saveSession(
	model: string,
	history: Message[],
	usage: TokenUsage,
	tasks: string[],
	sessionId?: string,
): Promise<string> {
	const dir = sessionsDir();
	if (!existsSync(dir)) {
		await mkdir(dir, { recursive: true });
	}

	const id = sessionId ?? generateId();
	const session: Session = {
		id,
		timestamp: new Date().toISOString(),
		model,
		history,
		usage,
		tasks,
		summary: buildSummary(tasks, history),
	};

	await writeFile(sessionPath(id), JSON.stringify(session, null, 2), "utf-8");
	if (!sessionId) {
		await pruneOldSessions();
	}
	return id;
}

export async function loadSession(id: string): Promise<Session | null> {
	const path = sessionPath(id);
	if (!existsSync(path)) return null;

	try {
		const raw = await readFile(path, "utf-8");
		return JSON.parse(raw) as Session;
	} catch {
		return null;
	}
}

export async function getLatestSessionId(): Promise<string | null> {
	const dir = sessionsDir();
	if (!existsSync(dir)) return null;

	const files = await readdir(dir);
	const sessions = files
		.filter((f) => f.endsWith(".json"))
		.map((f) => f.replace(".json", ""))
		.sort()
		.reverse();

	return sessions[0] ?? null;
}

export interface SessionSummary {
	id: string;
	timestamp: string;
	tasks: string[];
	messageCount: number;
	usage: TokenUsage;
}

export async function listSessions(): Promise<SessionSummary[]> {
	const dir = sessionsDir();
	if (!existsSync(dir)) return [];

	const files = await readdir(dir);
	const sessions: SessionSummary[] = [];

	for (const f of files) {
		if (!f.endsWith(".json")) continue;
		try {
			const raw = await readFile(join(dir, f), "utf-8");
			const s = JSON.parse(raw) as Session;
			sessions.push({
				id: s.id,
				timestamp: s.timestamp,
				tasks: s.tasks,
				messageCount: s.history.length,
				usage: s.usage ?? emptyUsage(),
			});
		} catch {
			// skip corrupt files
		}
	}

	// Most recent first
	return sessions.sort((a, b) => b.id.localeCompare(a.id));
}

async function pruneOldSessions(): Promise<void> {
	const dir = sessionsDir();
	if (!existsSync(dir)) return;

	const files = await readdir(dir);
	const sessionFiles = files.filter((f) => f.endsWith(".json")).sort();

	if (sessionFiles.length <= MAX_SESSIONS) return;

	const toRemove = sessionFiles.slice(0, sessionFiles.length - MAX_SESSIONS);
	for (const f of toRemove) {
		await unlink(join(dir, f));
	}
}
