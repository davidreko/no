import type { InternalTool, ToolDefinition } from "../types";
import { bashTool } from "./bash";
import { editFileTool } from "./edit-file";
import { gitDiffTool, gitLogTool } from "./git";
import { globTool } from "./glob";
import { grepTool } from "./grep";
import { listDirTool } from "./list-dir";
import { readFileTool } from "./read-file";
import { writeFileTool } from "./write-file";

const ALL_TOOLS: InternalTool[] = [
	readFileTool,
	listDirTool,
	globTool,
	grepTool,
	gitDiffTool,
	gitLogTool,
	writeFileTool,
	editFileTool,
	bashTool,
];

const toolMap = new Map<string, InternalTool>();
for (const tool of ALL_TOOLS) {
	toolMap.set(tool.definition.name, tool);
}

export function getTool(name: string): InternalTool | undefined {
	return toolMap.get(name);
}

export function getAllToolDefinitions(): ToolDefinition[] {
	return ALL_TOOLS.map((t) => t.definition);
}

export function getReadOnlyToolDefinitions(): ToolDefinition[] {
	return ALL_TOOLS.filter((t) => t.readOnly).map((t) => t.definition);
}

export { ALL_TOOLS };
